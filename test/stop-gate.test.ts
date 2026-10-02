import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

// The hook runs the way Claude Code runs it: a process reading the Stop input on
// stdin. The fixture's node_modules/stopslop/dist/cli.js stands in for the
// project's pinned install, which the hook prefers over npx.

const projectRoot = process.cwd();
const hook = join(projectRoot, 'hooks', 'stop-gate.mjs');
const fixtures: string[] = [];

afterEach(() => {
  for (const dir of fixtures.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function git(root: string, ...args: string[]) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
}

/** A Git work tree with one committed source file. */
function repository(): string {
  const root = mkdtempSync(join(tmpdir(), 'stop-slop-hook-'));
  fixtures.push(root);
  git(root, 'init');
  writeFileSync(join(root, 'sample.ts'), 'export const stable = 1;\n');
  git(root, 'add', 'sample.ts');
  git(root, '-c', 'user.name=Stop Slop Test', '-c', 'user.email=stop-slop@example.test', 'commit', '-m', 'base');
  return root;
}

/** Installs `source` as the project's stopslop CLI. */
function installCli(root: string, source: string) {
  const dir = join(root, 'node_modules', 'stopslop', 'dist');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'cli.js'), source);
}

/** A stand-in CLI that records its arguments and prints a canned report. */
function fakeCli(root: string, status: number, report: unknown) {
  installCli(
    root,
    `import { writeFileSync } from 'node:fs';
writeFileSync(${JSON.stringify(join(root, 'cli-args.json'))}, JSON.stringify(process.argv.slice(2)));
process.stdout.write(${JSON.stringify(JSON.stringify(report))});
process.exit(${status});
`,
  );
}

/** Forwards to this checkout's CLI, so the hook reads a real report. */
function realCli(root: string) {
  const tsx = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;
  const cli = join(projectRoot, 'src', 'cli.ts');
  installCli(
    root,
    `import { spawnSync } from 'node:child_process';
const args = [${JSON.stringify('--import')}, ${JSON.stringify(tsx)}, ${JSON.stringify(cli)}, ...process.argv.slice(2), '--fast'];
const result = spawnSync(process.execPath, args, { stdio: 'inherit' });
process.exit(result.status ?? 2);
`,
  );
}

interface HookAnswer {
  decision?: string;
  reason?: string;
  followup_message?: string;
}

function runHook(input: Record<string, unknown>, args: string[] = [], env = {}): HookAnswer | undefined {
  const inherited = { ...process.env };
  delete inherited.CURSOR_PROJECT_DIR; // the test's own Cursor session, if any
  const result = spawnSync(process.execPath, [hook, ...args], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: { ...inherited, ...env },
  });
  expect(result.status).toBe(0);
  return result.stdout.trim() === '' ? undefined : (JSON.parse(result.stdout) as HookAnswer);
}

/** What a Claude Code, Codex, or Gemini CLI hook hands back: a block decision. */
function feedback(input: Record<string, unknown>): string | undefined {
  const answer = runHook({ hook_event_name: 'Stop', ...input });
  if (answer === undefined) return undefined;
  // Codex rejects any field beyond its schema, so the answer carries nothing else.
  expect(Object.keys(answer).sort()).toEqual(['decision', 'reason']);
  expect(answer.decision).toBe('block');
  return answer.reason;
}

const tangled = Array.from({ length: 30 }, (_, i) => `if (value === ${i}) score += ${i};`).join(' ');

function finding(index: number) {
  return {
    kind: 'cognitive-complexity',
    file: `src/f${index}.ts`,
    symbol: `f${index}`,
    line: index + 1,
    severity: 'warn',
    message: `f${index} has cognitive complexity 30 (threshold 15)`,
  };
}

describe('agent stop hook', () => {
  it('gives the agent the findings its uncommitted changes added, with the fix', () => {
    const root = repository();
    realCli(root);
    writeFileSync(
      join(root, 'sample.ts'),
      `export const stable = 1;\nexport function tangled(value: number) { let score = 0; ${tangled} return score; }\n`,
    );

    const context = feedback({ cwd: root, stop_hook_active: false });

    expect(context).toContain('StopSlop: 1 finding added by the uncommitted changes');
    expect(context).toContain('`npx stopslop . --base HEAD`');
    expect(context).toContain('cognitive-complexity — Function is harder to follow');
    expect(context).toMatch(/sample\.ts:2 {2}tangled has cognitive complexity \d+/);
    expect(context).toContain('How to fix: Return early instead of nesting');
    expect(context).toContain('docs/rules.md');
  }, 60_000);

  it('lets Claude stop when the changes add nothing', () => {
    const root = repository();
    fakeCli(root, 0, { findings: [] });
    writeFileSync(join(root, 'sample.ts'), 'export const stable = 2;\n');

    expect(feedback({ cwd: root })).toBeUndefined();
    expect(existsSync(join(root, 'cli-args.json'))).toBe(true);
  });

  it('does not analyze a turn that changed no JS or TS source', () => {
    const root = repository();
    fakeCli(root, 1, { findings: [finding(0)] });
    writeFileSync(join(root, 'README.md'), '# notes\n');
    // The stand-in CLI is itself an untracked .js file; keep it out of the change.
    writeFileSync(join(root, '.gitignore'), 'node_modules/\ncli-args.json\n');

    expect(feedback({ cwd: root })).toBeUndefined();
    expect(existsSync(join(root, 'cli-args.json'))).toBe(false);
  });

  it('nudges once per turn and outside a Git work tree not at all', () => {
    const root = repository();
    fakeCli(root, 1, { findings: [finding(0)] });
    writeFileSync(join(root, 'sample.ts'), 'export const stable = 2;\n');
    expect(feedback({ cwd: root, stop_hook_active: true })).toBeUndefined();

    const plain = mkdtempSync(join(tmpdir(), 'stop-slop-hook-plain-'));
    fixtures.push(plain);
    fakeCli(plain, 1, { findings: [finding(0)] });
    writeFileSync(join(plain, 'sample.ts'), 'export const stable = 1;\n');
    expect(feedback({ cwd: plain })).toBeUndefined();

    expect(existsSync(join(root, 'cli-args.json'))).toBe(false);
    expect(existsSync(join(plain, 'cli-args.json'))).toBe(false);
  });

  it('gates on the committed baseline when the project has one', () => {
    const root = repository();
    writeFileSync(join(root, '.stopslop-baseline.json'), '{"version":1,"findings":[]}\n');
    writeFileSync(join(root, 'sample.ts'), 'export const stable = 2;\n');
    const findings = Array.from({ length: 23 }, (_, i) => finding(i));
    fakeCli(root, 1, { findings });

    const context = feedback({ cwd: root });

    const args = JSON.parse(readFileSync(join(root, 'cli-args.json'), 'utf8')) as string[];
    expect(args).toEqual(['.', '--baseline', '.stopslop-baseline.json', '--format', 'json']);
    expect(context).toContain('StopSlop: 23 findings not in .stopslop-baseline.json');
    // A report without the `rules` block, as stopslop 1.1.0 wrote it, still reads.
    expect(context).toContain('\ncognitive-complexity\n');
    expect(context).toContain('3 more not listed');
  });

  it('lists the other places a cloned block occurs', () => {
    const root = repository();
    writeFileSync(join(root, 'sample.ts'), 'export const stable = 2;\n');
    fakeCli(root, 1, {
      findings: [
        {
          kind: 'duplicate-code',
          file: 'src/a.ts',
          symbol: 'block',
          line: 4,
          severity: 'warn',
          message: 'duplicated block (12 lines)',
          data: {
            occurrences: [
              { file: 'src/a.ts', startLine: 4, endLine: 15 },
              { file: 'src/b.ts', startLine: 20, endLine: 31 },
              { file: 'src/c.ts', startLine: 1, endLine: 12 },
              { file: 'src/d.ts', startLine: 7, endLine: 18 },
            ],
          },
        },
      ],
    });

    expect(feedback({ cwd: root })).toContain(
      'src/a.ts:4  duplicated block (12 lines)  (also src/b.ts:20-31, src/c.ts:1-12 +1 more)',
    );
  });

  it('speaks the Cursor protocol: project from the environment, a follow-up message', () => {
    const root = repository();
    writeFileSync(join(root, 'sample.ts'), 'export const stable = 2;\n');
    fakeCli(root, 1, { findings: [finding(0)] });
    const cursor = (input: Record<string, unknown>, env = {}) =>
      runHook({ hook_event_name: 'stop', loop_count: 0, ...input }, ['--agent', 'cursor'], env);

    // Plugin hooks run from the plugin directory; the project comes from Cursor.
    expect(cursor({ status: 'completed' }, { CURSOR_PROJECT_DIR: root })).toEqual({
      followup_message: expect.stringContaining('src/f0.ts:1  f0 has cognitive complexity 30'),
    });
    expect(cursor({ status: 'completed', workspace_roots: [root] })?.followup_message).toContain(
      'StopSlop: 1 finding added by the uncommitted changes',
    );

    rmSync(join(root, 'cli-args.json'));
    // A turn the user aborted, one that failed, or one already sent back: no check.
    expect(cursor({ status: 'aborted', workspace_roots: [root] })).toBeUndefined();
    expect(cursor({ status: 'error', workspace_roots: [root] })).toBeUndefined();
    expect(cursor({ status: 'completed', loop_count: 1, workspace_roots: [root] })).toBeUndefined();
    // Without a project, nothing is analyzed: the hook's own directory is not it.
    expect(cursor({ status: 'completed' })).toBeUndefined();
    expect(existsSync(join(root, 'cli-args.json'))).toBe(false);
  });
});
