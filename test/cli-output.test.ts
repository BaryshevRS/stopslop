import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';

it('writes complete large reports to a pipe before exiting with findings', () => {
  const root = process.cwd();
  const fixture = mkdtempSync(join(tmpdir(), 'stopslop-cli-output-'));

  try {
    const branches = Array.from({ length: 20 }, (_, i) => `if (x === ${i}) x++;`).join(' ');
    const functions = Array.from(
      { length: 500 },
      (_, i) => `export function f${i}(x: number) { ${branches} return x; }`,
    );

    writeFileSync(join(fixture, 'sample.ts'), functions.join('\n'));

    for (const format of ['json', 'sarif']) {
      const result = spawnSync(
        process.execPath,
        ['--import', 'tsx', join(root, 'src', 'cli.ts'), fixture, '--fast', '--format', format],
        { cwd: root, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 },
      );

      expect(result.status).toBe(1);
      expect(result.stdout.length).toBeGreaterThan(65536);
      const report = JSON.parse(result.stdout);
      const results = format === 'json' ? report.findings : report.runs[0].results;
      expect(
        results.filter(
          (finding: { kind?: string; ruleId?: string }) => (finding.kind ?? finding.ruleId) === 'cognitive-complexity',
        ),
      ).toHaveLength(500);
    }
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
