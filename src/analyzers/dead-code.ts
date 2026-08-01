import { existsSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import type { Issue, Issues } from 'knip/session';
import type { KnipConfiguration } from 'knip';
import type { Analyzer, DeadCodeGate, Finding, ProjectContext } from '../types.js';
import { createKnipOptions } from '../knip-options.js';
import { findOrphanFeatures } from './orphan-features.js';

// Dead code. The engine is Knip, driven through its programmatic session API
// (`knip/session`) — no CLI spawn, no output parsing. stopslop.json#knip is the
// sole Knip configuration source; project Knip configs are never discovered.
//
// Conservative by design (ARCH.md): unused exports and unused dependencies are
// reported as warnings; unused *files* depend on entry-point detection, which
// misfires on projects with unconventional entries, so they are info-level and
// carry that caveat in the message.

export function deadCodeAnalyzer(): Analyzer {
  return {
    name: 'dead-code',
    async analyzeProject(ctx: ProjectContext): Promise<Finding[]> {
      const gate = ctx.config.deadCode;
      if (!gate.enabled) return [];

      const packageRoot = findPackageRoot(ctx.root);
      if (!packageRoot) {
        ctx.notes.push('dead code: skipped, no package.json above the analyzed path');
        return [];
      }
      // Without an install, Knip cannot resolve a single import: every declared
      // dependency comes back "unused" and every file "unreachable". That is not
      // a finding, that is a broken run — refuse it instead of reporting noise.
      if (needsInstall(packageRoot)) {
        ctx.notes.push('dead code: skipped, dependencies are not installed (run your package manager first)');
        return [];
      }

      let issues: Issues;
      let orphans: Finding[] = [];
      const engineErrors: string[] = [];
      const restore = captureConsole(engineErrors);
      try {
        const { createSession } = await import('knip/session');
        const options = await createKnipOptions(packageRoot, ctx.config, {
          isProduction: gate.production,
        });
        const session = await createSession(options);
        issues = session.getResults().issues;
        // Orphans come from the same session's module graph, not a second run:
        // `describeFile` answers who imports each export, which is exactly the
        // question, and answers it through Knip's own resolution of barrels and
        // re-exports rather than by matching text.
        if (gate.orphans) {
          orphans = findOrphanFeatures({
            root: ctx.root,
            files: ctx.files,
            describeFile: (absPath) => session.describeFile(absPath),
          });
        }
      } catch (err) {
        ctx.notes.push(`dead code: knip failed (${(err as Error).message})`);
        return [];
      } finally {
        restore();
      }
      // Knip logs plugin/config-loading failures straight to the console. They
      // are its diagnostics, not our report — summarize, don't spray.
      if (engineErrors.length > 0) {
        ctx.notes.push(
          `dead code: knip reported ${engineErrors.length} config-loading error(s) — results may be incomplete (run with knip directly to see them)`,
        );
      }

      // On an unconfigured monorepo the results are reported but not scored:
      // leaving `deadCodeMeasured` unset drops the signal from the score
      // denominator instead of counting the noise against the repo.
      if (isUnconfiguredMonorepo(packageRoot, ctx.config.knip)) {
        ctx.notes.push(
          'dead code: monorepo without stopslop.json#knip.workspaces — findings shown but excluded from the score (configure workspaces and entry points under knip in stopslop.json to make them count)',
        );
      } else {
        ctx.metrics.deadCodeMeasured = true;
      }

      // Only files we analyzed ourselves: keeps Knip's view of the project in
      // step with our ignore rules (tests, generated code, bundles).
      const analyzed = new Set(ctx.files.map((f) => f.relPath));
      return [...mapIssues(issues, { root: ctx.root, gate, analyzed }), ...orphans];
    },
  };
}

export interface MapOptions {
  root: string;
  gate: DeadCodeGate;
  /** Relative paths of the files stopslop itself analyzed. */
  analyzed: Set<string>;
}

/** Translate Knip's issue records into findings. Pure — the unit under test. */
export function mapIssues(issues: Issues, options: MapOptions): Finding[] {
  const { gate } = options;
  const findings: Finding[] = [];

  if (gate.exports) {
    // `types` = unused exported types; same class of problem as `exports`.
    for (const issue of flatten(issues.exports, issues.types)) {
      const file = toRelative(issue.filePath, options.root);
      if (!file || !options.analyzed.has(file)) continue;
      findings.push({
        kind: 'unused-export',
        file,
        symbol: issue.symbol,
        line: issue.line ?? 1,
        severity: 'warn',
        message: `unused export \`${issue.symbol}\`${issue.symbolType ? ` (${issue.symbolType})` : ''}`,
        data: { symbolType: issue.symbolType },
      });
    }
  }

  if (gate.dependencies) {
    for (const issue of flatten(issues.dependencies, issues.devDependencies)) {
      // The finding lives in package.json, which may sit above the analyzed
      // path — report it relative anyway, an unused dependency is still slop.
      const file = toRelative(issue.filePath, options.root, { allowOutside: true }) ?? 'package.json';
      findings.push({
        kind: 'unused-dependency',
        file,
        symbol: issue.symbol,
        line: issue.line ?? 1,
        severity: 'warn',
        message: `unused dependency \`${issue.symbol}\``,
        data: { dev: issue.type === 'devDependencies' },
      });
    }
  }

  if (gate.files) {
    for (const issue of flatten(issues.files)) {
      const file = toRelative(issue.filePath, options.root);
      if (!file || !options.analyzed.has(file)) continue;
      findings.push({
        kind: 'unused-file',
        file,
        symbol: file,
        line: 1,
        severity: 'info',
        message: 'file is not reachable from any entry point',
        data: { caveat: 'depends on entry-point detection — verify before deleting' },
      });
    }
  }

  return findings;
}

function* flatten(...records: Issues[keyof Issues][]): Generator<Issue> {
  for (const record of records) {
    for (const bySymbol of Object.values(record)) {
      yield* Object.values(bySymbol);
    }
  }
}

/** Absolute path → path relative to root (POSIX). Outside root → undefined. */
function toRelative(
  absPath: string,
  root: string,
  options: { allowOutside?: boolean } = {},
): string | undefined {
  const rel = relative(root, absPath).split(sep).join('/');
  if (!options.allowOutside && (rel.startsWith('../') || rel === '')) return undefined;
  return rel;
}

const WORKSPACE_MARKERS = ['nx.json', 'pnpm-workspace.yaml', 'lerna.json', 'turbo.json'];

/**
 * A monorepo whose Knip run is unconfigured. Knip needs to know the workspaces
 * and their entry points; without that it calls an app's own `main.ts`
 * unreachable and every workspace tool an unused dependency. The findings can
 * still be worth a look, but they must not feed the score — a landslide of
 * false positives would otherwise outrank real structural slop.
 */
export function isUnconfiguredMonorepo(
  packageRoot: string,
  knipConfig?: KnipConfiguration,
): boolean {
  if (knipConfig?.workspaces !== undefined) return false;
  try {
    const pkg = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8')) as {
      workspaces?: unknown;
    };
    if (pkg.workspaces !== undefined) return true;
  } catch {
    // fall through to marker files
  }
  const hasMarker = WORKSPACE_MARKERS.some((f) => existsSync(resolve(packageRoot, f)));
  // This helper is normally called only after finding a package.json. If the
  // manifest disappeared or is unreadable, stay conservative and do not score
  // the run as a configured single-package project.
  return hasMarker || !existsSync(resolve(packageRoot, 'package.json'));
}

/** True when package.json declares dependencies but node_modules is absent. */
function needsInstall(packageRoot: string): boolean {
  if (existsSync(resolve(packageRoot, 'node_modules'))) return false;
  try {
    const pkg = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const declared =
      Object.keys(pkg.dependencies ?? {}).length + Object.keys(pkg.devDependencies ?? {}).length;
    return declared > 0;
  } catch {
    return false; // unreadable package.json — let Knip have its say
  }
}

/** Silence console output for the duration of a call, collecting it instead. */
function captureConsole(sink: string[]): () => void {
  const { error, warn, log } = console;
  const collect =
    (...args: unknown[]): void => void sink.push(args.map(String).join(' '));
  console.error = collect;
  console.warn = collect;
  console.log = collect;
  return () => {
    console.error = error;
    console.warn = warn;
    console.log = log;
  };
}

/** Nearest ancestor directory (inclusive) holding a package.json. */
function findPackageRoot(from: string): string | undefined {
  let dir = resolve(from);
  for (;;) {
    if (existsSync(resolve(dir, 'package.json'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}
