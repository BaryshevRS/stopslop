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
  // Only `.slop` is read; the rest is filler to satisfy the type.
  return { slop: full } as AnalyzeResult;
}

function parse(json: string) {
  return JSON.parse(json) as { schemaVersion: number; label: string; message: string; color: string };
}

describe('slop badge', () => {
  it('emits a shields.io endpoint payload', () => {
    const b = parse(toBadge(result({ score: 12, level: 'low' })));
    expect(b.schemaVersion).toBe(1);
    expect(b.label).toBe('slop');
  });

  it('renders zero slop as the hero flex', () => {
    const b = parse(toBadge(result({ score: 0, level: 'clean' })));
    expect(b.message).toBe('0 slop');
    expect(b.color).toBe('brightgreen');
  });

  it('shows the level and score for a non-zero repo', () => {
    const b = parse(toBadge(result({ score: 82.4, level: 'legacy-grade' })));
    expect(b.message).toBe('legacy-grade (82/100)');
    expect(b.color).toBe('red');
  });

  it('marks a score built from a subset of signals as inflated', () => {
    const b = parse(toBadge(result({ score: 40, level: 'moderate', signalCount: 2, totalSignals: 4 })));
    expect(b.message).toBe('moderate (40/100)*');
  });

  it('maps each band to a fixed color', () => {
    expect(parse(toBadge(result({ score: 5, level: 'clean' }))).color).toBe('brightgreen');
    expect(parse(toBadge(result({ score: 20, level: 'low' }))).color).toBe('green');
    expect(parse(toBadge(result({ score: 40, level: 'moderate' }))).color).toBe('yellow');
    expect(parse(toBadge(result({ score: 60, level: 'high' }))).color).toBe('orange');
    expect(parse(toBadge(result({ score: 90, level: 'legacy-grade' }))).color).toBe('red');
  });
});
