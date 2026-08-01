import { parseSync } from 'oxc-parser';
import type { OxcNode, ParsedFile } from './types.js';

export interface ParseResult {
  file?: ParsedFile;
  /** Fatal errors that prevented producing a usable AST. */
  errors: string[];
}

/** Build a 0-based-offset → 1-based-line lookup from source text. */
export function makeLineIndex(source: string): (offset: number) => number {
  // lineStarts[i] = offset of the first char of line i (0-based line index).
  const lineStarts: number[] = [0];
  for (let i = 0; i < source.length; i++) {
    if (source.charCodeAt(i) === 10 /* \n */) lineStarts.push(i + 1);
  }
  return (offset: number): number => {
    // binary search for the last lineStart <= offset
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid]! <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
}

/**
 * Parse one file. oxc tolerates syntax errors and still returns a partial AST,
 * so we only surface hard failures; recoverable parse diagnostics are ignored
 * (we are not a linter).
 */
export function parseFile(relPath: string, absPath: string, source: string): ParseResult {
  try {
    const result = parseSync(absPath, source);
    const program = result.program as unknown as OxcNode;
    if (!program || !Array.isArray((program as { body?: unknown }).body)) {
      return { errors: [`no program body for ${relPath}`] };
    }
    return {
      file: {
        relPath,
        absPath,
        source,
        program,
        lineAt: makeLineIndex(source),
      },
      errors: [],
    };
  } catch (err) {
    return { errors: [`parse failed for ${relPath}: ${(err as Error).message}`] };
  }
}
