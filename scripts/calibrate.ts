/**
 * Threshold calibration over a benchmark corpus, following Alves/Ypma/Visser
 * (ICSM 2010): pool every metric observation across a MIXED corpus, weight each
 * by LOC, and read thresholds off high percentiles of the weighted distribution.
 *
 * Usage: pnpm calibrate [corpusDir]
 * Default corpusDir: /Users/rock/Projects/clone-alert/bench/repos
 *
 * Writes docs/thresholds.md. Does NOT auto-edit defaults — a human copies the
 * recommended numbers into src/config.ts after reviewing the distribution.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { discover } from '../src/discover.js';
import { parseFile } from '../src/parse.js';
import { computeCognitiveComplexity, collectFunctions } from '../src/analyzers/cognitive-complexity.js';
import { extractClasses, extractModule } from '../src/analyzers/members.js';
import { computeCohesion } from '../src/analyzers/cohesion.js';
import type { CohesionUnit, OxcNode } from '../src/types.js';

interface Obs {
  value: number;
  weight: number; // LOC
}

const complexityOf = (n: OxcNode): number => computeCognitiveComplexity(n);

function substantiveGroups(unit: CohesionUnit): number {
  const { clusters } = computeCohesion(unit.members, 0.5);
  return clusters.filter((c) => c.length >= 2).length;
}
function fnCount(unit: CohesionUnit): number {
  return unit.members.filter((m) => m.kind === 'function').length;
}
function totalComplexity(unit: CohesionUnit): number {
  return unit.members.reduce((s, m) => s + m.complexity, 0);
}
function unitLoc(unit: CohesionUnit): number {
  return Math.max(1, unit.members.reduce((s, m) => s + m.loc, 0));
}

function percentile(obs: Obs[], p: number, loc: boolean): number {
  if (obs.length === 0) return 0;
  const sorted = [...obs].sort((a, b) => a.value - b.value);
  const total = sorted.reduce((s, o) => s + (loc ? o.weight : 1), 0);
  const target = total * p;
  let acc = 0;
  for (const o of sorted) {
    acc += loc ? o.weight : 1;
    if (acc >= target) return o.value;
  }
  return sorted[sorted.length - 1]!.value;
}
/** Count-based percentile (each entity = 1) — "flag the worst N% of entities". */
const cp = (obs: Obs[], p: number): number => Math.round(percentile(obs, p, false));
/** LOC-weighted percentile (Alves) — "N% of code volume sits below". */
const lp = (obs: Obs[], p: number): number => Math.round(percentile(obs, p, true));

const PCTS = [0.5, 0.75, 0.9, 0.95, 0.99];

function row(name: string, obs: Obs[], loc: boolean): string {
  const cells = PCTS.map((p) => String(loc ? lp(obs, p) : cp(obs, p)));
  return `| ${name} | ${obs.length} | ${cells.join(' | ')} |`;
}

function main(): void {
  const corpusDir = resolve(process.argv[2] ?? '/Users/rock/Projects/clone-alert/bench/repos');
  const repos = readdirSync(corpusDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  const fnComplexity: Obs[] = [];
  const classMembers: Obs[] = [];
  const classGroups: Obs[] = [];
  const classComplexity: Obs[] = [];
  const moduleMembers: Obs[] = [];
  const moduleGroups: Obs[] = [];
  const moduleComplexity: Obs[] = [];

  let totalFiles = 0;
  const perRepo: string[] = [];

  for (const repo of repos) {
    const root = resolve(corpusDir, repo);
    try {
      if (!statSync(root).isDirectory()) continue;
    } catch {
      continue;
    }
    const files = discover(root, { ignore: [] });
    let repoFiles = 0;
    for (const abs of files) {
      let source: string;
      try {
        source = readFileSync(abs, 'utf8');
      } catch {
        continue;
      }
      const { file } = parseFile(abs, abs, source);
      if (!file) continue;
      repoFiles++;
      totalFiles++;

      for (const fn of collectFunctions(file)) {
        const loc = file.lineAt(fn.node.end) - file.lineAt(fn.node.start) + 1;
        fnComplexity.push({ value: fn.complexity, weight: Math.max(1, loc) });
      }

      const mod = extractModule(file, complexityOf);
      const modFns = fnCount(mod);
      if (modFns >= 5) {
        const w = unitLoc(mod);
        moduleMembers.push({ value: modFns, weight: w });
        moduleGroups.push({ value: substantiveGroups(mod), weight: w });
        moduleComplexity.push({ value: totalComplexity(mod), weight: w });
      }

      for (const cls of extractClasses(file, complexityOf)) {
        const n = fnCount(cls);
        if (n < 3) continue;
        const w = unitLoc(cls);
        classMembers.push({ value: n, weight: w });
        classGroups.push({ value: substantiveGroups(cls), weight: w });
        classComplexity.push({ value: totalComplexity(cls), weight: w });
      }
    }
    perRepo.push(`- ${repo}: ${repoFiles} files`);
  }

  const header = `| metric | n | p50 | p75 | p90 | p95 | p99 |\n|---|---|---|---|---|---|---|`;
  const table = (loc: boolean): string => `### Function
${header}
${row('cognitive complexity', fnComplexity, loc)}

### Class (≥3 methods)
${header}
${row('methods', classMembers, loc)}
${row('responsibility groups (≥2)', classGroups, loc)}
${row('Σ cognitive complexity', classComplexity, loc)}

### Module (≥5 top-level fns)
${header}
${row('top-level definitions', moduleMembers, loc)}
${row('responsibility groups (≥2)', moduleGroups, loc)}
${row('Σ cognitive complexity', moduleComplexity, loc)}`;

  // Recommendations from COUNT percentiles: a "god" finding should be the worst
  // ~1% of entities. cognitiveComplexity keeps a floor at the Sonar default 15
  // (count p95 of per-function complexity runs below it — most functions are
  // trivial — so we don't want to relax below the community default).
  const recCognitive = Math.max(15, cp(fnComplexity, 0.95));
  const md = `# Threshold calibration

Two lenses on the same corpus:

- **Count percentiles** — each entity counts once. "pXX = N" means XX% of
  entities score ≤ N. This is what we use for defaults: a god finding should be
  the worst ~1–5% of entities.
- **LOC-weighted percentiles** — the Alves/Ypma/Visser (ICSM 2010) methodology:
  each entity weighted by LOC, so "pXX = N" means XX% of *code volume* sits in
  entities ≤ N. Kept for reference; it skews high because large entities are
  both more complex and hold more volume.

Corpus: \`${corpusDir}\` — ${repos.length} repos, ${totalFiles} analyzed files
(tests, fixtures, generated and bundled code excluded).

## Count percentiles (basis for defaults)

${table(false)}

## LOC-weighted percentiles (Alves, reference)

${table(true)}

## Recommended defaults

A god finding should be rare by construction — around count p95–p99.

| setting | count p95 | count p99 | recommended |
|---|---|---|---|
| \`cognitiveComplexity\` | ${cp(fnComplexity, 0.95)} | ${cp(fnComplexity, 0.99)} | **${recCognitive}** (Sonar-floored) |
| \`godClass.minMembers\` | ${cp(classMembers, 0.95)} | ${cp(classMembers, 0.99)} | **${cp(classMembers, 0.95)}** |
| \`godClass.minComplexity\` | ${cp(classComplexity, 0.95)} | ${cp(classComplexity, 0.99)} | **${cp(classComplexity, 0.95)}** |
| \`godModule.minMembers\` | ${cp(moduleMembers, 0.95)} | ${cp(moduleMembers, 0.99)} | **${cp(moduleMembers, 0.95)}** |
| \`godModule.minComplexity\` | ${cp(moduleComplexity, 0.95)} | ${cp(moduleComplexity, 0.99)} | **${cp(moduleComplexity, 0.95)}** |

\`minClusters\` stays at **3** for both: the group split (≥2 members) already makes
extra groups rare, and 3 unrelated responsibility groups is the smallest count
that reads as "this should be several units."

## Per-repo file counts
${perRepo.join('\n')}
`;

  const outPath = resolve('docs/thresholds.md');
  writeFileSync(outPath, md);
  process.stdout.write(`wrote ${outPath}\n`);
  process.stdout.write(md.split('## Recommended defaults')[1] ?? '');
}

main();
