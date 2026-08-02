export interface AnalysisCompleteness {
  fileCount: number;
  errors: string[];
}

export function assertAnalysisComplete(result: AnalysisCompleteness): void {
  if (result.fileCount === 0) {
    throw new Error('analysis incomplete: no supported source files found');
  }
  if (result.errors.length > 0) {
    throw new Error(`analysis incomplete: ${result.errors.join('; ')}`);
  }
}
