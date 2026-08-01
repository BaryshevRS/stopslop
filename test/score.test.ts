import { describe, expect, it } from 'vitest';
import { computeScore, levelFor } from '../src/score.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import type { Finding, FindingKind, ResolvedConfig } from '../src/types.js';

function findings(kind: FindingKind, n: number): Finding[] {
  return Array.from({ length: n }, (_, i) => ({
    kind,
    file: `src/f${i}.ts`,
    symbol: `s${i}`,
    line: 1,
    severity: 'warn' as const,
    message: '',
  }));
}

function score(input: {
  findings?: Finding[];
  loc?: number;
  duplicationRatio?: number;
  /** Whether Knip actually ran (default: it did). */
  deadCodeMeasured?: boolean;
  config?: ResolvedConfig;
}) {
  return computeScore({
    findings: input.findings ?? [],
    loc: input.loc ?? 10_000, // 10 KLOC
    metrics: {
      ...(input.duplicationRatio === undefined ? {} : { duplicationRatio: input.duplicationRatio }),
      ...(input.deadCodeMeasured === false ? {} : { deadCodeMeasured: true }),
    },
    config: input.config ?? DEFAULT_CONFIG,
  });
}

describe('slop score', () => {
  it('is 0 on a clean repo', () => {
    const result = score({ duplicationRatio: 0 });

    expect(result.score).toBe(0);
    expect(result.level).toBe('clean');
  });

  it('is size-independent: the same density scores the same at any repo size', () => {
    const small = score({ findings: findings('god-class', 1), loc: 5_000, duplicationRatio: 0 });
    const large = score({ findings: findings('god-class', 4), loc: 20_000, duplicationRatio: 0 });

    expect(small.densities.god).toBe(large.densities.god);
    expect(small.score).toBe(large.score);
  });

  it('saturates each signal at its budget, so one signal cannot exceed its weight', () => {
    // god budget is 0.1/KLOC; 100 god units in 10 KLOC is 100x over it, 5 is 5x.
    const maxed = score({ findings: findings('god-module', 100), duplicationRatio: 0 });
    const atBudget = score({ findings: findings('god-module', 5), duplicationRatio: 0 });

    expect(atBudget.contributions.god).toBeCloseTo(100 * DEFAULT_CONFIG.score.weights.god, 1);
    expect(maxed.contributions.god).toBe(atBudget.contributions.god);
  });

  it('every signal at its budget scores 100 — legacy-grade', () => {
    const result = score({
      findings: [
        ...findings('god-class', 5), // 0.5/KLOC ≥ 0.1 budget
        ...findings('cognitive-complexity', 40), // 4/KLOC
        ...findings('unused-export', 40), // 4/KLOC
      ],
      duplicationRatio: 0.3,
    });

    expect(result.score).toBe(100);
    expect(result.level).toBe('legacy-grade');
  });

  it('drops a disabled check from the formula instead of scoring it as clean', () => {
    const config: ResolvedConfig = {
      ...DEFAULT_CONFIG,
      duplicates: { ...DEFAULT_CONFIG.duplicates, enabled: false },
      deadCode: { ...DEFAULT_CONFIG.deadCode, enabled: false },
    };
    // Complexity maxed out (40 findings / 10 KLOC = budget); with duplication and
    // dead code off, the remaining weights renormalize, so it is not diluted by
    // checks that never ran.
    const partial = score({
      findings: findings('cognitive-complexity', 40),
      deadCodeMeasured: false,
      config,
    });
    const full = score({ findings: findings('cognitive-complexity', 40), duplicationRatio: 0 });

    expect(partial.densities.duplication).toBeUndefined();
    expect(partial.densities.deadCode).toBeUndefined();
    const { god, complexity } = DEFAULT_CONFIG.score.weights;
    expect(partial.score).toBeCloseTo((100 * complexity) / (god + complexity), 1);
    expect(partial.score).toBeGreaterThan(full.score);
  });

  it('drops a check that bailed out at runtime, even though it is enabled', () => {
    // Knip skipped (no install): dead code was never measured. Scoring it as
    // 0/KLOC would hand the repo free credit for a check that never ran.
    const skipped = score({ deadCodeMeasured: false, duplicationRatio: 0 });
    const measured = score({ duplicationRatio: 0 });

    expect(DEFAULT_CONFIG.deadCode.enabled).toBe(true);
    expect(skipped.densities.deadCode).toBeUndefined();
    expect(measured.densities.deadCode).toBe(0);
  });

  it('counts duplication as a share of lines, not per KLOC', () => {
    // 17.5% duplication = halfway between the 5% floor and the 30% budget.
    const result = score({ duplicationRatio: 0.175 });

    expect(result.densities.duplication).toBe(0.175);
    expect(result.contributions.duplication).toBeCloseTo(
      100 * DEFAULT_CONFIG.score.weights.duplication * 0.5,
      1,
    );
  });

  it('charges nothing below a signal floor — baseline duplication is not slop', () => {
    const atFloor = score({ duplicationRatio: 0.05 });
    const below = score({ duplicationRatio: 0.02 });

    expect(atFloor.contributions.duplication).toBe(0);
    expect(below.contributions.duplication).toBe(0);
    // ...but the density is still reported as a fact.
    expect(below.densities.duplication).toBe(0.02);
  });

  it('maps scores to levels at the documented bands', () => {
    expect(levelFor(0)).toBe('clean');
    expect(levelFor(9.9)).toBe('clean');
    expect(levelFor(10)).toBe('low');
    expect(levelFor(25)).toBe('moderate');
    expect(levelFor(50)).toBe('high');
    expect(levelFor(75)).toBe('legacy-grade');
  });
});

describe('corpus percentile', () => {
  it('anchors a clean repo at the bottom and a maxed repo at the top', () => {
    const clean = score({ duplicationRatio: 0 });
    const maxed = score({
      findings: [...findings('god-class', 5), ...findings('cognitive-complexity', 50)],
      duplicationRatio: 0.5,
    });

    expect(clean.percentile).toBe(0);
    expect(maxed.percentile).toBe(100);
  });

  it('is absent when a core signal was not measured', () => {
    // No duplication ratio (e.g. --fast): the corpus comparison would be
    // apples-to-oranges, so there is no percentile at all.
    const result = score({});
    expect(result.percentile).toBeUndefined();
  });

  it('lands an ordinary repo inside the distribution, not at an edge', () => {
    // Corpus-median duplication and complexity, no god units. God carries 0.35
    // of the weight and half the corpus has some, so god-free lands below the
    // middle — the point here is only that it is anchored, not clamped.
    const result = score({
      findings: findings('cognitive-complexity', 11),
      duplicationRatio: 0.13,
    });
    expect(result.percentile).toBeGreaterThan(0);
    expect(result.percentile).toBeLessThan(90);
  });
});
