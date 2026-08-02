#!/usr/bin/env node
import { analyze, analyzeGitBase } from './index.js';
import { loadConfig } from './config.js';
import { renderTerminal } from './report/terminal.js';
import { toJson } from './report/json.js';
import { toSarif } from './report/sarif.js';
import { toBadge } from './report/badge.js';
import { applyBaseline, readBaseline, writeBaseline } from './baseline.js';
import { assertAnalysisComplete } from './analysis-completeness.js';

type Format = 'text' | 'json' | 'sarif' | 'shields';

interface Args {
  path: string;
  format: Format;
  details: boolean;
  fast: boolean;
  config?: string;
  base?: string;
  baseline?: string;
  updateBaseline: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { path: '.', format: 'text', details: false, fast: false, updateBaseline: false, help: false };
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--json') args.format = 'json';
    else if (a === '--format') args.format = parseFormat(optionValue('--format', argv[++i]));
    else if (a.startsWith('--format='))
      args.format = parseFormat(optionValue('--format', a.slice('--format='.length)));
    else if (a === '--details' || a === '-d') args.details = true;
    else if (a === '--fast') args.fast = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--config') args.config = optionValue('--config', argv[++i]);
    else if (a.startsWith('--config='))
      args.config = optionValue('--config', a.slice('--config='.length));
    else if (a === '--base') args.base = optionValue('--base', argv[++i]);
    else if (a.startsWith('--base='))
      args.base = optionValue('--base', a.slice('--base='.length));
    else if (a === '--baseline') args.baseline = optionValue('--baseline', argv[++i]);
    else if (a.startsWith('--baseline='))
      args.baseline = optionValue('--baseline', a.slice('--baseline='.length));
    else if (a === '--update-baseline') args.updateBaseline = true;
    else if (a.startsWith('-')) throw new Error(`unknown option '${a}'`);
    else positional.push(a);
  }
  if (positional.length > 1) throw new Error('expected at most one path');
  if (positional[0]) args.path = positional[0];
  return args;
}

function optionValue(option: string, raw: string | undefined): string {
  if (!raw || raw.startsWith('-')) throw new Error(`${option} requires a value`);
  return raw;
}

function parseFormat(raw: string | undefined): Format {
  if (raw === 'text' || raw === 'json' || raw === 'sarif' || raw === 'shields') return raw;
  throw new Error(`unknown --format '${raw ?? ''}' (expected text, json, sarif, or shields)`);
}

const HELP = `stopslop — find AI-agent slop that linters miss

Usage:
  stopslop [path]            analyze a directory or file (default: .)

Options:
  --format <fmt>             text (default) · json · sarif · shields (badge JSON)
  --json                     alias for --format json
  --details, -d              show cluster composition, hubs, all clone sites
  --fast                     AST checks only: skip clones and dead code
  --config <file>            path to a stopslop.json config
  --base <ref>               gate only on findings absent from this Git revision
  --baseline <file>          gate only on findings not in this baseline file
  --update-baseline          write the current findings to --baseline and exit 0
  --help, -h                 show this help

Checks: complexity, god module/class (own) · clones (Clone Alert) · dead code (Knip)
Exit codes: 0 clean · 1 findings · 2 error

Baseline: adopt an existing repo's findings, then fail only on new ones.
  --base is mutually exclusive with --baseline and --update-baseline.
  stopslop . --base main                                            # gate vs Git
  stopslop . --baseline .stopslop-baseline.json --update-baseline   # record
  stopslop . --baseline .stopslop-baseline.json                     # gate on new`;

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(HELP + '\n');
    process.exit(0);
  }

  try {
    validateArgs(args);
    const config = loadConfig(args.path, args.config);
    if (args.fast) {
      config.duplicates.enabled = false;
      config.deadCode.enabled = false;
    }
    const result = args.base
      ? await analyzeGitBase(args.path, args.base, config)
      : await analyze(args.path, config);
    assertAnalysisComplete(result);

    // Record mode: write today's findings and leave. Independent of --format.
    if (args.updateBaseline) {
      writeBaseline(args.baseline!, result.findings);
      process.stderr.write(
        `stopslop: baseline written to ${args.baseline} (${result.findings.length} findings accepted)\n`,
      );
      process.exit(0);
    }

    // Gate mode: report and exit on findings NOT in the baseline. The score and
    // the badge stay the full, honest state — the baseline only gates.
    let reported = result;
    if (args.baseline) {
      const { kept, suppressed } = applyBaseline(result.findings, readBaseline(args.baseline));
      reported = { ...result, findings: kept, baselineSuppressed: suppressed };
    }

    if (args.format === 'json') {
      process.stdout.write(toJson(reported) + '\n');
    } else if (args.format === 'sarif') {
      process.stdout.write(toSarif(reported));
    } else if (args.format === 'shields') {
      // Badge generation, not a gate: emit the JSON and exit 0 so a CI step that
      // regenerates the badge never fails on findings (clone-alert parity uses
      // --no-fail-on-violation for this; here the format implies it). Uses the
      // full result — the badge is never gated by a baseline.
      process.stdout.write(toBadge(result));
      process.exit(0);
    } else {
      process.stdout.write(renderTerminal(reported, args.details) + '\n');
    }
    process.exit(reported.findings.length > 0 ? 1 : 0);
  } catch (err) {
    process.stderr.write('stopslop: ' + (err as Error).message + '\n');
    process.exit(2);
  }
}

function validateArgs(args: Args): void {
  if (args.base && (args.baseline || args.updateBaseline)) {
    throw new Error('--base is mutually exclusive with --baseline and --update-baseline');
  }
  if (args.updateBaseline && !args.baseline) {
    throw new Error('--update-baseline requires --baseline <file>');
  }
}

main().catch((err: unknown) => {
  process.stderr.write('stopslop: ' + (err as Error).message + '\n');
  process.exit(2);
});
