import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { KnipConfiguration } from 'knip';
import type {
  CognitiveGate,
  DeadCodeGate,
  DuplicatesGate,
  GodGate,
  MultiClassGate,
  ResolvedConfig,
  ScoreConfig,
  ScoreSignals,
} from './types.js';

/**
 * Slop score defaults. Weights sum to 1 and express what we claim slop *is*:
 * misplaced structure (god units) and copy-paste weigh more than a single hairy
 * function or a stale export. Floors and budgets bracket each signal: below the
 * floor the density is the baseline of any living codebase (contributes 0),
 * at the budget it is "as bad as it gets" (contribution saturates).
 *
 * Every non-zero number is anchored in the 41-repo / 9.4 MLOC benchmark over
 * mature TS OSS (src/corpus.ts) by one rule: a floor is what ordinary repos
 * carry (~p25), a budget is "past anything in the reference corpus" (~max/p90).
 * The first-guess
 * duplication budget (10%) violated that rule — it sat BELOW the corpus median
 * of ~13%, so the signal saturated on ¾ of the corpus and became a constant
 * +25 points that compressed every mature repo into 27..56. Formula and full
 * rationale: docs/score.md.
 */
export const DEFAULT_SCORE: ScoreConfig = {
  weights: { god: 0.35, duplication: 0.25, complexity: 0.2, deadCode: 0.2 },
  budgets: {
    // God units per KLOC: corpus median 0.013, max 0.071 (playwright).
    god: 0.1,
    complexity: 4, // over-complex functions per KLOC: corpus max 3.31 (svelte)
    duplication: 0.3, // duplicated-lines ratio: corpus p90 ≈ 0.31 (mantine)
    deadCode: 4, // unused exports/deps per KLOC: ~p75 of the measurable subset
  },
  floors: {
    god: 0, // a single god unit is already slop — no free allowance
    complexity: 0,
    duplication: 0.05, // corpus p25 ≈ 5%: unavoidable boilerplate, not slop
    deadCode: 0,
  },
};

/**
 * Default thresholds. First-pass calibrated on the 22-repo corpus (see
 * docs/thresholds.md); still flagged PRELIMINARY until validated against the
 * Stage-4 victim repo. The god gates are a conjunction (members AND clusters AND
 * complexity), so `minMembers` is kept sensitive — precision comes from the
 * cluster + complexity requirement, not from a high member floor.
 * Full reference: docs/configuration.md.
 */
export const DEFAULT_CONFIG: ResolvedConfig = {
  cognitiveComplexity: { enabled: true, threshold: 15 }, // count p95=13, p99=38; Sonar default
  // Two axes (OR): dispersion = several unrelated groups (clean split boundaries);
  // size = sheer bulk / high WMC (a monolith too big even if fully connected —
  // Marinescu's WMC signal). Size numbers ≈ corpus count p99.
  godModule: { enabled: true, minMembers: 15, minClusters: 3, minComplexity: 150, sizeMembers: 37, sizeComplexity: 350 },
  godClass: { enabled: true, minMembers: 12, minClusters: 3, minComplexity: 90, sizeMembers: 30, sizeComplexity: 200 },
  multipleExportedClasses: { enabled: true, maxPerFile: 1 },
  // Stage 2. minTokens 50 = Clone Alert's own default (PMD CPD family).
  // Type-1 clones (exact match) by default: identifier normalization (Type-2)
  // also matches structurally-similar boilerplate — on component libraries it
  // inflated the duplication ratio by 7pp (nest 15%→22.5%). Set
  // ignoreIdentifiers: true to hunt renamed copy-paste explicitly. minLines
  // keeps dense one-liners (config tables) from matching on tokens alone.
  duplicates: { enabled: true, minTokens: 50, minLines: 5, ignoreIdentifiers: false, ignoreLiterals: false },
  deadCode: {
    enabled: true,
    exports: true,
    dependencies: true,
    files: true,
    orphans: true,
    production: false,
  },
  knip: {},
  score: DEFAULT_SCORE,
  hubFanInRatio: 0.5,
  ignore: [],
  preliminary: true,
};

/**
 * User-facing config shape (`stopslop.json`). Every field optional and
 * deep-merged over defaults. A check accepts `false` to disable it, or a
 * partial object to override its thresholds.
 */
export interface StopSlopConfig {
  /** Editor-only pointer to the published StopSlop JSON Schema. */
  $schema?: string;
  cognitiveComplexity?: number | false;
  godModule?: Partial<Omit<GodGate, 'enabled'>> | false;
  godClass?: Partial<Omit<GodGate, 'enabled'>> | false;
  multipleExportedClasses?: Partial<Omit<MultiClassGate, 'enabled'>> | false;
  duplicates?: Partial<Omit<DuplicatesGate, 'enabled'>> | false;
  deadCode?: Partial<Omit<DeadCodeGate, 'enabled'>> | false;
  /** Complete JSON-compatible Knip config. Project-local Knip configs are ignored. */
  knip?: KnipConfiguration;
  score?: {
    weights?: Partial<ScoreSignals>;
    budgets?: Partial<ScoreSignals>;
    floors?: Partial<ScoreSignals>;
  };
  hubFanInRatio?: number;
  ignore?: string[];
}

function resolveCognitive(raw: number | false | undefined): CognitiveGate {
  if (raw === false) return { ...DEFAULT_CONFIG.cognitiveComplexity, enabled: false };
  return { enabled: true, threshold: raw ?? DEFAULT_CONFIG.cognitiveComplexity.threshold };
}

function resolveGod(raw: Partial<Omit<GodGate, 'enabled'>> | false | undefined, base: GodGate): GodGate {
  if (raw === false) return { ...base, enabled: false };
  return { ...base, ...raw, enabled: true };
}

function resolveMultiClass(
  raw: Partial<Omit<MultiClassGate, 'enabled'>> | false | undefined,
): MultiClassGate {
  const base = DEFAULT_CONFIG.multipleExportedClasses;
  if (raw === false) return { ...base, enabled: false };
  return { ...base, ...raw, enabled: true };
}

function resolveDuplicates(
  raw: Partial<Omit<DuplicatesGate, 'enabled'>> | false | undefined,
): DuplicatesGate {
  const base = DEFAULT_CONFIG.duplicates;
  if (raw === false) return { ...base, enabled: false };
  return { ...base, ...raw, enabled: true };
}

function resolveDeadCode(raw: Partial<Omit<DeadCodeGate, 'enabled'>> | false | undefined): DeadCodeGate {
  const base = DEFAULT_CONFIG.deadCode;
  if (raw === false) return { ...base, enabled: false };
  return { ...base, ...raw, enabled: true };
}

function resolveScore(raw: StopSlopConfig['score']): ScoreConfig {
  return {
    weights: { ...DEFAULT_SCORE.weights, ...raw?.weights },
    budgets: { ...DEFAULT_SCORE.budgets, ...raw?.budgets },
    floors: { ...DEFAULT_SCORE.floors, ...raw?.floors },
  };
}

export function resolveConfig(raw: StopSlopConfig | undefined): ResolvedConfig {
  const c = raw ?? {};
  return {
    cognitiveComplexity: resolveCognitive(c.cognitiveComplexity),
    godModule: resolveGod(c.godModule, DEFAULT_CONFIG.godModule),
    godClass: resolveGod(c.godClass, DEFAULT_CONFIG.godClass),
    multipleExportedClasses: resolveMultiClass(c.multipleExportedClasses),
    duplicates: resolveDuplicates(c.duplicates),
    deadCode: resolveDeadCode(c.deadCode),
    knip: c.knip ?? {},
    score: resolveScore(c.score),
    hubFanInRatio: c.hubFanInRatio ?? DEFAULT_CONFIG.hubFanInRatio,
    ignore: c.ignore ?? DEFAULT_CONFIG.ignore,
    preliminary: DEFAULT_CONFIG.preliminary,
  };
}

/** Load `stopslop.json` from `dir` (or an explicit path). Missing file → defaults. */
export function loadConfig(dir: string, explicitPath?: string): ResolvedConfig {
  const path = explicitPath ? resolve(explicitPath) : resolve(dir, 'stopslop.json');
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as StopSlopConfig;
    return resolveConfig(raw);
  } catch (err) {
    if (explicitPath) {
      throw new Error(`Cannot read config at ${path}: ${(err as Error).message}`);
    }
    return resolveConfig(undefined);
  }
}
