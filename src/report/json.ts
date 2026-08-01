import type { AnalyzeResult } from '../index.js';
import type { FindingKind } from '../types.js';

/**
 * 6: optional `gitBase` records the Git ref, resolved commit, and suppression counts.
 * 5: `thresholds.knip` records the embedded Knip configuration that ran.
 * 4: `slop.percentile` — share of the 41-repo reference corpus (src/corpus.ts)
 *    with a strictly lower core-signal score; `score.floors` in thresholds. Budgets
 *    recalibrated on that corpus (duplication 0.1→0.3, complexity 3→4), so
 *    scores are not comparable across this version boundary.
 * 3: `slop.level` top band renamed `severe` → `legacy-grade`; optional `baseline`
 *    field when a baseline is applied (findings then hold only the new ones).
 * 2: added slop score, LOC, and the Stage-2 finding kinds (clones, dead code).
 */
export const SCHEMA_VERSION = 6;

const KINDS: FindingKind[] = [
  'god-module',
  'god-class',
  'duplicate-code',
  'cognitive-complexity',
  'unused-export',
  'unused-dependency',
  'unused-file',
  'orphan-feature',
  'multiple-exported-classes',
];

/** Stable, versioned JSON for agents/CI. Sets replaced with sorted arrays. */
export function toJson(result: AnalyzeResult): string {
  return JSON.stringify(
    {
      schemaVersion: SCHEMA_VERSION,
      tool: 'stopslop',
      engines: { duplicates: 'clone-alert', deadCode: 'knip' },
      root: result.root,
      fileCount: result.fileCount,
      loc: result.loc,
      elapsedMs: result.elapsedMs,
      preliminaryThresholds: result.config.preliminary,
      slop: result.slop,
      // Present only under --baseline: the score above is the full honest state;
      // `findings` below hold only what is new since the baseline was recorded.
      ...(result.baselineSuppressed === undefined
        ? {}
        : { baseline: { suppressed: result.baselineSuppressed, new: result.findings.length } }),
      ...(result.gitBase === undefined
        ? {}
        : { gitBase: { ...result.gitBase, new: result.findings.length } }),
      thresholds: {
        cognitiveComplexity: result.config.cognitiveComplexity,
        godModule: result.config.godModule,
        godClass: result.config.godClass,
        multipleExportedClasses: result.config.multipleExportedClasses,
        duplicates: result.config.duplicates,
        deadCode: result.config.deadCode,
        knip: result.config.knip,
        score: result.config.score,
        hubFanInRatio: result.config.hubFanInRatio,
      },
      summary: summarize(result),
      findings: result.findings,
      notes: result.notes,
      errors: result.errors,
    },
    null,
    2,
  );
}

function summarize(result: AnalyzeResult): Record<string, number> {
  const counts: Record<string, number> = Object.fromEntries(KINDS.map((k) => [k, 0]));
  for (const f of result.findings) counts[f.kind] = (counts[f.kind] ?? 0) + 1;
  return counts;
}
