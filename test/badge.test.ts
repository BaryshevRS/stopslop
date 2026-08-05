import { describe, expect, it } from 'vitest';
import { toBadge } from '../src/report/badge.js';
import type { AnalyzeResult } from '../src/index.js';
import type { SlopScore } from '../src/score.js';

function result(slop: Partial<SlopScore>): AnalyzeResult {
  const full: SlopScore = {
    score: 0,
    level: 'clean',
    kloc: 1,
    loc: 1000,
    densities: {},
    contributions: {},
    signalCount: 4,
    totalSignals: 4,
    ...slop,
  };
  // Only `.slop` and `.findings` are read; the rest is filler for this unit test.
  return { slop: full, findings: [] } as unknown as AnalyzeResult;
}

function parse(json: string) {
  return JSON.parse(json) as { schemaVersion: number; label: string; message: string; color: string };
}

describe('slop badge', () => {
  it('renders a clear gate when no findings remain', () => {
    const b = parse(toBadge(result({ score: 82.4, level: 'legacy-grade' })));
    expect(b.schemaVersion).toBe(1);
    expect(b.label).toBe('AI slop');
    expect(b.message).toBe('clear');
    expect(b.color).toBe('brightgreen');
  });

  it('renders a detected gate when a finding remains', () => {
    const analyzed = result({ score: 5, level: 'clean' });
    analyzed.findings = [
      {
        kind: 'cognitive-complexity',
        file: 'src/tangled.ts',
        symbol: 'tangled',
        line: 1,
        severity: 'warn',
        message: 'too complex',
      },
    ];
    const b = parse(toBadge(analyzed));
    expect(b.message).toBe('detected');
    expect(b.color).toBe('red');
  });
});
