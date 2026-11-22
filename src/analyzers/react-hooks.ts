import type { OxcNode, ParsedFile } from '../types.js';

const REACT_HOOKS = new Set(['useCallback', 'useMemo', 'useEffect', 'useLayoutEffect', 'useState', 'useReducer']);

/** Recognize named imports (including aliases) and namespace/default imports. */
export function reactHooks(file: ParsedFile): (callee: OxcNode, shadowed?: ReadonlySet<string>) => string | undefined {
  const named = new Map<string, string>();
  const namespaces = new Set<string>();

  for (const node of file.program.body as OxcNode[]) {
    if (node.type !== 'ImportDeclaration' || node.importKind === 'type' || (node.source as OxcNode).value !== 'react')
      continue;

    for (const specifier of node.specifiers as OxcNode[]) {
      if (specifier.importKind === 'type') continue;

      const local = String((specifier.local as OxcNode).name);

      if (specifier.type === 'ImportSpecifier') {
        const imported = String((specifier.imported as OxcNode).name);

        if (REACT_HOOKS.has(imported)) named.set(local, imported);
      } else {
        namespaces.add(local);
      }
    }
  }

  return (callee, shadowed) => {
    if (callee.type === 'Identifier') {
      const name = String(callee.name);

      return shadowed?.has(name) ? undefined : named.get(name);
    }

    if (callee.type === 'MemberExpression' && !callee.computed) {
      const object = callee.object as OxcNode;
      const property = String((callee.property as OxcNode).name);

      if (
        object.type === 'Identifier' &&
        namespaces.has(String(object.name)) &&
        !shadowed?.has(String(object.name)) &&
        REACT_HOOKS.has(property)
      ) {
        return property;
      }
    }

    return undefined;
  };
}
