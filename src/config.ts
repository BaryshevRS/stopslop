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
 * Default thresholds calibrated on the 22-repo corpus (see
 * docs/thresholds.md). The god gates are a conjunction (members AND clusters AND
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
  preliminary: false,
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

type ConfigObject = Record<string, unknown>;
type PropertyValidator = (value: unknown, path: string) => void;

function invalidConfig(path: string, expectation: string): never {
  throw new Error(`Invalid config at ${path}: ${expectation}`);
}

function configObject(value: unknown, path: string): ConfigObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    invalidConfig(path, 'expected an object');
  }
  return value as ConfigObject;
}

function validateProperties(
  value: unknown,
  path: string,
  validators: Record<string, PropertyValidator>,
): void {
  const object = configObject(value, path);
  for (const [property, propertyValue] of Object.entries(object)) {
    const propertyPath = path === '$' ? property : `${path}.${property}`;
    const validate = validators[property];
    if (!validate) invalidConfig(propertyPath, 'unknown property');
    if (propertyValue !== undefined) validate(propertyValue, propertyPath);
  }
}

function validateNumber(value: unknown, path: string, minimum = 0, maximum?: number): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    invalidConfig(path, 'expected a finite number');
  }
  if (value < minimum || (maximum !== undefined && value > maximum)) {
    const range = maximum === undefined ? `at least ${minimum}` : `between ${minimum} and ${maximum}`;
    invalidConfig(path, `expected a number ${range}`);
  }
}

function validateBoolean(value: unknown, path: string): void {
  if (typeof value !== 'boolean') invalidConfig(path, 'expected a boolean');
}

function validateString(value: unknown, path: string): void {
  if (typeof value !== 'string') invalidConfig(path, 'expected a string');
}

function validateObjectOrFalse(
  value: unknown,
  path: string,
  validators: Record<string, PropertyValidator>,
): void {
  if (value !== false) validateProperties(value, path, validators);
}

const nonNegativeNumber: PropertyValidator = (value, path) => validateNumber(value, path);
const booleanValue: PropertyValidator = (value, path) => validateBoolean(value, path);

const godValidators: Record<string, PropertyValidator> = {
  minMembers: nonNegativeNumber,
  minClusters: nonNegativeNumber,
  minComplexity: nonNegativeNumber,
  sizeMembers: nonNegativeNumber,
  sizeComplexity: nonNegativeNumber,
};

const scoreSignalValidators: Record<string, PropertyValidator> = {
  god: nonNegativeNumber,
  complexity: nonNegativeNumber,
  duplication: nonNegativeNumber,
  deadCode: nonNegativeNumber,
};

function validateConfig(value: unknown): asserts value is StopSlopConfig | undefined {
  if (value === undefined) return;

  const topLevelValidators = {
    $schema: validateString,
    cognitiveComplexity: (entry, path) => {
      if (entry !== false) validateNumber(entry, path);
    },
    godModule: (entry, path) => validateObjectOrFalse(entry, path, godValidators),
    godClass: (entry, path) => validateObjectOrFalse(entry, path, godValidators),
    multipleExportedClasses: (entry, path) =>
      validateObjectOrFalse(entry, path, { maxPerFile: nonNegativeNumber }),
    duplicates: (entry, path) =>
      validateObjectOrFalse(entry, path, {
        minTokens: (nested, nestedPath) => validateNumber(nested, nestedPath, 1),
        minLines: (nested, nestedPath) => validateNumber(nested, nestedPath, 1),
        ignoreIdentifiers: booleanValue,
        ignoreLiterals: booleanValue,
      }),
    deadCode: (entry, path) =>
      validateObjectOrFalse(entry, path, {
        exports: booleanValue,
        dependencies: booleanValue,
        files: booleanValue,
        orphans: booleanValue,
        production: booleanValue,
      }),
    knip: (entry, path) => {
      configObject(entry, path);
    },
    score: (entry, path) =>
      validateProperties(entry, path, {
        weights: (nested, nestedPath) =>
          validateProperties(nested, nestedPath, scoreSignalValidators),
        budgets: (nested, nestedPath) =>
          validateProperties(nested, nestedPath, scoreSignalValidators),
        floors: (nested, nestedPath) =>
          validateProperties(nested, nestedPath, scoreSignalValidators),
      }),
    hubFanInRatio: (entry, path) => validateNumber(entry, path, 0, 1),
    ignore: (entry, path) => {
      if (!Array.isArray(entry)) invalidConfig(path, 'expected an array of strings');
      for (let index = 0; index < entry.length; index += 1) {
        validateString(entry[index], `${path}[${index}]`);
      }
    },
  } satisfies Record<keyof StopSlopConfig, PropertyValidator>;

  validateProperties(value, '$', topLevelValidators);
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
  validateConfig(raw);
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
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return resolveConfig(undefined);
    throw new Error(`Cannot read config at ${path}: ${(err as Error).message}`);
  }
}
