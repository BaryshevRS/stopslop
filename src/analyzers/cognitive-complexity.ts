import type { Analyzer, Finding, OxcNode, ParsedFile } from '../types.js';
import { jsxComplexityGate } from '../config.js';
import { isTypeNode, walk } from '../walk.js';
import { reactHooks } from './react-hooks.js';

/**
 * Cognitive Complexity — G. Ann Campbell (SonarSource) white paper
 * "Cognitive Complexity: A New Way of Measuring Understandability".
 * Ported from the SPEC, not from eslint-plugin-sonarjs code (LGPL). The plugin
 * is used only as an oracle in cross-check tests.
 *
 * Three rule families (white paper):
 *   B1 structural increment  — control-flow structures score +1
 *   B2 nesting increment     — some of those also add the current nesting depth
 *   B3 nesting level         — structures that raise the depth for their body
 * Note: recursion is intentionally NOT counted, matching eslint-plugin-sonarjs,
 * which is our cross-check oracle.
 */

const LOOPS = new Set(['ForStatement', 'ForInStatement', 'ForOfStatement', 'WhileStatement', 'DoWhileStatement']);
const FUNCTIONS = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);

function childNodes(node: OxcNode): OxcNode[] {
  const out: OxcNode[] = [];

  for (const key in node) {
    if (key === 'type' || key === 'start' || key === 'end') continue;

    const value = node[key];

    if (Array.isArray(value)) {
      for (const c of value) if (isChild(c)) out.push(c);
    } else if (isChild(value)) {
      out.push(value);
    }
  }

  return out;
}

function isChild(v: unknown): v is OxcNode {
  return typeof v === 'object' && v !== null && typeof (v as { type?: unknown }).type === 'string';
}

/** Class and module thresholds were calibrated with nested functions folded in. */
export function computeCognitiveComplexity(fnNode: OxcNode, includeNested = false): number {
  const { logic, jsx } = scoreFunction(fnNode, includeNested);

  return logic + jsx;
}

function scoreFunction(fnNode: OxcNode, includeNested = false) {
  const logic = { value: 0 };
  const jsx = { value: 0 };
  let score = logic;
  let jsxStart: number | undefined;

  // Visit a subtree. `nesting` is the current nesting depth. `logicalParent`
  // is the operator of the enclosing LogicalExpression, if any.
  function visit(node: OxcNode, nesting: number, logicalParent: string | null): void {
    if (isTypeNode(node.type)) return;

    const t = node.type;

    if (t === 'JSXElement' || t === 'JSXFragment') {
      const previous = score;
      const before = jsx.value;
      score = jsx;

      for (const child of childNodes(node)) visit(child, nesting, null);

      score = previous;

      if (previous !== jsx && jsxStart === undefined && jsx.value > before) jsxStart = node.start;

      return;
    }

    if (t === 'IfStatement') {
      visitIf(node, nesting, false);

      return;
    }

    if (t === 'ConditionalExpression') {
      score.value += 1 + nesting;
      visitChild(node, 'test', nesting, null);
      visitChild(node, 'consequent', nesting + 1, null);
      visitChild(node, 'alternate', nesting + 1, null);

      return;
    }

    if (t === 'SwitchStatement') {
      score.value += 1 + nesting;
      visitChild(node, 'discriminant', nesting, null);

      for (const c of asArray(node.cases)) visit(c, nesting + 1, null);

      return;
    }

    if (LOOPS.has(t)) {
      score.value += 1 + nesting;

      for (const key of ['init', 'test', 'update', 'left', 'right']) visitChild(node, key, nesting, null);

      visitChild(node, 'body', nesting + 1, null);

      return;
    }

    if (t === 'CatchClause') {
      score.value += 1 + nesting;
      visitChild(node, 'body', nesting + 1, null);

      return;
    }

    if (t === 'LogicalExpression') {
      const op = String(node.operator);

      if (op !== logicalParent) score.value += 1;

      visitChild(node, 'left', nesting, op);
      visitChild(node, 'right', nesting, op);

      return;
    }

    if (FUNCTIONS.has(t)) {
      if (includeNested) {
        for (const child of childNodes(node)) visit(child, nesting + 1, null);
      }

      return;
    }

    if ((t === 'BreakStatement' || t === 'ContinueStatement') && node.label) {
      score.value += 1; // jump to a label

      return;
    }

    // Default: recurse, nesting and logical context unchanged.
    for (const child of childNodes(node)) visit(child, nesting, null);
  }

  function visitIf(node: OxcNode, nesting: number, isElseIf: boolean): void {
    // `if` gets a nesting penalty; `else if` is a flat +1.
    score.value += isElseIf ? 1 : 1 + nesting;
    visitChild(node, 'test', nesting, null);
    visitChild(node, 'consequent', nesting + 1, null);
    const alt = node.alternate;

    if (!isChild(alt)) return;

    if (alt.type === 'IfStatement') {
      visitIf(alt, nesting, true); // else if — same base nesting
    } else {
      score.value += 1; // else — flat
      visit(alt, nesting + 1, null);
    }
  }

  function visitChild(node: OxcNode, key: string, nesting: number, logicalParent: string | null): void {
    const v = node[key];

    if (isChild(v)) visit(v, nesting, logicalParent);
  }

  // Start inside the function body at nesting 0.
  const body = fnNode.body;

  if (isChild(body)) {
    if (body.type === 'BlockStatement') {
      for (const stmt of asArray(body.body)) visit(stmt, 0, null);
    } else {
      visit(body, 0, null); // arrow with expression body
    }
  }

  return { logic: logic.value, jsx: jsx.value, jsxStart };
}

function asArray(v: unknown): OxcNode[] {
  return Array.isArray(v) ? v.filter(isChild) : [];
}

// ── Reportable-function collection ──────────────────────────────────────────

export interface FunctionUnit {
  name: string;
  node: OxcNode;
  line: number;
  /** Combined score for scope-wide structural rules. */
  complexity: number;
  jsxComplexity: number;
  jsxLine?: number;
  owner: FunctionUnit | undefined;
}

/** Give each function its own score and a symbol qualified by its enclosing function. */
export function collectFunctions(file: ParsedFile): FunctionUnit[] {
  const units: FunctionUnit[] = [];
  const classStack: string[] = [];
  const nameCounts = new Map<string, number>();
  const ancestors: OxcNode[] = [];
  const hook = reactHooks(file);
  let owner: FunctionUnit | undefined;

  function nameFor(node: OxcNode, parent: OxcNode | null): string | null {
    if (node.type === 'FunctionDeclaration') {
      const id = node.id as OxcNode | undefined;

      return id ? String(id.name) : null;
    }

    if (!parent) return null;

    if (parent.type === 'VariableDeclarator' && isChild(parent.id)) {
      return String((parent.id as OxcNode).name ?? '');
    }

    if (parent.type === 'MethodDefinition' || parent.type === 'PropertyDefinition') {
      const key = parent.key as OxcNode | undefined;
      const kn = key ? String(key.name ?? key.value ?? '') : '';
      const cls = classStack[classStack.length - 1];

      return cls ? `${cls}.${kn}` : kn;
    }

    if (parent.type === 'Property') {
      const key = parent.key as OxcNode | undefined;

      return key ? String(key.name ?? key.value ?? '') : null;
    }

    return null;
  }

  function anonymousName(node: OxcNode, parent: OxcNode | null): string {
    if (isChild(node.id) && typeof node.id.name === 'string') return node.id.name;

    if (parent?.type === 'ExportDefaultDeclaration') return 'default';

    if (parent?.type === 'JSXExpressionContainer') {
      const attribute = ancestors.at(-2);

      if (attribute?.type === 'JSXAttribute' && isChild(attribute.name) && attribute.name.type === 'JSXIdentifier') {
        return `${attribute.name.name} callback`;
      }
    }

    if (parent?.type !== 'CallExpression' && parent?.type !== 'NewExpression') return '<anonymous>';

    const callee = parent.callee;

    if (!isChild(callee)) return '<anonymous>';

    const target = callee.type === 'MemberExpression' ? callee.property : callee;

    if (!isChild(target)) return '<anonymous>';

    const name = target.name ?? target.value;

    if (typeof name !== 'string') return '<anonymous>';

    const firstArg = asArray(parent.arguments)[0];
    const assignment = ancestors.at(-2);
    const wrapper = hook(callee);

    if (
      (wrapper === 'useCallback' || wrapper === 'useMemo') &&
      firstArg === node &&
      assignment?.type === 'VariableDeclarator' &&
      isChild(assignment.id) &&
      assignment.id.type === 'Identifier'
    ) {
      return String(assignment.id.name);
    }

    const label =
      firstArg?.type === 'Literal' && typeof firstArg.value === 'string'
        ? `${name}(${JSON.stringify(firstArg.value)})`
        : name;

    return `${label} callback`;
  }

  walk(file.program, {
    enter(node, parent) {
      if (node.type === 'ClassDeclaration' || node.type === 'ClassExpression') {
        classStack.push(isChild(node.id) ? String(node.id.name) : '<anonymous>');
      }

      if (FUNCTIONS.has(node.type) && isChild(node.body)) {
        const localName = nameFor(node, parent) || anonymousName(node, parent);
        const base = owner ? `${owner.name}.${localName}` : localName;
        const count = (nameCounts.get(base) ?? 0) + 1;
        nameCounts.set(base, count);
        const { logic, jsx, jsxStart } = scoreFunction(node);
        owner = {
          name: count === 1 ? base : `${base}#${count}`,
          node,
          line: file.lineAt(node.start),
          complexity: logic + jsx,
          jsxComplexity: jsx,
          jsxLine: jsxStart === undefined ? undefined : file.lineAt(jsxStart),
          owner,
        };
        units.push(owner);
      }

      ancestors.push(node);
    },
    leave(node) {
      ancestors.pop();

      if (owner?.node === node) owner = owner.owner;

      if (node.type === 'ClassDeclaration' || node.type === 'ClassExpression') classStack.pop();
    },
  });

  return units;
}

export function cognitiveComplexityAnalyzer(): Analyzer {
  return {
    name: 'cognitive-complexity',
    analyzeFile(file, ctx) {
      const gate = ctx.config.cognitiveComplexity;
      const jsxGate = jsxComplexityGate(ctx.config);

      if (!gate.enabled && !jsxGate.enabled) return [];

      const threshold = gate.threshold;
      const findings: Finding[] = [];

      for (const fn of collectFunctions(file)) {
        if (
          gate.enabled &&
          ctx.referenceComplexity &&
          !fn.owner &&
          computeCognitiveComplexity(fn.node, true) > threshold
        ) {
          ctx.referenceComplexity.count++;
        }

        const complexity = fn.complexity - fn.jsxComplexity;

        if (gate.enabled && complexity > threshold) {
          findings.push({
            kind: 'cognitive-complexity',
            file: file.relPath,
            symbol: fn.name,
            line: fn.line,
            severity: 'warn',
            message: `${fn.name} has cognitive complexity ${complexity} (threshold ${threshold})`,
            data: { complexity, threshold },
            preliminary: ctx.config.preliminary,
          });
        }

        if (jsxGate.enabled && fn.jsxComplexity > jsxGate.threshold) {
          findings.push({
            kind: 'jsx-cognitive-complexity',
            file: file.relPath,
            symbol: fn.name,
            line: fn.jsxLine ?? fn.line,
            severity: 'warn',
            message: `${fn.name} has JSX cognitive complexity ${fn.jsxComplexity} (threshold ${jsxGate.threshold})`,
            data: { complexity: fn.jsxComplexity, threshold: jsxGate.threshold },
            preliminary: ctx.config.preliminary,
          });
        }
      }

      return findings;
    },
  };
}
