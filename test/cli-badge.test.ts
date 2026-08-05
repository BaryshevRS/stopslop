import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';

function runCli(projectRoot: string, fixture: string, ...args: string[]) {
  return spawnSync(
    process.execPath,
    ['--import', 'tsx', join(projectRoot, 'src', 'cli.ts'), fixture, '--fast', ...args],
    { cwd: projectRoot, encoding: 'utf8' },
  );
}

it('uses the committed baseline to determine the badge gate state', () => {
  const projectRoot = process.cwd();
  const fixture = mkdtempSync(join(tmpdir(), 'stop-slop-cli-badge-'));
  const baseline = join(fixture, '.stopslop-baseline.json');
  const branches = Array.from(
    { length: 20 },
    (_, index) => `if (value === ${index}) score += ${index};`,
  ).join(' ');

  try {
    writeFileSync(
      join(fixture, 'sample.ts'),
      `export function tangled(value: number) { let score = 0; ${branches} return score; }\n`,
    );

    const detected = runCli(projectRoot, fixture, '--format', 'shields');
    expect(detected.status).toBe(0);
    expect(JSON.parse(detected.stdout)).toMatchObject({
      label: 'AI slop',
      message: 'detected',
      color: 'red',
    });

    const recorded = runCli(
      projectRoot,
      fixture,
      '--baseline',
      baseline,
      '--update-baseline',
    );
    expect(recorded.status).toBe(0);

    const clear = runCli(
      projectRoot,
      fixture,
      '--baseline',
      baseline,
      '--format',
      'shields',
    );
    expect(clear.status).toBe(0);
    expect(JSON.parse(clear.stdout)).toMatchObject({
      label: 'AI slop',
      message: 'clear',
      color: 'brightgreen',
    });
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
