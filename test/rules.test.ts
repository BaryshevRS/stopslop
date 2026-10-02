import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { toJson } from '../src/report/json.js';
import { RULE_KINDS, ruleHelp } from '../src/report/rules.js';
import { resolveConfig } from '../src/index.js';
import type { AnalyzeResult, Finding } from '../src/index.js';

const rulesDoc = readFileSync(new URL('../docs/rules.md', import.meta.url), 'utf8');

describe('rule help', () => {
  it.each(RULE_KINDS)('%s links to its own section of docs/rules.md', (kind) => {
    const rule = ruleHelp(kind);
    expect(rule.helpUri).toMatch(/\/docs\/rules\.md#/);
    const anchor = rule.helpUri.split('#')[1];
    expect(rulesDoc).toContain(`\n## ${anchor}\n`);
    expect(rule.why.length).toBeLessThanOrEqual(1024);
  });

  it('gives the JSON report help for the reported kinds only', () => {
    const finding: Finding = {
      kind: 'orphan-feature',
      file: 'src/feature.ts',
      symbol: 'feature',
      line: 3,
      severity: 'warn',
      message: '`feature` is dead in production — only the test `src/feature.test.ts` uses it; delete both',
    };
    const result = {
      root: '/workspace/project',
      fileCount: 1,
      loc: 10,
      findings: [finding, { ...finding, symbol: 'other', line: 9 }],
      slop: {},
      metrics: {},
      errors: [],
      notes: [],
      configHints: [],
      config: resolveConfig({}),
      elapsedMs: 1,
    } as unknown as AnalyzeResult;

    const report = JSON.parse(toJson(result)) as { rules: Record<string, unknown> };

    expect(report.rules).toEqual({ 'orphan-feature': ruleHelp('orphan-feature') });
  });
});
