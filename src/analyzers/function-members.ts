import type { FunctionUnit } from './cognitive-complexity.js';
import { patternNames, resolveModuleRefs } from './members.js';
import type { OxcNode } from '../types.js';
import type { reactHooks } from './react-hooks.js';

interface ClosureGraph {
  functions: Map<string, FunctionUnit>;
  dependencies: Map<string, Set<string>>;
  ownerRefs: Set<string>;
}

/**
 * Model bindings in the function's shared scope and closures declared or
 * registered directly in its body. A member's deeper callbacks contribute
 * captures to that member. JSX is an entry point to the logic, not a graph hub.
 */
export function extractClosureGraph(
  owner: FunctionUnit,
  children: ReadonlyMap<OxcNode, FunctionUnit>,
  reactHook: ReturnType<typeof reactHooks>,
): ClosureGraph {
  const body = owner.node.body as OxcNode;
  const statements = body.type === 'BlockStatement' ? (body.body as OxcNode[]) : [];
  const bindings = new Set<string>();
  const aliases = new Map<string, string>();
  const functions = new Map<string, FunctionUnit>();
  const memoOutputs = new Map<string, string>();
  const excludedFromOwner = new Set<OxcNode>();

  for (const param of owner.node.params as OxcNode[]) patternNames(param, bindings);

  if (owner.node.id) patternNames(owner.node.id as OxcNode, bindings);

  for (const statement of statements) {
    if (statement.type === 'VariableDeclaration') {
      for (const declaration of statement.declarations as OxcNode[]) {
        patternNames(declaration.id as OxcNode, bindings);
      }
    } else if (statement.type === 'FunctionDeclaration' || statement.type === 'ClassDeclaration') {
      if (statement.id) patternNames(statement.id as OxcNode, bindings);
    }
  }

  function register(node: OxcNode | undefined, binding?: string): string | undefined {
    const fn = node && children.get(node);

    if (!fn) return undefined;

    const name = binding ?? fn.name;
    functions.set(name, fn);

    return name;
  }

  for (const statement of statements) {
    if (statement.type === 'FunctionDeclaration') {
      register(statement, (statement.id as OxcNode | null)?.name as string | undefined);
    } else if (statement.type === 'VariableDeclaration') {
      for (const declaration of statement.declarations as OxcNode[]) {
        const id = declaration.id as OxcNode;
        const init = declaration.init as OxcNode | null;

        if (!init) continue;

        const binding = id.type === 'Identifier' ? String(id.name) : undefined;
        register(init, binding);

        if (init.type !== 'CallExpression') continue;

        const hook = reactHook(init.callee as OxcNode, bindings);
        const args = init.arguments as OxcNode[];

        if (hook === 'useCallback' || hook === 'useMemo') {
          const name = register(args[0], hook === 'useCallback' ? binding : undefined);

          if (name) {
            excludedFromOwner.add(init);

            if (hook === 'useMemo' && binding) memoOutputs.set(name, binding);
          }
        } else if ((hook === 'useState' || hook === 'useReducer') && id.type === 'ArrayPattern') {
          const [state, setter] = id.elements as (OxcNode | null)[];

          if (state?.type === 'Identifier' && setter?.type === 'Identifier') {
            aliases.set(String(setter.name), String(state.name));
          }
        }
      }
    } else if (statement.type === 'ExpressionStatement') {
      const expression = statement.expression as OxcNode;

      if (expression.type === 'CallExpression') {
        for (const arg of expression.arguments as OxcNode[]) register(arg);

        const hook = reactHook(expression.callee as OxcNode, bindings);

        if (hook === 'useEffect' || hook === 'useLayoutEffect') {
          const [callback] = expression.arguments as OxcNode[];

          if (callback && children.has(callback)) excludedFromOwner.add(expression);
        }
      }
    }
  }

  const dependencies = new Map<string, Set<string>>();

  for (const binding of bindings) {
    if (!aliases.has(binding)) dependencies.set(binding, new Set());
  }

  const normalize = (refs: ReadonlySet<string>) => new Set([...refs].map(ref => aliases.get(ref) ?? ref));

  for (const [name, member] of functions) {
    const refs = normalize(resolveModuleRefs(member.node, bindings, name, {}));
    const output = memoOutputs.get(name);

    if (output) refs.add(output);

    dependencies.set(name, refs);
  }

  for (const member of functions.values()) excludedFromOwner.add(member.node);

  const ownerRefs = normalize(resolveModuleRefs(owner.node, bindings, '', { skip: excludedFromOwner }));

  return { functions, dependencies, ownerRefs };
}
