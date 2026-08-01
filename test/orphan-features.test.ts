import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Export, File } from 'knip/session';
import { afterEach, describe, expect, it } from 'vitest';
import { findOrphanFeatures } from '../src/analyzers/orphan-features.js';
import { analyze } from '../src/index.js';
import { parseFile } from '../src/parse.js';
import { resolveConfig } from '../src/config.js';
import { computeScore } from '../src/score.js';
import type { Finding, ParsedFile } from '../src/types.js';

const ROOT = '/repo';

function sourceFile(relPath: string, source: string): ParsedFile {
  const parsed = parseFile(relPath, `${ROOT}/${relPath}`, source);
  if (!parsed.file) throw new Error(parsed.errors.join('; '));
  return parsed.file;
}

/** A Knip file descriptor: one export and the files that import it. */
function described(identifier: string, importedBy: string[]): File {
  const exported = {
    identifier,
    filePath: `${ROOT}/src/discount.ts`,
    line: 3,
    col: 1,
    pos: 0,
    entryPaths: new Set<string>(),
    exports: undefined,
    importLocations: importedBy.map((rel) => ({
      identifier,
      filePath: `${ROOT}/${rel}`,
      line: 1,
      col: 1,
      pos: 0,
    })),
  } as unknown as Export;
  return { exports: [exported] } as unknown as File;
}

function run(file: ParsedFile, descriptor: File): Finding[] {
  return findOrphanFeatures({ root: ROOT, files: [file], describeFile: () => descriptor });
}

const ORPHAN = sourceFile('src/discount.ts', 'export function applyDiscount(t) {\n  return t * 0.9;\n}\n');

describe('orphan features', () => {
  it('passes an absolute Windows path to describeFile in POSIX form', () => {
    const parsed = sourceFile('src/discount.ts', 'export const discount = 10;');
    const file: ParsedFile = {
      ...parsed,
      absPath: 'C:\\repo\\src\\discount.ts',
    };
    const describedPaths: string[] = [];

    findOrphanFeatures({
      root: ROOT,
      files: [file],
      describeFile: (absPath) => {
        describedPaths.push(absPath);
        return undefined;
      },
    });

    expect(describedPaths).toEqual(['C:/repo/src/discount.ts']);
  });

  it('reports a symbol kept alive by nothing but its own paired test', () => {
    const findings = run(ORPHAN, described('applyDiscount', ['test/discount.test.ts']));

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      kind: 'orphan-feature',
      file: 'src/discount.ts',
      symbol: 'applyDiscount',
      line: 3,
      severity: 'warn',
      data: { test: 'test/discount.test.ts' },
    });
    // The test file is half of what has to be deleted, so it must be quotable
    // straight from the message rather than looked up by hand.
    expect(findings[0]!.message).toContain('test/discount.test.ts');
  });

  it('spares a symbol production code calls inside its own file', () => {
    // export-for-testing: `checkout` uses it one line down, the export merely
    // widens visibility. Knip calls the export unused; deleting it breaks a
    // working program.
    const exportForTesting = sourceFile(
      'src/discount.ts',
      'export function applyDiscount(t) {\n  return t * 0.9;\n}\nexport function checkout(t) {\n  return applyDiscount(t);\n}\n',
    );

    expect(run(exportForTesting, described('applyDiscount', ['test/discount.test.ts']))).toEqual([]);
  });

  it('spares a shared test helper, a story, and anything production imports', () => {
    const cases: [string, string[]][] = [
      ['helper used by several tests', ['test/discount.test.ts', 'test/checkout.test.ts']],
      ['story', ['src/Discount.stories.tsx']],
      ['production consumer', ['src/index.ts']],
      ['production consumer alongside the test', ['src/index.ts', 'test/discount.test.ts']],
      ['nobody at all — plain unused-export territory', []],
    ];

    for (const [name, importers] of cases) {
      expect(run(ORPHAN, described('applyDiscount', importers)), name).toEqual([]);
    }
  });

  it('reports an orphan whose single test is not the one named after it', () => {
    // Suites grouped by area rather than one per source file: `spec.test.ts`
    // covers all of `spec/`. Demanding `foo.ts` ↔ `foo.test.ts` hid every real
    // orphan found during validation — both lived behind a test of this shape.
    const findings = run(
      sourceFile('src/spec/page.ts', 'export function pxToPt(px, h) {\n  return px / h;\n}\n'),
      described('pxToPt', ['src/spec/spec.test.ts']),
    );

    expect(findings.map((f) => f.symbol)).toEqual(['pxToPt']);
  });

  it('spares a constant that is only a test handle onto an outside asset', () => {
    // `renderPrompt` loads a Liquid template that other templates pull in with
    // `{% render %}` — an edge no module graph sees. The template is live; the
    // export exists so the test can assert on its wording. Observed in the wild,
    // twice, and both would have been told to delete working code.
    const handle = sourceFile(
      'src/prompts/image.ts',
      "export const SERIES_STYLE = renderPrompt('series-style.liquid', {});\n",
    );

    expect(run(handle, described('SERIES_STYLE', ['src/prompts/image.test.ts']))).toEqual([]);
  });

  it('still reports an orphan written as an arrow constant', () => {
    const arrow = sourceFile(
      'src/discount.ts',
      'export const applyDiscount = (t) => t * 0.9;\n',
    );

    expect(run(arrow, described('applyDiscount', ['test/discount.test.ts']))).toHaveLength(1);
  });

  it('stays out of the score', () => {
    const orphans: Finding[] = [
      { kind: 'orphan-feature', file: 'a.ts', symbol: 'a', line: 1, severity: 'warn', message: '' },
      { kind: 'orphan-feature', file: 'b.ts', symbol: 'b', line: 1, severity: 'warn', message: '' },
    ];
    const input = { loc: 1000, metrics: { deadCodeMeasured: true }, config: resolveConfig({}) };

    const clean = computeScore({ ...input, findings: [] });
    const withOrphans = computeScore({ ...input, findings: orphans });

    expect(withOrphans.score).toBe(clean.score);
    expect(withOrphans.densities.deadCode).toBe(clean.densities.deadCode);
  });
});

describe('orphan features, end to end', () => {
  const fixtures: string[] = [];
  afterEach(() => {
    for (const root of fixtures.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it('separates the orphan from export-for-testing in a real Knip run', async () => {
    const root = mkdtempSync(join(tmpdir(), 'stopslop-orphan-'));
    fixtures.push(root);
    mkdirSync(join(root, 'src'));
    mkdirSync(join(root, 'test'));
    mkdirSync(join(root, 'node_modules')); // the "dependencies installed" gate

    const write = (rel: string, body: string): void => writeFileSync(join(root, rel), body);
    write('package.json', JSON.stringify({ name: 'fixture', version: '1.0.0' }));
    write('src/index.ts', "export { checkout } from './price.js';\n");
    write(
      'src/price.ts',
      'export function calcTax(total: number): number {\n  return total * 0.2;\n}\n' +
        'export function checkout(total: number): number {\n  return total + calcTax(total);\n}\n',
    );
    write('src/discount.ts', 'export function applyDiscount(total: number): number {\n  return total * 0.9;\n}\n');
    write('test/price.test.ts', "import { calcTax } from '../src/price.js';\ncalcTax(1);\n");
    write(
      'test/discount.test.ts',
      "import { applyDiscount } from '../src/discount.js';\napplyDiscount(1);\n",
    );

    // `root` is left as mkdtemp returned it — a symlinked /tmp on macOS. Knip
    // keys its graph by real paths, so this also guards the resolution step.
    const result = await analyze(
      root,
      resolveConfig({ knip: { entry: ['src/index.ts', 'test/**/*.test.ts'], project: ['**/*.ts'] } }),
    );
    const orphans = result.findings.filter((f) => f.kind === 'orphan-feature');

    expect(orphans.map((f) => `${f.file}:${f.symbol}`)).toEqual(['src/discount.ts:applyDiscount']);
    expect(orphans[0]!.data).toMatchObject({ test: 'test/discount.test.ts' });
  });
});
