import type { CohesionUnit, Member, MemberKind, OxcNode, ParsedFile } from '../types.js';
import { isTypeNode } from '../walk.js';

// Extraction of cohesion members from a module and from each class, plus
// lexical reference resolution. No type checker: resolution is scope-based
// (module) or `this.<member>`-based (class).

function isNode(v: unknown): v is OxcNode {
  return typeof v === 'object' && v !== null && typeof (v as { type?: unknown }).type === 'string';
}
function childNodes(node: OxcNode): OxcNode[] {
  const out: OxcNode[] = [];
  for (const key in node) {
    if (key === 'type' || key === 'start' || key === 'end') continue;
    const value = node[key];
    if (Array.isArray(value)) for (const c of value) { if (isNode(c)) out.push(c); }
    else if (isNode(value)) out.push(value);
  }
  return out;
}

const FN_TYPES = new Set(['FunctionExpression', 'ArrowFunctionExpression', 'FunctionDeclaration']);
function isFunctionInit(node: unknown): boolean {
  return isNode(node) && FN_TYPES.has(node.type);
}
function isInjectCall(node: unknown): boolean {
  // `inject(Foo)` — Angular-style DI.
  return (
    isNode(node) &&
    node.type === 'CallExpression' &&
    isNode(node.callee) &&
    (node.callee as OxcNode).type === 'Identifier' &&
    (node.callee as OxcNode).name === 'inject'
  );
}

function locOf(file: ParsedFile, node: OxcNode): number {
  return file.lineAt(node.end) - file.lineAt(node.start) + 1;
}

// ── binding-name collection for scope tracking ──────────────────────────────

function patternNames(node: OxcNode, out: Set<string>): void {
  switch (node.type) {
    case 'Identifier':
      out.add(String(node.name));
      break;
    case 'AssignmentPattern':
      if (isNode(node.left)) patternNames(node.left, out);
      break;
    case 'RestElement':
      if (isNode(node.argument)) patternNames(node.argument, out);
      break;
    case 'ArrayPattern':
      for (const el of (node.elements as unknown[]) ?? []) if (isNode(el)) patternNames(el, out);
      break;
    case 'ObjectPattern':
      for (const p of (node.properties as unknown[]) ?? []) {
        if (!isNode(p)) continue;
        if (p.type === 'RestElement') patternNames(p, out);
        else if (isNode(p.value)) patternNames(p.value, out);
      }
      break;
    case 'TSParameterProperty':
      if (isNode(node.parameter)) patternNames(node.parameter, out);
      break;
  }
}

/** Names declared directly in a scope body (not descending into nested functions). */
function directDeclarations(statements: OxcNode[]): Set<string> {
  const names = new Set<string>();
  for (const stmt of statements) collectDecl(stmt, names);
  return names;
}
function collectDecl(node: OxcNode, names: Set<string>): void {
  switch (node.type) {
    case 'VariableDeclaration':
      for (const d of (node.declarations as unknown[]) ?? []) {
        if (isNode(d) && isNode(d.id)) patternNames(d.id, names);
      }
      break;
    case 'FunctionDeclaration':
    case 'ClassDeclaration':
      if (isNode(node.id)) names.add(String((node.id as OxcNode).name));
      break;
    case 'ExportNamedDeclaration':
    case 'ExportDefaultDeclaration':
      if (isNode(node.declaration)) collectDecl(node.declaration, names);
      break;
  }
}

// ── module-level reference resolution (scope walker) ────────────────────────

/**
 * Identifiers used as values inside `root` that resolve to one of `targets`
 * and are not shadowed by a local binding. `self` (the member's own name) is
 * excluded so recursion isn't a self-edge.
 */
export function resolveModuleRefs(root: OxcNode, targets: Set<string>, self: string): Set<string> {
  const refs = new Set<string>();
  const scopes: Array<Set<string>> = [];

  const isDeclaredLocal = (name: string): boolean => scopes.some((s) => s.has(name));

  function pushFnScope(fn: OxcNode): void {
    const s = new Set<string>();
    for (const p of (fn.params as unknown[]) ?? []) if (isNode(p)) patternNames(p, s);
    if (isNode(fn.id)) s.add(String((fn.id as OxcNode).name));
    scopes.push(s);
  }

  function visit(node: OxcNode, parent: OxcNode | null): void {
    if (isTypeNode(node.type)) return;

    if (FN_TYPES.has(node.type)) {
      pushFnScope(node);
      const body = node.body;
      if (isNode(body)) {
        if (body.type === 'BlockStatement') {
          const decls = directDeclarations((body.body as OxcNode[]) ?? []);
          scopes.push(decls);
          for (const c of (body.body as OxcNode[]) ?? []) visit(c, body);
          scopes.pop();
        } else {
          visit(body, node); // expression-bodied arrow
        }
      }
      scopes.pop();
      return;
    }

    if (node.type === 'BlockStatement') {
      const decls = directDeclarations((node.body as OxcNode[]) ?? []);
      scopes.push(decls);
      for (const c of (node.body as OxcNode[]) ?? []) visit(c, node);
      scopes.pop();
      return;
    }

    if (node.type === 'CatchClause') {
      const s = new Set<string>();
      if (isNode(node.param)) patternNames(node.param, s);
      scopes.push(s);
      if (isNode(node.body)) visit(node.body, node);
      scopes.pop();
      return;
    }

    if (node.type === 'Identifier') {
      if (isValueRef(node, parent) && !isDeclaredLocal(String(node.name))) {
        const name = String(node.name);
        if (name !== self && targets.has(name)) refs.add(name);
      }
      return;
    }

    for (const child of childNodes(node)) visit(child, node);
  }

  // walk the member's own subtree; if it's a function, its params are its scope
  visit(root, null);
  return refs;
}

/** Is this Identifier used in value position (vs. a property name / binding / label)? */
function isValueRef(id: OxcNode, parent: OxcNode | null): boolean {
  if (!parent) return true;
  switch (parent.type) {
    case 'MemberExpression':
      // obj.PROP — property is not a variable ref unless computed
      if (parent.property === id && !parent.computed) return false;
      return true;
    case 'Property':
      // { KEY: value } — key not a ref unless computed; shorthand key IS a ref
      if (parent.key === id && !parent.computed && !parent.shorthand) return false;
      return true;
    case 'VariableDeclarator':
      return parent.init === id; // id side is a binding
    case 'FunctionDeclaration':
    case 'FunctionExpression':
    case 'ArrowFunctionExpression':
    case 'ClassDeclaration':
    case 'ClassExpression':
      return false; // the id/name slot
    case 'MethodDefinition':
    case 'PropertyDefinition':
      return parent.key !== id || !!parent.computed;
    case 'LabeledStatement':
    case 'BreakStatement':
    case 'ContinueStatement':
      return false;
    case 'ImportSpecifier':
    case 'ImportDefaultSpecifier':
    case 'ImportNamespaceSpecifier':
    case 'ExportSpecifier':
      return false;
    default:
      return true;
  }
}

// ── class-level reference resolution (this.<member>) ────────────────────────

/** `this.X` accesses inside `root` where X ∈ targets. */
export function resolveClassRefs(root: OxcNode, targets: Set<string>, self: string): Set<string> {
  const refs = new Set<string>();
  (function visit(node: OxcNode): void {
    if (isTypeNode(node.type)) return;
    if (
      node.type === 'MemberExpression' &&
      isNode(node.object) &&
      (node.object as OxcNode).type === 'ThisExpression' &&
      isNode(node.property) &&
      !node.computed
    ) {
      const name = String((node.property as OxcNode).name);
      if (name !== self && targets.has(name)) refs.add(name);
      // still descend (computed args etc.) but property already handled
    }
    for (const child of childNodes(node)) visit(child);
  })(root);
  return refs;
}

// ── module extraction ───────────────────────────────────────────────────────

interface RawMember {
  name: string;
  kind: MemberKind;
  node: OxcNode; // subtree to resolve refs over
  exported: boolean;
  line: number;
  loc: number;
  complexity: number;
}

export function extractModule(
  file: ParsedFile,
  complexityOf: (fnNode: OxcNode) => number,
): CohesionUnit {
  const program = file.program;
  const raw: RawMember[] = [];

  const add = (name: string, kind: MemberKind, node: OxcNode, exported: boolean, fnNode?: OxcNode): void => {
    raw.push({
      name,
      kind,
      node,
      exported,
      line: file.lineAt(node.start),
      loc: locOf(file, node),
      complexity: fnNode ? complexityOf(fnNode) : 0,
    });
  };

  const handleDecl = (decl: OxcNode, exported: boolean): void => {
    switch (decl.type) {
      case 'FunctionDeclaration':
        if (isNode(decl.id)) add(String((decl.id as OxcNode).name), 'function', decl, exported, decl);
        break;
      case 'ClassDeclaration':
      case 'ClassExpression':
        if (isNode(decl.id)) add(String((decl.id as OxcNode).name), 'function', decl, exported);
        break;
      case 'TSEnumDeclaration':
        if (isNode(decl.id)) add(String((decl.id as OxcNode).name), 'state', decl, exported);
        break;
      case 'VariableDeclaration':
        for (const d of (decl.declarations as OxcNode[]) ?? []) {
          if (!isNode(d) || !isNode(d.id) || (d.id as OxcNode).type !== 'Identifier') continue;
          const name = String((d.id as OxcNode).name);
          if (isFunctionInit(d.init)) add(name, 'function', d, exported, d.init as OxcNode);
          else add(name, 'state', d, exported);
        }
        break;
    }
  };

  for (const node of (program.body as OxcNode[]) ?? []) {
    if (node.type === 'ExportNamedDeclaration' && isNode(node.declaration)) {
      handleDecl(node.declaration as OxcNode, true);
    } else if (node.type === 'ExportDefaultDeclaration' && isNode(node.declaration)) {
      handleDecl(node.declaration as OxcNode, true);
    } else {
      handleDecl(node, false);
    }
  }

  const names = new Set(raw.map((m) => m.name));
  const members: Member[] = raw.map((m) => ({
    name: m.name,
    kind: m.kind,
    complexity: m.complexity,
    exported: m.exported,
    line: m.line,
    loc: m.loc,
    refs: m.kind === 'function' ? resolveModuleRefs(m.node, names, m.name) : new Set<string>(),
  }));

  return {
    kind: 'module',
    name: file.relPath,
    file: file.relPath,
    line: 1,
    members,
    clusters: [],
    hubs: [],
  };
}

// ── class extraction ─────────────────────────────────────────────────────────

/** Extract a CohesionUnit for each class declared in the file. */
export function extractClasses(
  file: ParsedFile,
  complexityOf: (fnNode: OxcNode) => number,
): CohesionUnit[] {
  const units: CohesionUnit[] = [];
  (function find(node: OxcNode): void {
    if (isTypeNode(node.type)) return;
    if (node.type === 'ClassDeclaration' || node.type === 'ClassExpression') {
      const unit = extractOneClass(file, node, complexityOf);
      if (unit) units.push(unit);
    }
    for (const child of childNodes(node)) find(child);
  })(file.program);
  return units;
}

function extractOneClass(
  file: ParsedFile,
  cls: OxcNode,
  complexityOf: (fnNode: OxcNode) => number,
): CohesionUnit | null {
  const className = isNode(cls.id) ? String((cls.id as OxcNode).name) : '<anonymous>';
  const body = cls.body as OxcNode | undefined;
  if (!isNode(body)) return null;
  const elements = (body.body as OxcNode[]) ?? [];

  const raw: RawMember[] = [];
  const fieldNames = new Set<string>();

  const memberName = (key: OxcNode | undefined): string | null => {
    if (!key) return null;
    return String(key.name ?? key.value ?? '');
  };

  let ctor: OxcNode | null = null;

  for (const el of elements) {
    if (el.type === 'MethodDefinition') {
      const kind = String(el.kind);
      const name = memberName(el.key as OxcNode);
      if (!name) continue;
      if (kind === 'constructor') {
        ctor = el.value as OxcNode;
        continue; // constructor excluded from clustering (LCOM4)
      }
      const fn = el.value as OxcNode;
      raw.push({
        name,
        kind: 'function',
        node: fn,
        exported: false,
        line: file.lineAt(el.start),
        loc: locOf(file, el),
        complexity: isNode(fn) ? complexityOf(fn) : 0,
      });
    } else if (el.type === 'PropertyDefinition') {
      const name = memberName(el.key as OxcNode);
      if (!name) continue;
      fieldNames.add(name);
      let kind: MemberKind;
      if (isFunctionInit(el.value)) kind = 'function';
      else if (isInjectCall(el.value)) kind = 'dependency';
      else kind = 'state';
      raw.push({
        name,
        kind,
        node: isNode(el.value) ? (el.value as OxcNode) : el,
        exported: false,
        line: file.lineAt(el.start),
        loc: locOf(file, el),
        complexity: isFunctionInit(el.value) ? complexityOf(el.value as OxcNode) : 0,
      });
    }
  }

  // constructor parameter properties → dependency fields
  if (ctor) {
    for (const p of (ctor.params as OxcNode[]) ?? []) {
      if (isNode(p) && p.type === 'TSParameterProperty' && isNode(p.parameter)) {
        const names = new Set<string>();
        patternNames(p.parameter as OxcNode, names);
        for (const name of names) {
          if (fieldNames.has(name)) continue;
          fieldNames.add(name);
          raw.push({
            name,
            kind: 'dependency',
            node: p,
            exported: false,
            line: file.lineAt(p.start),
            loc: 1,
            complexity: 0,
          });
        }
      }
    }
    // implicit fields assigned as `this.x = ...` in constructor
    collectThisFields(ctor, fieldNames, raw, file);
  }

  const names = new Set(raw.map((m) => m.name));
  const members: Member[] = raw.map((m) => ({
    name: m.name,
    kind: m.kind,
    complexity: m.complexity,
    exported: m.exported,
    line: m.line,
    loc: m.loc,
    refs: m.kind === 'function' ? resolveClassRefs(m.node, names, m.name) : new Set<string>(),
  }));

  return {
    kind: 'class',
    name: className,
    file: file.relPath,
    line: file.lineAt(cls.start),
    members,
    clusters: [],
    hubs: [],
  };
}

function collectThisFields(root: OxcNode, known: Set<string>, raw: RawMember[], file: ParsedFile): void {
  (function visit(node: OxcNode): void {
    if (isTypeNode(node.type)) return;
    if (
      node.type === 'AssignmentExpression' &&
      isNode(node.left) &&
      (node.left as OxcNode).type === 'MemberExpression'
    ) {
      const left = node.left as OxcNode;
      if (
        isNode(left.object) &&
        (left.object as OxcNode).type === 'ThisExpression' &&
        isNode(left.property) &&
        !left.computed
      ) {
        const name = String((left.property as OxcNode).name);
        if (name && !known.has(name)) {
          known.add(name);
          raw.push({
            name,
            kind: isFunctionInit(node.right) ? 'function' : 'state',
            node: isNode(node.right) ? (node.right as OxcNode) : node,
            exported: false,
            line: file.lineAt(node.start),
            loc: 1,
            complexity: 0,
          });
        }
      }
    }
    for (const child of childNodes(node)) visit(child);
  })(root);
}
