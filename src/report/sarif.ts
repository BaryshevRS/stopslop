import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { fingerprint } from '../baseline.js';
import type { AnalyzeResult } from '../index.js';
import type { Finding } from '../types.js';

/** GitHub Code Scanning-compatible SARIF 2.1.0 report. */
export function toSarif(result: AnalyzeResult): string {
  const rules = [];
  const seenRules = new Set<string>();

  for (const finding of result.findings) {
    if (seenRules.has(finding.kind)) continue;
    seenRules.add(finding.kind);
    rules.push({
      id: finding.kind,
      shortDescription: { text: describeKind(finding.kind) },
      defaultConfiguration: { level: sarifLevel(finding.severity) },
    });
  }

  const sarif = {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: { driver: { name: 'stopslop', rules } },
        results: result.findings.map((finding) => ({
          ruleId: finding.kind,
          level: sarifLevel(finding.severity),
          message: { text: finding.message },
          locations: locationsFor(result.root, finding),
          partialFingerprints: {
            primaryLocationLineHash: createHash('sha256').update(fingerprint(finding)).digest('hex'),
          },
        })),
      },
    ],
  };

  return `${JSON.stringify(sarif, null, 2)}\n`;
}

function sarifLevel(severity: Finding['severity']): 'note' | 'warning' {
  return severity === 'warn' ? 'warning' : 'note';
}

function describeKind(kind: Finding['kind']): string {
  const description = kind.replaceAll('-', ' ');
  return `${description.charAt(0).toUpperCase()}${description.slice(1)}`;
}

function locationsFor(root: string, finding: Finding): object[] {
  const primaryUri = artifactUri(root, finding.file);
  if (!primaryUri || !isLine(finding.line)) return [];
  const occurrences = Array.isArray(finding.data?.occurrences)
    ? finding.data.occurrences.flatMap((value) => {
        const parsed = parseOccurrence(root, value);
        return parsed ? [parsed] : [];
      })
    : [];
  const primary = occurrences.find(
    (occurrence) => occurrence.uri === primaryUri && occurrence.startLine === finding.line,
  );
  const locations: object[] = [location(primaryUri, finding.line, primary?.endLine)];
  const seen = new Set([JSON.stringify([primaryUri, finding.line])]);

  for (const occurrence of occurrences) {
    const key = JSON.stringify([occurrence.uri, occurrence.startLine]);
    if (seen.has(key)) continue;
    seen.add(key);
    locations.push(location(occurrence.uri, occurrence.startLine, occurrence.endLine));
  }

  return locations;
}

interface SarifOccurrence {
  uri: string;
  startLine: number;
  endLine?: number;
}

function parseOccurrence(root: string, value: unknown): SarifOccurrence | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const { file, startLine, endLine } = value as Record<string, unknown>;
  if (typeof file !== 'string' || !isLine(startLine)) return undefined;
  const uri = artifactUri(root, file);
  if (!uri) return undefined;
  return {
    uri,
    startLine,
    ...(isLine(endLine) && endLine >= startLine ? { endLine } : {}),
  };
}

function location(uri: string, startLine: number, endLine?: number): object {
  return {
    physicalLocation: {
      artifactLocation: { uri },
      region: { startLine, ...(endLine === undefined ? {} : { endLine }) },
    },
  };
}

function artifactUri(root: string, file: string): string | undefined {
  const normalizedRoot = root.replaceAll('\\', '/');
  const normalizedFile = file.replaceAll('\\', '/');
  const absolute = normalizedFile.startsWith('/') || /^[A-Za-z]:\//.test(normalizedFile);
  const relative = absolute ? posix.relative(normalizedRoot, normalizedFile) : normalizedFile;
  const normalized = posix.normalize(relative).replace(/^\.\//, '');
  if (
    normalized === '.' ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    normalized.startsWith('/') ||
    /^[A-Za-z][A-Za-z\d+.-]*:/.test(normalized)
  ) {
    return undefined;
  }
  return normalized.split('/').map(encodeURIComponent).join('/');
}

function isLine(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}
