import type { OxcNode } from './types.js';

/**
 * TypeScript type-only subtrees. We never descend into these: a shared
 * `Config` type annotation must not create cohesion edges, and type nodes
 * carry no runtime complexity. See ARCH.md ("поддеревья типов пропускаются").
 */
export const TYPE_NODE_PREFIX = 'TS';

const TYPE_NODES_TO_KEEP = new Set([
  // TS nodes that DO carry runtime members/values — do not skip these.
  'TSParameterProperty', // constructor DI params become class fields
  'TSEnumDeclaration',
  'TSEnumMember',
  'TSModuleDeclaration', // namespace with runtime body
  'TSModuleBlock',
  'TSNonNullExpression',
  'TSAsExpression',
  'TSSatisfiesExpression',
  'TSInstantiationExpression',
]);

/** True if a node is a type-only subtree we should not walk into. */
export function isTypeNode(type: string): boolean {
  return type.startsWith(TYPE_NODE_PREFIX) && !TYPE_NODES_TO_KEEP.has(type);
}

function isNode(value: unknown): value is OxcNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { type?: unknown }).type === 'string'
  );
}

export interface Visitor {
  /** Return `false` to skip this node's children. */
  enter?(node: OxcNode, parent: OxcNode | null): boolean | void;
  leave?(node: OxcNode, parent: OxcNode | null): void;
}

/**
 * Depth-first AST walk. Skips type-only subtrees automatically. `enter`
 * returning `false` prunes children (used to hand control to sub-walkers).
 */
export function walk(root: OxcNode, visitor: Visitor): void {
  const stack: Array<{ node: OxcNode; parent: OxcNode | null }> = [
    { node: root, parent: null },
  ];
  // Iterative post-order is awkward; use recursion for clarity — TS ASTs are shallow.
  function visit(node: OxcNode, parent: OxcNode | null): void {
    if (isTypeNode(node.type)) return;
    const descend = visitor.enter?.(node, parent);
    if (descend !== false) {
      for (const key in node) {
        if (key === 'type' || key === 'start' || key === 'end') continue;
        const value = node[key];
        if (Array.isArray(value)) {
          for (const child of value) if (isNode(child)) visit(child, node);
        } else if (isNode(value)) {
          visit(value, node);
        }
      }
    }
    visitor.leave?.(node, parent);
  }
  void stack;
  visit(root, null);
}

/** Collect direct + nested child nodes of a given type (skips type subtrees). */
export function collect(root: OxcNode, type: string): OxcNode[] {
  const out: OxcNode[] = [];
  walk(root, {
    enter(node) {
      if (node.type === type) out.push(node);
    },
  });
  return out;
}
