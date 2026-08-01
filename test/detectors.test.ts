import { describe, expect, it } from 'vitest';
import { parseFile } from '../src/parse.js';
import { structureAnalyzer } from '../src/analyzers/detectors.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import type { Finding, ResolvedConfig } from '../src/types.js';

// Structural-gate tests isolate cluster logic from the (preliminary) complexity
// threshold, so use a low minComplexity here.
const STRUCT_CONFIG: ResolvedConfig = {
  ...DEFAULT_CONFIG,
  godModule: { ...DEFAULT_CONFIG.godModule, minComplexity: 5 },
  godClass: { ...DEFAULT_CONFIG.godClass, minComplexity: 5 },
};

function run(code: string, config: ResolvedConfig = STRUCT_CONFIG): Finding[] {
  const { file } = parseFile('t.ts', '/t.ts', code);
  return structureAnalyzer().analyzeFile!(file!, { config });
}

// Build a class with N independent 2-method responsibility groups, each pair
// sharing its own private field, plus a shared `state` hub touched by all.
function monsterClass(groups: number): string {
  let fields = '  private state = {};\n';
  let methods = '';
  for (let g = 0; g < groups; g++) {
    fields += `  private f${g} = 0;\n`;
    methods += `  loadG${g}() { this.state; return this.f${g}; }\n`;
    methods += `  saveG${g}() { this.state; this.f${g} = 1; if (this.f${g}) { for (const x of []) {} } }\n`;
  }
  return `class Monster {\n${fields}${methods}}`;
}

describe('god class detector', () => {
  it('flags a pseudo-connected monster and lists substantive groups', () => {
    const findings = run(monsterClass(7)); // 14 methods, 7 groups, hub=state
    const gc = findings.find((f) => f.kind === 'god-class');
    expect(gc).toBeTruthy();
    expect(gc!.data!.hubs).toContain('state');
    expect(gc!.data!.groupCount).toBe(7);
    expect(gc!.data!.members).toBe(14);
  });

  it('does not flag a small cohesive class', () => {
    const code = `
      class Stack {
        private items = [];
        push(x) { this.items.push(x); }
        pop() { return this.items.pop(); }
        peek() { return this.items[this.items.length - 1]; }
      }`;
    expect(run(code).some((f) => f.kind === 'god-class')).toBe(false);
  });

  it('does not flag a facade with only 1-2 real groups (below minClusters)', () => {
    // 15 delegating singletons + 1 pair → 1 substantive group, low complexity → neither axis
    let methods = '  private core;\n  a0() { this.core; this.a1(); }\n  a1() {}\n';
    for (let i = 0; i < 15; i++) methods += `  m${i}() { return ${i}; }\n`;
    const code = `class Facade {\n${methods}}`;
    expect(run(code).some((f) => f.kind === 'god-class')).toBe(false);
  });

  it('flags a densely-connected monolith via the size axis (WMC)', () => {
    // 34 methods all sharing this.state → 1 cluster, no hub, but huge bulk.
    // Cohesion cannot (and should not) split a genuinely connected class.
    let methods = '  private state = {};\n';
    for (let i = 0; i < 34; i++) {
      // each method: complexity ~7 via nested branches; all reference this.state
      methods += `  op${i}() { this.state; if (a) { if (b) { for (const x of []) { if (c) {} } } } ${i > 0 ? `this.op${i - 1}();` : ''} }\n`;
    }
    const code = `class Monolith {\n${methods}}`;
    const gc = run(code).find((f) => f.kind === 'god-class');
    expect(gc).toBeTruthy();
    expect(gc!.data!.axis).toBe('size');
    expect(gc!.data!.members).toBe(34);
    expect(gc!.message).toMatch(/single unit doing far too much/);
  });
});

describe('god module detector', () => {
  it('flags a dump of unrelated responsibility groups', () => {
    // 8 independent groups (16 fns > minMembers), each a pair sharing a state var
    let code = '';
    for (let g = 0; g < 8; g++) {
      code += `let s${g} = 0;\n`;
      code += `export function read${g}() { if (s${g}) { for (const x of []) {} } return s${g}; }\n`;
      code += `export function write${g}(v) { if (v) { s${g} = v; } else { s${g} = 0; } }\n`;
    }
    const findings = run(code);
    const gm = findings.find((f) => f.kind === 'god-module');
    expect(gm).toBeTruthy();
    expect(gm!.data!.groupCount).toBe(8);
  });

  it('ignores barrel files', () => {
    const code = `
      export { a } from './a';
      export { b } from './b';
      export * from './c';
    `;
    expect(run(code)).toHaveLength(0);
  });
});

describe('multiple exported classes', () => {
  it('flags two exported classes in one file', () => {
    const code = `export class A {} export class B {}`;
    const f = run(code).find((x) => x.kind === 'multiple-exported-classes');
    expect(f).toBeTruthy();
    expect(f!.data!.classes).toEqual(['A', 'B']);
  });
});
