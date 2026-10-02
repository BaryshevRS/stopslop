import { readFileSync, writeFileSync } from 'node:fs';

/**
 * Writes a generated artifact. With `--check` it writes nothing and fails when
 * the committed copy differs, so CI catches a source change whose artifact was
 * not regenerated.
 */
export function emitGenerated(path: string, generated: string, label: string, command: string): void {
  if (!process.argv.includes('--check')) {
    writeFileSync(path, generated);
    return;
  }
  let current = '';
  try {
    current = readFileSync(path, 'utf8');
  } catch {
    // The error below explains how to create the missing artifact.
  }
  if (current.replaceAll('\r\n', '\n') !== generated) {
    throw new Error(`${label} is stale; run \`${command}\` and commit the result`);
  }
}
