import type { Finding, ProjectMetrics, ResolvedConfig, ScoreConfig, ScoreSignals } from './types.js';
import { REFERENCE_CORPUS } from './corpus.js';

// Slop level — one number so a repo can be compared with itself over time and
// with other repos regardless of size. Absolute counts are useless for that: a
// 200 KLOC monorepo will always "win" on raw finding counts.
//
// Every signal is a density (per KLOC; duplication is a share of lines). Each
// rises linearly from its floor (below which the density is the baseline of any
// living codebase, not slop) to its budget — the density at which the signal is
// as bad as it gets — then saturates, and is weighted. Weights, floors, and
// budgets live in the config and the formula is published in docs/score.md: the
// number is a heuristic aggregate, the densities under it are the facts.
//
//   score = 100 · Σ wᵢ·sat(xᵢ) / Σ wᵢ        (i = enabled signals)
//   sat(x) = clamp((x − floorᵢ) / (budgetᵢ − floorᵢ), 0, 1)

// `legacy-grade` (not "severe"): a high score is "this reads like accumulated
// legacy" — true whether a team wrote it over a decade or an agent produced it
// last week. It reframes the top band as a description, not an insult.
export type SlopLevel = 'clean' | 'low' | 'moderate' | 'high' | 'legacy-grade';

export interface SlopScore {
  /** 0..100. */
  score: number;
  level: SlopLevel;
  kloc: number;
  loc: number;
  /** Raw signal values: per-KLOC densities, duplication as a 0..1 ratio. */
  densities: Partial<ScoreSignals>;
  /** Each signal's contribution to the score, in points. */
  contributions: Partial<ScoreSignals>;
  /**
   * How many signals actually fed the score, out of all of them. A partial
   * score is NOT comparable with a full one: the missing weight is renormalized
   * away, so an unmeasured signal is imputed from the others and pushes the
   * number up. Callers must surface this.
   */
  signalCount: number;
  totalSignals: number;
  /**
   * Share (0..100) of the reference corpus this repo is sloppier than, on the
   * core signals (god + duplication + complexity) all 41 corpus repos measure
   * identically. Absent when a core signal was not measured.
   */
  percentile?: number;
}

const TOTAL_SIGNALS = 4;

export interface ScoreInput {
  findings: Finding[];
  /** Physical lines across the analyzed files. */
  loc: number;
  metrics: Partial<ProjectMetrics>;
  config: ResolvedConfig;
}

export function computeScore(input: ScoreInput): SlopScore {
  const { config } = input;
  const kloc = input.loc / 1000;
  const counts = countKinds(input.findings);

  const densities: Partial<ScoreSignals> = {};
  // A signal is only scored when its check actually ran — a check that was
  // disabled, or that bailed out (no install, no package.json), must not read as
  // a clean bill of health, so it drops out of the denominator too. The AST
  // checks always run when enabled; the engines report back through `metrics`.
  if (config.godModule.enabled || config.godClass.enabled) {
    densities.god = perKloc(counts.god, kloc);
  }
  if (config.cognitiveComplexity.enabled) {
    densities.complexity = perKloc(counts.complexity, kloc);
  }
  if (input.metrics.duplicationRatio !== undefined) {
    densities.duplication = input.metrics.duplicationRatio;
  }
  if (input.metrics.deadCodeMeasured) {
    densities.deadCode = perKloc(counts.deadCode, kloc);
  }

  const contributions: Partial<ScoreSignals> = {};
  let weighted = 0;
  let totalWeight = 0;
  for (const signal of Object.keys(densities) as (keyof ScoreSignals)[]) {
    const weight = config.score.weights[signal];
    const saturated = saturate(densities[signal]!, signal, config.score);
    contributions[signal] = round(100 * weight * saturated, 1);
    weighted += weight * saturated;
    totalWeight += weight;
  }

  const score = totalWeight > 0 ? round((100 * weighted) / totalWeight, 1) : 0;
  return {
    score,
    level: levelFor(score),
    loc: input.loc,
    kloc: round(kloc, 2),
    densities: roundAll(densities),
    contributions,
    signalCount: Object.keys(densities).length,
    totalSignals: TOTAL_SIGNALS,
    percentile: corpusPercentile(densities, config.score),
  };
}

/** Rise linearly from the floor, saturate at the budget. */
function saturate(value: number, signal: keyof ScoreSignals, score: ScoreConfig): number {
  const floor = score.floors[signal];
  const budget = score.budgets[signal];
  if (budget <= floor) return 0; // degenerate config — refuse to divide by it
  if (value <= floor) return 0;
  return Math.min(1, (value - floor) / (budget - floor));
}

/**
 * "Worse than N% of reference repos": the share of the 41-repo corpus with a
 * strictly lower core score. Core = god + duplication + complexity — the
 * signals measured identically everywhere (dead code isn't; see corpus.ts).
 * Uses the caller's weights/floors/budgets, so a custom config re-ranks the
 * corpus with the same yardstick it applies to the repo.
 */
export function corpusPercentile(
  densities: Partial<ScoreSignals>,
  score: ScoreConfig,
): number | undefined {
  const { god, duplication, complexity } = densities;
  if (god === undefined || duplication === undefined || complexity === undefined) return undefined;
  const mine = coreScore({ god, duplication, complexity }, score);
  let below = 0;
  for (const entry of REFERENCE_CORPUS) {
    if (coreScore(entry, score) < mine) below++;
  }
  return Math.round((100 * below) / REFERENCE_CORPUS.length);
}

function coreScore(
  d: { god: number; duplication: number; complexity: number },
  score: ScoreConfig,
): number {
  const signals = ['god', 'duplication', 'complexity'] as const;
  let weighted = 0;
  let totalWeight = 0;
  for (const signal of signals) {
    weighted += score.weights[signal] * saturate(d[signal], signal, score);
    totalWeight += score.weights[signal];
  }
  return totalWeight > 0 ? (100 * weighted) / totalWeight : 0;
}

/** Bands are labels for the score, not extra detection thresholds. */
export function levelFor(score: number): SlopLevel {
  if (score < 10) return 'clean';
  if (score < 25) return 'low';
  if (score < 50) return 'moderate';
  if (score < 75) return 'high';
  return 'legacy-grade';
}

interface KindCounts {
  god: number;
  complexity: number;
  deadCode: number;
}

function countKinds(findings: Finding[]): KindCounts {
  const counts: KindCounts = { god: 0, complexity: 0, deadCode: 0 };
  for (const f of findings) {
    // Only signals we stand behind move the number. `info` findings (unused
    // *files*, which hang on entry-point detection) are reported but never
    // scored — otherwise a misdetected entry point outweighs a real god class.
    if (f.severity === 'info') continue;
    switch (f.kind) {
      case 'god-module':
      case 'god-class':
        counts.god++;
        break;
      case 'cognitive-complexity':
        counts.complexity++;
        break;
      case 'unused-export':
      case 'unused-dependency':
      case 'unused-file':
        counts.deadCode++;
        break;
      case 'orphan-feature':
        // Deliberately unscored. The point of the signal is to get the orphan
        // and its test deleted, and the finding already says which two things to
        // delete — a weight in the score removes no code. It is also rare by
        // construction, so a weight would add noise to a number whose budgets
        // were calibrated without it. Report it, do not grade on it.
        break;
      default:
        break; // multiple-exported-classes and duplicates are scored elsewhere
    }
  }
  return counts;
}

function perKloc(count: number, kloc: number): number {
  return kloc > 0 ? count / kloc : 0;
}

function round(n: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

function roundAll(densities: Partial<ScoreSignals>): Partial<ScoreSignals> {
  const out: Partial<ScoreSignals> = {};
  for (const [k, v] of Object.entries(densities) as [keyof ScoreSignals, number][]) {
    out[k] = round(v, 3);
  }
  return out;
}
