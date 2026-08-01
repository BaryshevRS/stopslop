import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
import { analyzeGitBase, resolveConfig, type Analyzer, type Finding } from '../src/index.js';

const execFileAsync = promisify(execFile);

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
  return stdout;
}

function worktreePaths(porcelain: string): string[] {
  return porcelain
    .split('\n')
    .filter((line) => line.startsWith('worktree '))
    .map((line) => line.slice('worktree '.length));
}

it('suppresses legacy base findings without disturbing the current worktree', async () => {
  const root = await mkdtemp(join(tmpdir(), 'stop-slop-git-base-'));
  const sourcePath = join(root, 'sample.ts');
  let initialWorktrees = '';

  try {
    await git(root, 'init');
    await writeFile(sourcePath, 'legacy\n', 'utf8');
    await git(root, 'add', 'sample.ts');
    await git(
      root,
      '-c',
      'user.name=Stop Slop Test',
      '-c',
      'user.email=stop-slop@example.test',
      'commit',
      '-m',
      'base',
    );

    const baseCommit = (await git(root, 'rev-parse', 'HEAD')).trim();
    const originalBranch = (await git(root, 'symbolic-ref', '--short', 'HEAD')).trim();
    const workingContents = 'legacy\nnew\n';
    await writeFile(sourcePath, workingContents, 'utf8');
    initialWorktrees = await git(root, 'worktree', 'list', '--porcelain');

    const analyzer: Analyzer = {
      name: 'fixture-token-analyzer',
      async analyzeProject(ctx) {
        const source = await readFile(join(ctx.root, 'sample.ts'), 'utf8');
        return source
          .trimEnd()
          .split('\n')
          .flatMap<Finding>((token, index) =>
            token === 'legacy' || token === 'new'
              ? [
                  {
                    kind: 'cognitive-complexity',
                    severity: 'warn',
                    file: 'sample.ts',
                    line: index + 1,
                    message: `fixture token: ${token}`,
                    symbol: token,
                  },
                ]
              : [],
          );
      },
    };

    const result = await analyzeGitBase(root, 'HEAD', resolveConfig({}), [analyzer]);

    expect(result.findings).toEqual([
      expect.objectContaining({
        file: 'sample.ts',
        line: 2,
        message: 'fixture token: new',
        symbol: 'new',
      }),
    ]);
    expect(result.gitBase).toEqual({ ref: 'HEAD', commit: baseCommit, suppressed: 1 });
    expect((await git(root, 'rev-parse', 'HEAD')).trim()).toBe(baseCommit);
    expect((await git(root, 'symbolic-ref', '--short', 'HEAD')).trim()).toBe(originalBranch);
    expect(await readFile(sourcePath, 'utf8')).toBe(workingContents);
    expect(await git(root, 'worktree', 'list', '--porcelain')).toBe(initialWorktrees);
  } finally {
    if (initialWorktrees) {
      try {
        const originalPaths = new Set(worktreePaths(initialWorktrees));
        const currentWorktrees = await git(root, 'worktree', 'list', '--porcelain');
        for (const path of worktreePaths(currentWorktrees)) {
          if (!originalPaths.has(path)) await git(root, 'worktree', 'remove', '--force', path);
        }
      } catch {
        // Preserve the primary assertion failure while still attempting cleanup.
      }
    }
    await rm(root, { recursive: true, force: true });
  }
});
