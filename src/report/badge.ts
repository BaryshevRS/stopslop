import type { AnalyzeResult } from '../index.js';
import type { SlopLevel } from '../score.js';

// A shields.io endpoint payload (https://shields.io/badges/endpoint-badge):
// host this JSON anywhere and point `img.shields.io/endpoint?url=...` at it, so
// shields renders the badge. Promo trinket, not a gate — the number is the
// honest score, and nobody self-adorns "legacy-grade", so a worn badge is only
// ever a flex. Mirrors clone-alert's `--format shields`.

interface ShieldsEndpoint {
  schemaVersion: 1;
  label: string;
  message: string;
  color: string;
}

// Fixed scale rewarding near-zero, with a zero-slop hero state — the flex.
const LEVEL_COLOR: Record<SlopLevel, string> = {
  clean: 'brightgreen',
  low: 'green',
  moderate: 'yellow',
  high: 'orange',
  'legacy-grade': 'red',
};

/** shields.io endpoint JSON for a slop badge. */
export function toBadge(result: AnalyzeResult): string {
  const { score, level, signalCount, totalSignals } = result.slop;
  // A score built from a subset of the signals is inflated (the missing weight
  // is renormalized away). Never let a badge quietly overstate: mark it.
  const partial = signalCount < totalSignals ? '*' : '';
  const message = score === 0 ? '0 slop' : `${level} (${score.toFixed(0)}/100)${partial}`;
  const payload: ShieldsEndpoint = {
    schemaVersion: 1,
    label: 'slop',
    message,
    color: LEVEL_COLOR[level],
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}
