#!/usr/bin/env node
// Coding-agent hook, run when the agent is about to end its turn. Check whether
// the uncommitted changes added slop, and if they did, hand the findings back
// while the code is still in front of the agent rather than in a review later.
//
// It reports only what the changes added — findings absent from
// .stopslop-baseline.json when the project gates on one, otherwise absent from
// HEAD — so legacy never blocks a turn. Turns that changed no JS/TS source cost
// one `git status`. Analysis errors never block: the gate is CI's job, this
// hook is feedback.
//
//   node stop-gate.mjs                  Claude Code (Stop), Codex (Stop), Gemini CLI (AfterAgent)
//   node stop-gate.mjs --agent cursor   Cursor (stop)

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const BASELINE = '.stopslop-baseline.json';
const RULES_DOC = 'https://github.com/BaryshevRS/stopslop/blob/main/docs/rules.md';
const SOURCE = /\.[cm]?[jt]sx?$|(?:^|\/)package\.json$/;
/** Findings listed in full; the rest are counted. Keeps the feedback short. */
const MAX_LISTED = 20;

/** How each agent hands the hook its turn and takes the feedback back. */
const AGENTS = {
  // Claude Code, Codex, and Gemini CLI share one protocol: the project in `cwd`,
  // a flag set once a hook already sent the agent back, and a block decision
  // whose reason the agent receives as its next instruction. Codex rejects any
  // other output field, so this is the whole answer.
  default: {
    root: (input) => input.cwd || process.cwd(),
    resumed: (input) => input.stop_hook_active === true,
    answer: (feedback) => ({ decision: 'block', reason: feedback }),
  },
  // Cursor runs plugin hooks from the plugin directory and names the project in
  // the environment. Only a turn that completed is checked: an aborted one was
  // the user's call, a failed one has nothing finished to review.
  cursor: {
    root: (input) => process.env.CURSOR_PROJECT_DIR ?? input.workspace_roots?.[0],
    resumed: (input) => input.status !== 'completed' || input.loop_count > 0,
    answer: (feedback) => ({ followup_message: feedback }),
  },
};

/** The feedback for the agent, or undefined to let it end the turn. */
function gate(root) {
  if (!changesSource(root)) return undefined;

  const mode = existsSync(join(root, BASELINE))
    ? { args: ['--baseline', BASELINE], what: `not in ${BASELINE}` }
    : { args: ['--base', 'HEAD'], what: 'added by the uncommitted changes' };
  const { status, stdout } = runStopslop(root, ['.', ...mode.args, '--format', 'json']);
  if (status !== 1) return undefined;

  let report;
  try {
    report = JSON.parse(stdout);
  } catch {
    return undefined;
  }
  if (!Array.isArray(report.findings) || report.findings.length === 0) return undefined;
  return feedback(report, mode);
}

/** True when Git shows a changed or new JS/TS source file or package.json. */
function changesSource(root) {
  const status = spawnSync('git', ['status', '--porcelain', '-z', '--untracked-files=all'], {
    cwd: root,
    encoding: 'utf8',
  });
  if (status.status !== 0) return false; // not a Git work tree: nothing to compare with
  // Each entry is "XY path"; a rename adds its old path as the next entry. Only
  // the extension matters, so the status prefix needs no parsing.
  return status.stdout.split('\0').some((entry) => SOURCE.test(entry));
}

function runStopslop(root, args) {
  // The project's own pinned version first — the one its CI runs.
  const local = join(root, 'node_modules', 'stopslop', 'dist', 'cli.js');
  const [command, prefix] = existsSync(local)
    ? [process.execPath, [local]]
    : ['npx', ['--yes', 'stopslop@1']];
  const result = spawnSync(command, [...prefix, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
    maxBuffer: 64 * 1024 * 1024,
    shell: command === 'npx' && process.platform === 'win32',
    timeout: 280_000,
  });
  return { status: result.status, stdout: result.stdout ?? '' };
}

function feedback(report, mode) {
  const { findings } = report;
  const rules = report.rules ?? {};
  const command = `npx stopslop . ${mode.args.join(' ')}`;
  const lines = [`StopSlop: ${plural(findings.length, 'finding')} ${mode.what} (\`${command}\`).`];

  const byKind = new Map();
  for (const finding of findings.slice(0, MAX_LISTED)) {
    if (!byKind.has(finding.kind)) byKind.set(finding.kind, []);
    byKind.get(finding.kind).push(finding);
  }
  for (const [kind, group] of byKind) {
    const rule = rules[kind];
    lines.push('', rule ? `${kind} — ${rule.summary}` : kind);
    for (const finding of group) {
      lines.push(`  ${finding.file}:${finding.line}  ${finding.message}${alsoAt(finding)}`);
    }
    if (rule) lines.push(`  How to fix: ${rule.fix}`);
  }
  if (findings.length > MAX_LISTED) {
    lines.push('', `${findings.length - MAX_LISTED} more not listed; \`${command} --json\` has all.`);
  }

  lines.push(
    '',
    'Fix these before ending the turn. If one should stay, tell the user which and why: ' +
      `accepting it into the reviewed ${BASELINE} is their decision, and raised thresholds ` +
      'or ignore globs are not a fix.',
    `Rule reference: ${RULES_DOC}`,
  );
  return lines.join('\n');
}

/** Other places a cloned block occurs: the finding's own line is the first. */
function alsoAt(finding) {
  const occurrences = finding.data?.occurrences;
  if (!Array.isArray(occurrences) || occurrences.length < 2) return '';
  const rest = occurrences.slice(1);
  const shown = rest.slice(0, 2).map((o) => `${o.file}:${o.startLine}-${o.endLine}`);
  const more = rest.length > shown.length ? ` +${rest.length - shown.length} more` : '';
  return `  (also ${shown.join(', ')}${more})`;
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

const flag = process.argv.indexOf('--agent');
const agent = AGENTS[flag === -1 ? 'default' : process.argv[flag + 1]] ?? AGENTS.default;
let input = {};
try {
  input = JSON.parse(readFileSync(0, 'utf8'));
} catch {
  // No readable input: behave as a turn with nothing to check.
}
// Already sent back once this turn: one nudge, so a finding the user decides to
// keep cannot loop the session.
if (!agent.resumed(input)) {
  const root = agent.root(input);
  const context = typeof root === 'string' && root !== '' ? gate(root) : undefined;
  if (context !== undefined) process.stdout.write(`${JSON.stringify(agent.answer(context))}\n`);
}
