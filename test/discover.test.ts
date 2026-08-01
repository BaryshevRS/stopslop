import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { discover, globToRegExp } from '../src/discover.js';

describe('globToRegExp', () => {
  it('* matches within a segment only', () => {
    expect(globToRegExp('*.ts').test('a.ts')).toBe(true);
    expect(globToRegExp('*.ts').test('sub/a.ts')).toBe(false);
  });
  it('** matches across segments', () => {
    expect(globToRegExp('**/*.generated.ts').test('a/b/x.generated.ts')).toBe(true);
    expect(globToRegExp('src/**').test('src/a/b.ts')).toBe(true);
  });
});

describe('discover', () => {
  let root: string;
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'stopslop-'));
    const w = (rel: string, content = 'export const x = 1;\n') => {
      const abs = join(root, rel);
      mkdirSync(join(abs, '..'), { recursive: true });
      writeFileSync(abs, content);
    };
    w('src/a.ts');
    w('src/b.tsx');
    w('src/keep.js');
    w('src/types.d.ts'); // excluded: .d.ts
    w('src/a.test.ts'); // excluded: test file
    w('test/helper.ts'); // excluded: test dir
    w('fixtures/big.ts'); // excluded: fixtures dir
    w('node_modules/dep/index.ts'); // excluded: node_modules
    w('dist/out.js'); // excluded: dist
    w('src/bundle.js', 'var a=' + 'x'.repeat(3000) + ';\n'); // excluded: bundled long line
    w('src/generated.ts', '// @generated\nexport const y = 2;\n'); // excluded: marker
    w('src/skip.ts'); // excluded via user ignore glob
    // openapi-generator subtree: sentinel file marks the whole dir generated
    w('api-client/.openapi-generator-ignore', '# generated\n');
    w('api-client/configuration.ts');
    w('api-client/model/thing.ts');
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('finds real source and applies default + user excludes', () => {
    const files = discover(root, { ignore: ['**/skip.ts'] }).map((f) => f.replace(root + '/', ''));
    expect(files).toContain('src/a.ts');
    expect(files).toContain('src/b.tsx');
    expect(files).toContain('src/keep.js');
    expect(files).not.toContain('src/types.d.ts');
    expect(files).not.toContain('src/a.test.ts');
    expect(files).not.toContain('test/helper.ts');
    expect(files).not.toContain('fixtures/big.ts');
    expect(files).not.toContain('node_modules/dep/index.ts');
    expect(files).not.toContain('dist/out.js');
    expect(files).not.toContain('src/bundle.js');
    expect(files).not.toContain('src/generated.ts');
    expect(files).not.toContain('src/skip.ts');
    // whole openapi-generator subtree skipped via sentinel
    expect(files).not.toContain('api-client/configuration.ts');
    expect(files).not.toContain('api-client/model/thing.ts');
  });
});
