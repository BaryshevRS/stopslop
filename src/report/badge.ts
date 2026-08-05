import type { AnalyzeResult } from '../index.js';

// A shields.io endpoint payload (https://shields.io/badges/endpoint-badge):
// host this JSON anywhere and point `img.shields.io/endpoint?url=...` at it, so
// shields renders the badge. The badge is the public state of the gate; the
// terminal and JSON reports retain the complete score and accepted legacy.

interface ShieldsEndpoint {
  schemaVersion: 1;
  label: string;
  message: string;
  color: string;
}

/** shields.io endpoint JSON for the AI-slop gate. */
export function toBadge(result: AnalyzeResult): string {
  const clear = result.findings.length === 0;
  const payload: ShieldsEndpoint = {
    schemaVersion: 1,
    label: 'AI slop',
    message: clear ? 'clear' : 'detected',
    color: clear ? 'brightgreen' : 'red',
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}
