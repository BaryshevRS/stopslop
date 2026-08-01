import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyBaseline, fingerprint, readBaseline, writeBaseline } from '../src/baseline.js';
import type { Finding, FindingKind } from '../src/types.js';

function finding(kind: FindingKind, file: string, symbol: string): Finding {
  return { kind, file, symbol, line: 1, severity: 'warn', message: '' };
}

function tmpFile(): string {
  return join(mkdtempSync(join(tmpdir(), 'stopslop-')), 'baseline.json');
}

describe('baseline fingerprint', () => {
  it('identifies a finding by kind + file + symbol', () => {
    expect(fingerprint(finding('god-class', 'src/a.ts', 'Foo'))).toBe(
      fingerprint(finding('god-class', 'src/a.ts', 'Foo')),
    );
    expect(fingerprint(finding('god-class', 'src/a.ts', 'Foo'))).not.toBe(
      fingerprint(finding('god-class', 'src/b.ts', 'Foo')),
    );
  });

  it('keys a clone on its content symbol alone, so it survives moving files', () => {
    const here = finding('duplicate-code', 'src/a.ts', 'clone:abc123');
    const moved = finding('duplicate-code', 'src/b.ts', 'clone:abc123');
    expect(fingerprint(here)).toBe(fingerprint(moved));
  });
});

describe('baseline round-trip', () => {
  it('writes and reads back the same identities', () => {
    const path = tmpFile();
    const findings = [finding('god-class', 'src/a.ts', 'Foo'), finding('unused-export', 'src/b.ts', 'bar')];
    writeBaseline(path, findings);
    const accepted = readBaseline(path);
    expect(accepted.has(fingerprint(findings[0]!))).toBe(true);
    expect(accepted.has(fingerprint(findings[1]!))).toBe(true);
  });

  it('deduplicates and sorts for a churn-free diff', () => {
    const path = tmpFile();
    writeBaseline(path, [
      finding('unused-export', 'src/z.ts', 'z'),
      finding('god-class', 'src/a.ts', 'Foo'),
      finding('god-class', 'src/a.ts', 'Foo'), // dup
    ]);
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { findings: { symbol: string }[] };
    expect(parsed.findings).toHaveLength(2);
    expect(parsed.findings[0]!.symbol).toBe('Foo'); // god-class sorts before unused-export
  });

  it('throws a helpful error when the file is missing', () => {
    expect(() => readBaseline(join(tmpdir(), 'does-not-exist-xyz.json'))).toThrow(/--update-baseline/);
  });

  it('ignores malformed records instead of crashing', () => {
    const path = tmpFile();
    writeFileSync(path, JSON.stringify({ version: 1, findings: [{ file: 'x' }, null] }));
    expect(readBaseline(path).size).toBe(0);
  });
});

describe('applyBaseline', () => {
  it('suppresses baselined findings and keeps the new ones', () => {
    const old = finding('god-class', 'src/a.ts', 'Foo');
    const fresh = finding('cognitive-complexity', 'src/b.ts', 'handler');
    const accepted = new Set([fingerprint(old)]);

    const { kept, suppressed } = applyBaseline([old, fresh], accepted);
    expect(suppressed).toBe(1);
    expect(kept).toEqual([fresh]);
  });

  it('keeps everything when the baseline is empty', () => {
    const findings = [finding('god-class', 'src/a.ts', 'Foo')];
    const { kept, suppressed } = applyBaseline(findings, new Set());
    expect(suppressed).toBe(0);
    expect(kept).toEqual(findings);
  });
});
