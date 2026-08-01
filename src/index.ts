import { execFile } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import type { Analyzer, Finding, ParsedFile, ProjectMetrics, ResolvedConfig } from './types.js';
import { applyBaseline, fingerprint } from './baseline.js';
import { discover } from './discover.js';
import { parseFile } from './parse.js';
import { cognitiveComplexityAnalyzer } from './analyzers/cognitive-complexity.js';
import { structureAnalyzer } from './analyzers/detectors.js';
import { duplicatesAnalyzer } from './analyzers/duplicates.js';
import { deadCodeAnalyzer } from './analyzers/dead-code.js';
import { computeScore, type SlopScore } from './score.js';

export type { Analyzer, Finding, ResolvedConfig, ParsedFile } from './types.js';
export { loadConfig, resolveConfig, DEFAULT_CONFIG, type StopSlopConfig } from './config.js';
export { computeScore, levelFor, type SlopScore, type SlopLevel } from './score.js';
export {
  fingerprint,
  readBaseline,
  writeBaseline,
  applyBaseline,
  type BaselineRecord,
} from './baseline.js';

export interface AnalyzeResult {
  root: string;
  fileCount: number;
  /** Physical lines across the analyzed files. */
  loc: number;
  findings: Finding[];
  slop: SlopScore;
  metrics: Partial<ProjectMetrics>;
  errors: string[];
  /** Non-fatal notes from the Stage-2 engines (skipped checks, and why). */
  notes: string[];
  config: ResolvedConfig;
  elapsedMs: number;
  /**
   * When a baseline is applied, how many findings it suppressed (accepted
   * legacy). `findings` then holds only the new ones. Unset without a baseline.
   * The slop score is always the full, honest state and is never gated.
   */
  baselineSuppressed?: number;
  /** Git revision used as a temporary baseline for this analysis. */
  gitBase?: {
    ref: string;
    commit: string;
    suppressed: number;
  };
}

const execFileAsync = promisify(execFile);

/** File-level (Stage 1) plus project-level (Stage 2: Clone Alert, Knip) analyzers. */
export function defaultAnalyzers(): Analyzer[] {
  return [
    cognitiveComplexityAnalyzer(),
    structureAnalyzer(),
    duplicatesAnalyzer(),
    deadCodeAnalyzer(),
  ];
}

export async function analyze(
  root: string,
  config: ResolvedConfig,
  analyzers: Analyzer[] = defaultAnalyzers(),
): Promise<AnalyzeResult> {
  const start = performance.now();
  // Symlinks are resolved too, not just relative segments. Knip keys its module
  // graph by real paths: run it under a symlinked root — `/tmp` is
  // `/private/tmp` on macOS — and it reaches nothing, calling every file unused
  // and leaving the graph empty.
  const absRoot = realPath(resolve(root));
  const files = discover(absRoot, { ignore: config.ignore });
  const parsed: ParsedFile[] = [];
  const errors: string[] = [];
  const notes: string[] = [];
  const findings: Finding[] = [];
  const metrics: Partial<ProjectMetrics> = {};
  const ctx = { config };
  let loc = 0;

  for (const abs of files) {
    let source: string;
    try {
      source = readFileSync(abs, 'utf8');
    } catch (err) {
      errors.push(`read failed: ${abs}: ${(err as Error).message}`);
      continue;
    }
    const relPath = relative(absRoot, abs).split(sep).join('/');
    const result = parseFile(relPath, abs, source);
    if (!result.file) {
      errors.push(...result.errors);
      continue;
    }
    parsed.push(result.file);
    loc += countLines(source);
    for (const analyzer of analyzers) {
      if (analyzer.analyzeFile) {
        try {
          findings.push(...analyzer.analyzeFile(result.file, ctx));
        } catch (err) {
          errors.push(`${analyzer.name} failed on ${relPath}: ${(err as Error).message}`);
        }
      }
    }
  }

  const projectCtx = { root: absRoot, files: parsed, config, notes, metrics };
  for (const analyzer of analyzers) {
    if (!analyzer.analyzeProject) continue;
    try {
      findings.push(...(await analyzer.analyzeProject(projectCtx)));
    } catch (err) {
      errors.push(`${analyzer.name} failed: ${(err as Error).message}`);
    }
  }

  sortFindings(findings);
  return {
    root: absRoot,
    fileCount: parsed.length,
    loc,
    findings,
    slop: computeScore({ findings, loc, metrics, config }),
    metrics,
    errors,
    notes,
    config,
    elapsedMs: Math.round(performance.now() - start),
  };
}

/** Gate the current working tree against findings present at a Git revision. */
export async function analyzeGitBase(
  root: string,
  baseRef: string,
  config: ResolvedConfig,
  analyzers: Analyzer[] = defaultAnalyzers(),
): Promise<AnalyzeResult> {
  const absRoot = realPath(resolve(root));
  const gitCwd = existsSync(absRoot) && !statSync(absRoot).isDirectory() ? dirname(absRoot) : absRoot;
  const repositoryRoot = realPath(
    (
      await runGit(gitCwd, ['rev-parse', '--show-toplevel'], 'find the Git repository root')
    ).trim(),
  );
  const rootWithinRepository = relative(repositoryRoot, absRoot);
  const commit = (
    await runGit(
      repositoryRoot,
      ['rev-parse', '--verify', '--end-of-options', `${baseRef}^{commit}`],
      `resolve Git base ${JSON.stringify(baseRef)}`,
    )
  ).trim();
  if (!commit) throw new Error(`Failed to resolve Git base ${JSON.stringify(baseRef)}: empty commit`);

  const current = await analyze(absRoot, config, analyzers);
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'stop-slop-git-base-'));
  const worktreeRoot = join(temporaryRoot, 'worktree');
  let worktreeAdded = false;
  let operationFailed = false;

  try {
    await runGit(
      repositoryRoot,
      ['worktree', 'add', '--detach', worktreeRoot, commit],
      `create temporary worktree for ${JSON.stringify(baseRef)}`,
    );
    worktreeAdded = true;

    const baseRoot = resolve(worktreeRoot, rootWithinRepository);
    await linkDependencyContext(repositoryRoot, worktreeRoot);
    if (absRoot !== repositoryRoot) await linkDependencyContext(absRoot, baseRoot);
    const base = await analyze(baseRoot, config, analyzers);
    if (base.errors.length > 0) {
      throw new Error(`Git base analysis failed: ${base.errors.join('; ')}`);
    }
    const accepted = new Set(base.findings.map(fingerprint));
    const { kept, suppressed } = applyBaseline(current.findings, accepted);

    return {
      ...current,
      findings: kept,
      gitBase: { ref: baseRef, commit, suppressed },
    };
  } catch (error) {
    operationFailed = true;
    throw error;
  } finally {
    let cleanupError: unknown;
    try {
      await runGit(
        repositoryRoot,
        ['worktree', 'remove', '--force', worktreeRoot],
        'remove temporary Git worktree',
      );
    } catch (error) {
      // A failed `worktree add` may or may not have registered the path. If it
      // did complete, cleanup failure is material; otherwise there is nothing
      // registered to remove and the original error is the useful one.
      if (worktreeAdded) cleanupError = error;
    }
    try {
      await rm(temporaryRoot, { recursive: true, force: true });
    } catch (error) {
      cleanupError ??= error;
    }
    if (cleanupError && !operationFailed) throw cleanupError;
  }
}

/** Give base analyzers the installed/generated context without copying it. */
async function linkDependencyContext(currentRoot: string, baseRoot: string): Promise<void> {
  for (const name of ['node_modules', '.nuxt', '.astro']) {
    const source = join(currentRoot, name);
    const target = join(baseRoot, name);
    if (existsSync(source) && !existsSync(target)) await symlink(source, target, 'junction');
  }
}

async function runGit(cwd: string, args: string[], action: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
    return stdout;
  } catch (error) {
    const failure = error as Error & { stderr?: string };
    const detail = failure.stderr?.trim() || failure.message;
    throw new Error(`Failed to ${action}: ${detail}`);
  }
}

/** Physical lines; a trailing newline does not add one. */
function countLines(source: string): number {
  if (source.length === 0) return 0;
  let lines = 1;
  for (let i = 0; i < source.length; i++) {
    if (source.charCodeAt(i) === 10 && i !== source.length - 1) lines++;
  }
  return lines;
}

/** Resolved path, or the input when it does not exist — discover reports that. */
function realPath(absPath: string): string {
  try {
    return realpathSync.native(absPath);
  } catch {
    return absPath;
  }
}

const KIND_ORDER: Record<Finding['kind'], number> = {
  'god-module': 0,
  'god-class': 1,
  'duplicate-code': 2,
  'cognitive-complexity': 3,
  // Leads the dead-code group: the only one of them that names exactly what to
  // delete, so it should not be buried under a list of plain unused exports.
  'orphan-feature': 4,
  'unused-export': 5,
  'unused-dependency': 6,
  'unused-file': 7,
  'multiple-exported-classes': 8,
};

function sortFindings(findings: Finding[]): void {
  // Group by kind (god signals lead), then by internal severity within the kind.
  findings.sort((a, b) => {
    const k = KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
    if (k !== 0) return k;
    const sev = severityRank(b) - severityRank(a);
    if (sev !== 0) return sev;
    if (a.file !== b.file) return a.file.localeCompare(b.file);
    return a.line - b.line;
  });
}
function severityRank(f: Finding): number {
  if (f.kind === 'cognitive-complexity') return (f.data?.complexity as number) ?? 0;
  // Clones: the bigger the copied span, the worse.
  if (f.kind === 'duplicate-code') return (f.data?.tokenCount as number) ?? 0;
  // god findings: rank by WMC (total complexity) — works for both axes.
  return (f.data?.totalComplexity as number) ?? (f.data?.groupCount as number) ?? 1;
}
