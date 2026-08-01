import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';

function run(command: string, args: string[], cwd: string) {
  return spawnSync(command, args, { cwd, encoding: 'utf8' });
}

function git(root: string, ...args: string[]) {
  const result = run('git', ['-C', root, ...args], root);
  if (result.status !== 0) throw new Error(result.stderr);
}

it('renders Git-base-filtered SARIF and rejects conflicting baseline options', () => {
  const projectRoot = process.cwd();
  const fixture = mkdtempSync(join(tmpdir(), 'stop-slop-cli-git-'));
  const sample = join(fixture, 'sample.ts');

  try {
    git(fixture, 'init');
    writeFileSync(sample, 'export const stable = 1;\n');
    git(fixture, 'add', 'sample.ts');
    git(
      fixture,
      '-c',
      'user.name=Stop Slop Test',
      '-c',
      'user.email=stop-slop@example.test',
      'commit',
      '-m',
      'base',
    );

    const branches = Array.from(
      { length: 30 },
      (_, index) => `if (value === ${index}) score += ${index};`,
    ).join(' ');
    writeFileSync(
      sample,
      `export const stable = 1;\nexport function tangled(value: number) { let score = 0; ${branches} return score; }\n`,
    );

    const cli = join(projectRoot, 'src', 'cli.ts');
    const analyzed = run(
      process.execPath,
      ['--import', 'tsx', cli, fixture, '--base', 'HEAD', '--fast', '--format', 'sarif'],
      projectRoot,
    );

    expect(analyzed.status).toBe(1);
    const sarif = JSON.parse(analyzed.stdout);
    expect(sarif.version).toBe('2.1.0');
    const results = sarif.runs[0].results;
    expect(results).toHaveLength(1);
    expect(JSON.stringify(results[0])).toMatch(/cognitive[-_ ]?complexity/i);
    expect(
      results[0].locations[0].physicalLocation.artifactLocation.uri.replaceAll('\\', '/'),
    ).toBe('sample.ts');

    const conflict = run(
      process.execPath,
      ['--import', 'tsx', cli, fixture, '--base', 'HEAD', '--baseline', 'some.json'],
      projectRoot,
    );

    expect(conflict.status).toBe(2);
    expect(conflict.stderr).toMatch(/base/i);
    expect(conflict.stderr).toMatch(/baseline/i);
    expect(conflict.stderr).toMatch(/mutually|exclusive|conflict|cannot/i);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
