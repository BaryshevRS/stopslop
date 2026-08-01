import { describe, expect, it } from 'vitest';
import type { Issue, Issues } from 'knip/session';
import { mapIssues } from '../src/analyzers/dead-code.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import type { DeadCodeGate } from '../src/types.js';

// The Knip run itself is Knip's business; what we own is the translation of its
// issues into findings — the filtering, the severities and the caveats.

const ROOT = '/repo';

function issues(partial: Partial<Record<keyof Issues, Issue[]>>): Issues {
  const empty = Object.fromEntries(
    (
      [
        'files',
        'dependencies',
        'devDependencies',
        'optionalPeerDependencies',
        'unlisted',
        'binaries',
        'unresolved',
        'exports',
        'types',
        'nsExports',
        'nsTypes',
        'duplicates',
        'enumMembers',
        'namespaceMembers',
        'catalog',
        'cycles',
      ] as (keyof Issues)[]
    ).map((k) => [k, {}]),
  ) as Issues;

  for (const [type, list] of Object.entries(partial) as [keyof Issues, Issue[]][]) {
    for (const issue of list) {
      const byFile = (empty[type][issue.filePath] ??= {});
      byFile[issue.symbol] = issue;
    }
  }
  return empty;
}

function issue(over: Partial<Issue> & Pick<Issue, 'type' | 'filePath' | 'symbol'>): Issue {
  return { workspace: '.', fixes: [], ...over };
}

function map(raw: Issues, gate: Partial<DeadCodeGate> = {}, analyzed = ['src/a.ts', 'src/dead.ts']) {
  return mapIssues(raw, {
    root: ROOT,
    gate: { ...DEFAULT_CONFIG.deadCode, ...gate },
    analyzed: new Set(analyzed),
  });
}

describe('dead code (Knip)', () => {
  it('maps unused exports and unused exported types alike', () => {
    const findings = map(
      issues({
        exports: [issue({ type: 'exports', filePath: '/repo/src/a.ts', symbol: 'helper', line: 12, symbolType: 'function' })],
        types: [issue({ type: 'types', filePath: '/repo/src/a.ts', symbol: 'Options', line: 3, symbolType: 'type' })],
      }),
    );

    expect(findings.map((f) => [f.kind, f.file, f.symbol, f.line])).toEqual([
      ['unused-export', 'src/a.ts', 'helper', 12],
      ['unused-export', 'src/a.ts', 'Options', 3],
    ]);
    expect(findings.every((f) => f.severity === 'warn')).toBe(true);
  });

  it('maps unused dependencies, flagging dev ones, even from a package.json above the root', () => {
    const findings = map(
      issues({
        dependencies: [issue({ type: 'dependencies', filePath: '/repo/package.json', symbol: 'lodash', line: 20 })],
        devDependencies: [issue({ type: 'devDependencies', filePath: '/repo/package.json', symbol: 'jest', line: 30 })],
      }),
    );

    expect(findings.map((f) => [f.kind, f.file, f.symbol, f.data?.dev])).toEqual([
      ['unused-dependency', 'package.json', 'lodash', false],
      ['unused-dependency', 'package.json', 'jest', true],
    ]);
  });

  it('reports unused files as info, with the entry-point caveat', () => {
    const findings = map(issues({ files: [issue({ type: 'files', filePath: '/repo/src/dead.ts', symbol: 'dead.ts' })] }));

    expect(findings).toHaveLength(1);
    expect(findings[0]!.kind).toBe('unused-file');
    expect(findings[0]!.severity).toBe('info');
    expect(findings[0]!.symbol).toBe('src/dead.ts');
    expect(String(findings[0]!.data?.caveat)).toContain('entry-point');
  });

  it('drops issues in files stopslop did not analyze (tests, generated, outside root)', () => {
    const findings = map(
      issues({
        exports: [
          issue({ type: 'exports', filePath: '/repo/src/a.spec.ts', symbol: 'fixture' }),
          issue({ type: 'exports', filePath: '/elsewhere/src/x.ts', symbol: 'outside' }),
        ],
        files: [issue({ type: 'files', filePath: '/repo/generated/api.ts', symbol: 'api.ts' })],
      }),
    );

    expect(findings).toEqual([]);
  });

  it('honours the per-class switches', () => {
    const raw = issues({
      exports: [issue({ type: 'exports', filePath: '/repo/src/a.ts', symbol: 'helper' })],
      dependencies: [issue({ type: 'dependencies', filePath: '/repo/package.json', symbol: 'lodash' })],
      files: [issue({ type: 'files', filePath: '/repo/src/dead.ts', symbol: 'dead.ts' })],
    });

    expect(map(raw, { files: false, dependencies: false }).map((f) => f.kind)).toEqual(['unused-export']);
    expect(map(raw, { exports: false }).map((f) => f.kind)).toEqual(['unused-dependency', 'unused-file']);
  });
});
