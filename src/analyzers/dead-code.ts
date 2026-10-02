import { existsSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import type { Issue, Issues } from 'knip/session';
import type { Analyzer, ConfigHint, DeadCodeGate, Finding, ProjectContext } from '../types.js';
import { configFilePath } from '../config.js';
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

      // Where StopSlop reads its configuration from: the file `loadConfig` was
      // pointed at (`--config`), else the analyzed root's stopslop.json. Knip
      // words its hints against this path.
      const configFile = configFilePath(ctx.root, ctx.config);

      let issues: Issues;
      let configHints: ConfigHint[] = [];
      let orphans: Finding[] = [];
      const engineErrors: string[] = [];
      const restore = captureConsole(engineErrors);
      try {
        const { createSession, finalizeConfigurationHints } = await import('knip/session');
        const options = await createKnipOptions(packageRoot, ctx.config, {
          isProduction: gate.production,
        });
        const session = await createSession(options);
        const results = session.getResults();
        issues = results.issues;
        // Knip already knows what its configuration is missing: which entry
        // pattern matched nothing, which workspace it never reached, how many
        // files hang off each. Asking it beats inferring the same thing from
        // the outside — and telling it a config file exists is what keeps the
        // wording ours, since it then says "add entry" instead of naming
        // knip.json, which StopSlop does not read.
        configHints = toConfigHints(
          finalizeConfigurationHints(results, { cwd: packageRoot, configFilePath: configFile }),
        );
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

      ctx.configHints.push(...configHints);

      // Knip's own verdict on whether the run was configured at all: it raises
      // these two hints when unreachable files pass a share of the project that
      // only a missing entry or workspace configuration explains. Results from
      // such a run are reported but not scored — leaving `deadCodeMeasured`
      // unset drops the signal from the denominator instead of counting a
      // landslide of false positives against the repository.
      if (isUnconfigured(configHints)) {
        ctx.notes.push(
          `dead code: Knip reports this run as unconfigured — findings shown but excluded from the score (fix the config hints in ${relative(ctx.root, configFile).split(sep).join('/')})`,
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

/** Knip's two hints that mean "this run had no usable configuration". */
export function isUnconfigured(hints: ConfigHint[]): boolean {
  return hints.some(
    (hint) => hint.type === 'top-level-unconfigured' || hint.type === 'workspace-unconfigured',
  );
}

/** Knip's processed hints, narrowed to what a report needs. */
function toConfigHints(
  rows: {
    type: string;
    identifier: string | RegExp;
    message: string;
    workspaceName?: string;
    filePath?: string;
    size?: number;
  }[],
): ConfigHint[] {
  return rows.map((row) => ({
    type: row.type,
    identifier: row.identifier instanceof RegExp ? row.identifier.source : String(row.identifier),
    message: row.message,
    ...(row.workspaceName === undefined ? {} : { workspace: row.workspaceName }),
    ...(row.filePath === undefined ? {} : { filePath: row.filePath }),
    ...(row.size === undefined ? {} : { size: row.size }),
  }));
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
