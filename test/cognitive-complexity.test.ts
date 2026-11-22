import { describe, expect, it } from 'vitest';
import { parseFile } from '../src/parse.js';
import {
  collectFunctions,
  computeCognitiveComplexity,
  cognitiveComplexityAnalyzer,
} from '../src/analyzers/cognitive-complexity.js';
import { resolveConfig } from '../src/config.js';
import type { OxcNode } from '../src/types.js';

function scoreOf(code: string, fnName?: string): number {
  const { file } = parseFile('t.ts', '/t.ts', code);

  if (!file) throw new Error('parse failed');

  const fns = collectFunctions(file);
  const fn = fnName ? fns.find(f => f.name === fnName) : fns[0];

  if (!fn) throw new Error(`function ${fnName ?? '<first>'} not found`);

  return fn.complexity;
}

describe('cognitive complexity — white paper examples', () => {
  it('sumOfPrimes = 7 (nested loops + labeled continue)', () => {
    const code = `
      function sumOfPrimes(max) {
        let total = 0;
        OUTER: for (let i = 1; i <= max; ++i) {
          for (let j = 2; j < i; ++j) {
            if (i % j === 0) {
              continue OUTER;
            }
          }
          total += i;
        }
        return total;
      }`;

    expect(scoreOf(code)).toBe(7);
  });

  it('getWords = 1 (single switch)', () => {
    const code = `
      function getWords(number) {
        switch (number) {
          case 1: return "one";
          case 2: return "a couple";
          default: return "lots";
        }
      }`;

    expect(scoreOf(code)).toBe(1);
  });
});

describe('cognitive complexity — structural rules', () => {
  it('nesting penalty accumulates', () => {
    // if(+1) > if(+2) > if(+3) = 6
    const code = `function f() { if(a){ if(b){ if(c){} } } }`;
    expect(scoreOf(code)).toBe(6);
  });

  it('else and else-if are flat (+1 each), inner if gets nesting', () => {
    // if(+1) ; else-if(+1) ; else(+1) ; inner if in else body(+1+1) = 5
    const code = `function f() {
      if (a) {}
      else if (b) {}
      else { if (c) {} }
    }`;

    expect(scoreOf(code)).toBe(5);
  });

  it('logical: single-operator sequence = +1', () => {
    expect(scoreOf(`function f() { return a && b && c && d; }`)).toBe(1);
  });

  it('logical: operator switch adds a sequence', () => {
    expect(scoreOf(`function f() { return a && b || c; }`)).toBe(2);
  });

  it('logical inside if adds to the if increment', () => {
    // if(+1) + logical sequence(+1) = 2
    expect(scoreOf(`function f() { if (a && b) {} }`)).toBe(2);
  });

  it('ternary gets nesting penalty', () => {
    // outer ternary +1, nested ternary in branch +2 = 3
    expect(scoreOf(`function f() { return a ? (b ? 1 : 2) : 3; }`)).toBe(3);
  });

  it('starts a nested function at its own nesting level', () => {
    const code = `function f() { if (ready) { return () => { if (x) {} }; } }`;
    expect(scoreOf(code, 'f')).toBe(1);
    expect(scoreOf(code, 'f.<anonymous>')).toBe(1);
  });

  it('plain sequential statements = 0', () => {
    expect(scoreOf(`function f() { const a = 1; const b = 2; return a + b; }`)).toBe(0);
  });

  it('catch adds +1 with nesting, try/finally do not', () => {
    // try(0) catch(+1) ; if inside catch body +1+1=2 → total 3
    const code = `function f() {
      try { g(); } catch (e) { if (x) {} } finally { h(); }
    }`;

    expect(scoreOf(code)).toBe(3);
  });
});

describe('collectFunctions — naming & granularity', () => {
  const nestedBranches = 'if (a) { if (b) { if (c) { if (d) { if (e) { if (f) {} } } } } }';

  it.each([
    '(req, res) =>',
    'async (req, res) =>',
    'function (req, res)',
  ])('reports inline route handlers written as %s', signature => {
    const source = `app.get('/users', ${signature} { ${nestedBranches} });`;
    const { file } = parseFile('routes.ts', '/routes.ts', source);
    const findings = cognitiveComplexityAnalyzer().analyzeFile!(file!, {
      config: resolveConfig({}),
    });

    expect(findings).toMatchObject([
      {
        kind: 'cognitive-complexity',
        file: 'routes.ts',
        symbol: 'get("/users") callback',
        line: 1,
        data: { complexity: 21, threshold: 15 },
      },
    ]);
    expect(scoreOf(`const handler = ${signature} { ${nestedBranches} };`)).toBe(21);
  });

  it('collects generic callbacks, chained routes, and each middleware separately', () => {
    const { file } = parseFile(
      'routes.ts',
      '/routes.ts',
      `
      emitter.on('message', () => { if (a) {} });
      app.route('/users').get(() => { if (a) {} }, () => { if (a) { if (b) {} } });
      app.post('/users', () => {});
    `,
    );

    expect(collectFunctions(file!).map(({ name, complexity }) => ({ name, complexity }))).toEqual([
      { name: 'on("message") callback', complexity: 1 },
      { name: 'get callback', complexity: 1 },
      { name: 'get callback#2', complexity: 3 },
      { name: 'post("/users") callback', complexity: 0 },
    ]);
  });

  it.each([
    'export default function () { if (a) {} }',
    'export default () => { if (a) {} };',
  ])('collects anonymous default exports: %s', source => {
    const { file } = parseFile('t.ts', '/t.ts', source);

    expect(collectFunctions(file!).map(({ name, complexity }) => ({ name, complexity }))).toEqual([
      { name: 'default', complexity: 1 },
    ]);
  });

  it('qualifies an inner callback with its anonymous owner', () => {
    const { file } = parseFile(
      't.ts',
      '/t.ts',
      `
      subscribe(() => { values.forEach(value => { if (value) {} }); });
    `,
    );

    expect(collectFunctions(file!).map(({ name, complexity }) => ({ name, complexity }))).toEqual([
      { name: 'subscribe callback', complexity: 0 },
      { name: 'subscribe callback.forEach callback', complexity: 1 },
    ]);
  });

  it('reports a callback inside a named owner separately', () => {
    const { file } = parseFile(
      't.ts',
      '/t.ts',
      `
      function setup(app) { app.get('/users', () => { if (a) {} }); }
    `,
    );

    expect(collectFunctions(file!).map(({ name, complexity }) => ({ name, complexity }))).toEqual([
      { name: 'setup', complexity: 0 },
      { name: 'setup.get("/users") callback', complexity: 1 },
    ]);
  });

  it('collects unnamed functions outside calls and keeps their identity when lines move', () => {
    const source = 'const handlers = [() => { if (a) {} }, function () { if (b) {} }];';
    const { file } = parseFile('t.ts', '/t.ts', source);
    const { file: moved } = parseFile('t.ts', '/t.ts', `// comment\n\n${source}`);
    const summarize = (parsed: NonNullable<typeof file>) =>
      collectFunctions(parsed).map(({ name, complexity }) => ({ name, complexity }));

    expect(summarize(file!)).toEqual([
      { name: '<anonymous>', complexity: 1 },
      { name: '<anonymous>#2', complexity: 1 },
    ]);
    expect(summarize(moved!)).toEqual(summarize(file!));
  });

  it('qualifies a callback inside a class method', () => {
    const code = `
      class A {
        run() {
          [1,2].forEach(x => { if (x) {} });
        }
      }`;

    const { file } = parseFile('t.ts', '/t.ts', code);
    const fns = collectFunctions(file!);
    expect(fns.map(({ name, complexity }) => ({ name, complexity }))).toEqual([
      { name: 'A.run', complexity: 0 },
      { name: 'A.run.forEach callback', complexity: 1 },
    ]);
    expect(computeCognitiveComplexity(fns[0]!.node, true)).toBe(2);
  });

  it('counts JSX conditionals and explicitly names inline handlers and React callbacks', () => {
    const { file } = parseFile(
      'view.tsx',
      '/view.tsx',
      `
      import { useCallback as memo } from 'react';
      function View() {
        const run = memo(() => { if (busy) cancel(); }, []);
        return ready ? <button onClick={() => { if (allowed) run(); }} /> : null;
      }
    `,
    );

    expect(collectFunctions(file!).map(({ name, complexity }) => ({ name, complexity }))).toEqual([
      { name: 'View', complexity: 1 },
      { name: 'View.run', complexity: 1 },
      { name: 'View.onClick callback', complexity: 1 },
    ]);
  });

  it('names arrow consts', () => {
    const code = `const doThing = (x) => { if (x) return 1; return 2; };`;
    const { file } = parseFile('t.ts', '/t.ts', code);
    const fns = collectFunctions(file!);
    expect(fns[0]!.name).toBe('doThing');
  });
});

// sanity: computeCognitiveComplexity works on a raw node too
describe('computeCognitiveComplexity primitive', () => {
  it('scores a bare function node', () => {
    const { file } = parseFile('t.ts', '/t.ts', `function f(){ if(a){} }`);
    const fn = (file!.program as OxcNode).body as unknown as OxcNode[];
    expect(computeCognitiveComplexity(fn[0]!)).toBe(1);
  });
});

describe('separate logic and JSX budgets', () => {
  function component(name: string, body: number, jsx: number): string {
    const logic = 'if (ready) run();\n'.repeat(body);
    const markup = '{ready && <span />}\n'.repeat(jsx);

    return `function ${name}() {\n${logic}return <>\n${markup}</>;\n}`;
  }

  function analyze(source: string, config?: Parameters<typeof resolveConfig>[0]) {
    const { file } = parseFile('view.tsx', '/view.tsx', source);

    return cognitiveComplexityAnalyzer().analyzeFile!(file!, { config: resolveConfig(config) });
  }

  it('gates each score separately at 15 and gives simultaneous findings distinct identities', () => {
    const findings = analyze(
      [
        component('AtLimit', 15, 15),
        component('LogicOnly', 16, 15),
        component('JsxOnly', 15, 16),
        component('Both', 16, 16),
      ].join('\n'),
    );

    expect(findings.map(({ kind, symbol, data }) => ({ kind, symbol, data }))).toEqual([
      { kind: 'cognitive-complexity', symbol: 'LogicOnly', data: { complexity: 16, threshold: 15 } },
      { kind: 'jsx-cognitive-complexity', symbol: 'JsxOnly', data: { complexity: 16, threshold: 15 } },
      { kind: 'cognitive-complexity', symbol: 'Both', data: { complexity: 16, threshold: 15 } },
      { kind: 'jsx-cognitive-complexity', symbol: 'Both', data: { complexity: 16, threshold: 15 } },
    ]);
    expect(findings[3]!.line).toBeGreaterThan(findings[2]!.line);
  });

  it('checks an inline callback on its own and keeps surrounding nesting in the JSX score', () => {
    const findings = analyze(
      `
      function View() {
        if (ready) return <>
          {premium ? <strong /> : <span />}
          <button onClick={() => { if (allowed) run(); }} />
        </>;
        return <span />;
      }
    `,
      { cognitiveComplexity: 0, jsxComplexity: 0 },
    );

    expect(findings.map(({ kind, symbol, line, data }) => ({ kind, symbol, line, data }))).toEqual([
      { kind: 'cognitive-complexity', symbol: 'View', line: 2, data: { complexity: 1, threshold: 0 } },
      { kind: 'jsx-cognitive-complexity', symbol: 'View', line: 3, data: { complexity: 2, threshold: 0 } },
      { kind: 'cognitive-complexity', symbol: 'View.onClick callback', line: 5, data: { complexity: 1, threshold: 0 } },
    ]);
  });

  it('allows either check to be disabled independently', () => {
    const source = component('View', 16, 16);
    expect(analyze(source, { cognitiveComplexity: false, jsxComplexity: 15 }).map(f => f.kind)).toEqual([
      'jsx-cognitive-complexity',
    ]);
    expect(analyze(source, { jsxComplexity: false }).map(f => f.kind)).toEqual(['cognitive-complexity']);
    expect(analyze(source, { cognitiveComplexity: false })).toEqual([]);
  });
});
