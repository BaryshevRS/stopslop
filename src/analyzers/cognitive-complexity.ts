import type { Analyzer, Finding, OxcNode, ParsedFile } from '../types.js';
import { isTypeNode } from '../walk.js';

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

/** Cognitive complexity of one function-like node (its body, nested funcs folded in). */
export function computeCognitiveComplexity(fnNode: OxcNode): number {
  let score = 0;

  // Visit a subtree. `nesting` is the current nesting depth. `logicalParent`
  // is the operator of the enclosing LogicalExpression, if any.
  function visit(node: OxcNode, nesting: number, logicalParent: string | null): void {
    if (isTypeNode(node.type)) return;
    const t = node.type;

    if (t === 'IfStatement') {
      visitIf(node, nesting, false);
      return;
    }
    if (t === 'ConditionalExpression') {
      score += 1 + nesting;
      visitChild(node, 'test', nesting, null);
      visitChild(node, 'consequent', nesting + 1, null);
      visitChild(node, 'alternate', nesting + 1, null);
      return;
    }
    if (t === 'SwitchStatement') {
      score += 1 + nesting;
      visitChild(node, 'discriminant', nesting, null);
      for (const c of asArray(node.cases)) visit(c, nesting + 1, null);
      return;
    }
    if (LOOPS.has(t)) {
      score += 1 + nesting;
      for (const key of ['init', 'test', 'update', 'left', 'right']) visitChild(node, key, nesting, null);
      visitChild(node, 'body', nesting + 1, null);
      return;
    }
    if (t === 'CatchClause') {
      score += 1 + nesting;
      visitChild(node, 'body', nesting + 1, null);
      return;
    }
    if (t === 'LogicalExpression') {
      const op = String(node.operator);
      if (op !== logicalParent) score += 1;
      visitChild(node, 'left', nesting, op);
      visitChild(node, 'right', nesting, op);
      return;
    }
    if (FUNCTIONS.has(t)) {
      // Nested function: no increment, but its body nests one deeper.
      for (const child of childNodes(node)) visit(child, nesting + 1, null);
      return;
    }
    if ((t === 'BreakStatement' || t === 'ContinueStatement') && node.label) {
      score += 1; // jump to a label
      return;
    }
    // Default: recurse, nesting and logical context unchanged.
    for (const child of childNodes(node)) visit(child, nesting, null);
  }

  function visitIf(node: OxcNode, nesting: number, isElseIf: boolean): void {
    // `if` gets a nesting penalty; `else if` is a flat +1.
    score += isElseIf ? 1 : 1 + nesting;
    visitChild(node, 'test', nesting, null);
    visitChild(node, 'consequent', nesting + 1, null);
    const alt = node.alternate;
    if (!isChild(alt)) return;
    if (alt.type === 'IfStatement') {
      visitIf(alt, nesting, true); // else if — same base nesting
    } else {
      score += 1; // else — flat
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
  return score;
}

function asArray(v: unknown): OxcNode[] {
  return Array.isArray(v) ? v.filter(isChild) : [];
}

// ── Reportable-function collection ──────────────────────────────────────────

export interface FunctionUnit {
  name: string;
  node: OxcNode;
  line: number;
  complexity: number;
}

/**
 * Collect top-level-ish functions/methods with names and scores. Nested
 * functions are folded into their owner (not reported separately), which keeps
 * a slop report readable. Named via declaration/assignment context.
 */
export function collectFunctions(file: ParsedFile): FunctionUnit[] {
  const units: FunctionUnit[] = [];
  const classStack: string[] = [];

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

  function walk(node: OxcNode, parent: OxcNode | null): void {
    if (isTypeNode(node.type)) return;
    const isClass = node.type === 'ClassDeclaration' || node.type === 'ClassExpression';
    if (isClass) {
      const id = node.id as OxcNode | undefined;
      classStack.push(id ? String(id.name) : '<anonymous>');
    }
    if (FUNCTIONS.has(node.type)) {
      const name = nameFor(node, parent);
      if (name) {
        units.push({
          name,
          node,
          line: file.lineAt(node.start),
          complexity: computeCognitiveComplexity(node),
        });
        // Do not descend — nested functions are folded into this score.
        if (isClass) classStack.pop();
        return;
      }
    }
    for (const child of childNodes(node)) walk(child, node);
    if (isClass) classStack.pop();
  }

  walk(file.program, null);
  return units;
}

export function cognitiveComplexityAnalyzer(): Analyzer {
  return {
    name: 'cognitive-complexity',
    analyzeFile(file, ctx) {
      const gate = ctx.config.cognitiveComplexity;
      if (!gate.enabled) return [];
      const threshold = gate.threshold;
      const findings: Finding[] = [];
      for (const fn of collectFunctions(file)) {
        if (fn.complexity > threshold) {
          findings.push({
            kind: 'cognitive-complexity',
            file: file.relPath,
            symbol: fn.name,
            line: fn.line,
            severity: 'warn',
            message: `${fn.name} has cognitive complexity ${fn.complexity} (threshold ${threshold})`,
            data: { complexity: fn.complexity, threshold },
            preliminary: ctx.config.preliminary,
          });
        }
      }
      return findings;
    },
  };
}
