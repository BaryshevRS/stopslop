import { describe, expect, it } from 'vitest';
import { parseFile } from '../src/parse.js';
import { collectFunctions, computeCognitiveComplexity } from '../src/analyzers/cognitive-complexity.js';
import type { OxcNode } from '../src/types.js';

function scoreOf(code: string, fnName?: string): number {
  const { file } = parseFile('t.ts', '/t.ts', code);
  if (!file) throw new Error('parse failed');
  const fns = collectFunctions(file);
  const fn = fnName ? fns.find((f) => f.name === fnName) : fns[0];
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

  it('nested function raises nesting but adds no increment itself', () => {
    // arrow nests body to 1; inner if = +1+1 = 2
    expect(scoreOf(`function f() { return () => { if (x) {} }; }`)).toBe(2);
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
  it('names class methods as Class.method and folds nested funcs', () => {
    const code = `
      class A {
        run() {
          [1,2].forEach(x => { if (x) {} });
        }
      }`;
    const { file } = parseFile('t.ts', '/t.ts', code);
    const fns = collectFunctions(file!);
    const run = fns.find((f) => f.name === 'A.run');
    expect(run).toBeTruthy();
    // the forEach arrow is folded in: nested → if at nesting 1 = 2
    expect(run!.complexity).toBe(2);
    // the nested arrow is NOT reported separately
    expect(fns).toHaveLength(1);
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
