import { describe, expect, it } from 'vitest';
import { assertAnalysisComplete } from '../src/analysis-completeness.js';

describe('analysis completeness policy', () => {
  it.each([
    { label: 'zero analyzed source files', result: { fileCount: 0, errors: [] } },
    { label: 'hard analysis errors', result: { fileCount: 1, errors: ['src/broken.ts: analysis failed'] } },
  ])('rejects an incomplete analysis with $label', ({ result }) => {
    expect(() => assertAnalysisComplete(result)).toThrow(/analysis.*incomplete/i);
  });
});
