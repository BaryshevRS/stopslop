import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { fingerprint } from '../src/index.js';
import { toSarif } from '../src/report/sarif.js';
import type { AnalyzeResult, Finding } from '../src/index.js';

it('renders reported findings as stable GitHub-compatible SARIF 2.1.0', () => {
  const clone: Finding = {
    kind: 'duplicate-code',
    file: '/workspace/project/src/clone-a.ts',
    symbol: 'shared block',
    line: 7,
    severity: 'warn',
    message: 'Duplicate block found',
    data: {
      occurrences: [
        { file: '/workspace/project/src/clone-b.ts', startLine: 21, endLine: 25 },
        { file: '/workspace/project/src/nested/clone-c.ts', startLine: 31, endLine: 35 },
      ],
    },
  };
  const unusedFile: Finding = {
    kind: 'unused-file',
    file: '/workspace/project/src/unused.ts',
    symbol: 'src/unused.ts',
    line: 1,
    severity: 'info',
    message: 'File is unused',
  };
  const result = {
    root: '/workspace/project',
    fileCount: 3,
    loc: 60,
    findings: [clone, unusedFile],
    metrics: {},
    errors: [],
    notes: [],
    elapsedMs: 1,
  } as unknown as AnalyzeResult;

  const sarif = JSON.parse(toSarif(result));
  const rerendered = JSON.parse(toSarif(result));

  expect(sarif.$schema).toBe('https://json.schemastore.org/sarif-2.1.0.json');
  expect(sarif.version).toBe('2.1.0');
  expect(sarif.runs).toHaveLength(1);
  expect(sarif.runs[0].tool.driver.name).toBe('stopslop');
  expect(sarif.runs[0].tool.driver.rules.map((rule: { id: string }) => rule.id)).toEqual([
    'duplicate-code',
    'unused-file',
  ]);
  const cloneRule = sarif.runs[0].tool.driver.rules[0];
  expect(cloneRule).toMatchObject({
    name: 'DuplicateCode',
    shortDescription: { text: expect.any(String) },
    fullDescription: { text: expect.stringContaining('Copies drift') },
    help: {
      text: expect.stringContaining('Extract the block into one function'),
      markdown: expect.stringContaining('**How to fix.**'),
    },
    helpUri: 'https://github.com/BaryshevRS/stopslop/blob/main/docs/rules.md#duplicate-code',
    defaultConfiguration: { level: 'warning' },
  });
  // Code Scanning truncates a longer full description.
  expect(cloneRule.fullDescription.text.length).toBeLessThanOrEqual(1024);

  const cloneResult = sarif.runs[0].results.find(
    (entry: { ruleId: string }) => entry.ruleId === 'duplicate-code',
  );
  expect(cloneResult).toMatchObject({
    ruleId: 'duplicate-code',
    level: 'warning',
    message: { text: 'Duplicate block found' },
  });
  expect(cloneResult.locations).toEqual([
    {
      physicalLocation: {
        artifactLocation: { uri: 'src/clone-a.ts' },
        region: { startLine: 7 },
      },
    },
    {
      physicalLocation: {
        artifactLocation: { uri: 'src/clone-b.ts' },
        region: { startLine: 21, endLine: 25 },
      },
    },
    {
      physicalLocation: {
        artifactLocation: { uri: 'src/nested/clone-c.ts' },
        region: { startLine: 31, endLine: 35 },
      },
    },
  ]);

  const unusedResult = sarif.runs[0].results.find(
    (entry: { ruleId: string }) => entry.ruleId === 'unused-file',
  );
  expect(unusedResult).toMatchObject({
    ruleId: 'unused-file',
    level: 'note',
    message: { text: 'File is unused' },
    locations: [
      {
        physicalLocation: {
          artifactLocation: { uri: 'src/unused.ts' },
          region: { startLine: 1 },
        },
      },
    ],
  });

  const expectedFingerprint = createHash('sha256').update(fingerprint(clone)).digest('hex');
  expect(cloneResult.partialFingerprints).toEqual({ primaryLocationLineHash: expectedFingerprint });
  expect(rerendered.runs[0].results[0].partialFingerprints).toEqual(
    cloneResult.partialFingerprints,
  );
  for (const entry of sarif.runs[0].results) {
    for (const location of entry.locations) {
      const uri = location.physicalLocation.artifactLocation.uri;
      expect(uri).not.toMatch(/^\/?(?:[A-Za-z]:)?[\\/]/);
      expect(uri).not.toContain('\\');
    }
  }
});
