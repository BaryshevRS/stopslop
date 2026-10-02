import { describe, expect, it } from 'vitest';
import { duplicatesAnalyzer } from '../src/analyzers/duplicates.js';
import { parseFile } from '../src/parse.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import type { Finding, ParsedFile, ProjectContext, ResolvedConfig } from '../src/types.js';

function file(relPath: string, source: string): ParsedFile {
  const parsed = parseFile(relPath, `/${relPath}`, source);
  if (!parsed.file) throw new Error(parsed.errors.join('; '));
  return parsed.file;
}

async function run(
  files: ParsedFile[],
  config: ResolvedConfig = DEFAULT_CONFIG,
): Promise<{ findings: Finding[]; ctx: ProjectContext }> {
  const ctx: ProjectContext = {
    root: '/',
    files,
    config,
    notes: [],
    configHints: [],
    metrics: {},
  };
  const findings = await duplicatesAnalyzer().analyzeProject!(ctx);
  return { findings, ctx };
}

/** A block long enough to clear minTokens, with a hook to rename its symbols. */
function block(suffix: string): string {
  return `
export function process${suffix}(rows) {
  const seen = new Map();
  for (const row of rows) {
    if (!row || typeof row.id !== 'number') continue;
    const key = String(row.id) + ':' + String(row.kind);
    const prev = seen.get(key);
    if (prev && prev.at > row.at) continue;
    seen.set(key, { id: row.id, kind: row.kind, at: row.at, tag: 'x' });
  }
  return [...seen.values()].sort((a, b) => a.at - b.at);
}
`;
}

describe('duplicates (Clone Alert)', () => {
  it('reports a block copy-pasted into another file', async () => {
    const { findings } = await run([file('a.ts', block('A')), file('b.ts', block('B'))]);

    expect(findings).toHaveLength(1);
    const clone = findings[0]!;
    expect(clone.kind).toBe('duplicate-code');
    expect(clone.data?.occurrences).toHaveLength(2);
    expect((clone.data?.occurrences as { file: string }[]).map((o) => o.file)).toEqual(['a.ts', 'b.ts']);
  });

  it('renamed copy-paste: invisible to the Type-1 default, caught with ignoreIdentifiers', async () => {
    const renamed = block('B').replace(/seen/g, 'cache').replace(/rows/g, 'items');
    const files = () => [file('a.ts', block('A')), file('b.ts', renamed)];

    const exact = await run(files());
    expect(exact.findings).toHaveLength(0);

    const type2Config: ResolvedConfig = {
      ...DEFAULT_CONFIG,
      duplicates: { ...DEFAULT_CONFIG.duplicates, ignoreIdentifiers: true },
    };
    const type2 = await run(files(), type2Config);
    expect(type2.findings).toHaveLength(1);
  });

  it('identifies a clone by content, not by line — the symbol survives a move', async () => {
    const [flat, shifted] = await Promise.all([
      run([file('a.ts', block('A')), file('b.ts', block('B'))]),
      run([file('a.ts', '// header\n// header\n' + block('A')), file('b.ts', block('B'))]),
    ]);

    expect(flat.findings[0]!.line).not.toBe(shifted.findings[0]!.line);
    expect(shifted.findings[0]!.symbol).toBe(flat.findings[0]!.symbol);
    expect(flat.findings[0]!.symbol).toMatch(/^clone:[0-9a-f]{10}$/);
  });

  it('ignores dense duplicates below minLines', async () => {
    // One long line, duplicated: many tokens, no refactor value.
    const dense = `const t = [${Array.from({ length: 40 }, (_, i) => `{ id: ${i}, name: 'n${i}' }`).join(', ')}];\n`;
    const { findings } = await run([file('a.ts', dense), file('b.ts', dense)]);

    expect(findings).toEqual([]);
  });

  it('reports the duplicated-line ratio as a score signal', async () => {
    const { ctx } = await run([file('a.ts', block('A')), file('b.ts', block('B'))]);

    expect(ctx.metrics.duplicationRatio).toBeGreaterThan(0);
    expect(ctx.metrics.duplicationRatio).toBeLessThanOrEqual(1);
  });

  it('stays silent — and leaves the metric unset — when disabled', async () => {
    const config: ResolvedConfig = {
      ...DEFAULT_CONFIG,
      duplicates: { ...DEFAULT_CONFIG.duplicates, enabled: false },
    };
    const { findings, ctx } = await run([file('a.ts', block('A')), file('b.ts', block('B'))], config);

    expect(findings).toEqual([]);
    expect(ctx.metrics.duplicationRatio).toBeUndefined();
  });
});
