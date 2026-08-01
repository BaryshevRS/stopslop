import pc from 'picocolors';
import type { AnalyzeResult } from '../index.js';
import type { SlopLevel } from '../score.js';
import type { Finding } from '../types.js';

// Terminal report — the face of the tool. Compact by default; `--details`
// prints cluster composition (the ready-made refactor boundaries), hubs, and
// every occurrence of a clone.

const KIND_LABEL: Record<Finding['kind'], string> = {
  'god-module': 'god module',
  'god-class': 'god class',
  'cognitive-complexity': 'complex fn',
  'multiple-exported-classes': 'multi-class file',
  'duplicate-code': 'clone',
  'unused-export': 'unused export',
  'unused-dependency': 'unused dep',
  'unused-file': 'unused file',
  'orphan-feature': 'orphan feature',
};

const KIND_ORDER = Object.keys(KIND_LABEL) as Finding['kind'][];

/** Findings per kind shown before collapsing into a "+N more" line. */
const MAX_PER_KIND = 12;

export function renderTerminal(result: AnalyzeResult, details: boolean): string {
  const lines: string[] = [];
  const { findings } = result;

  lines.push('');
  lines.push(
    pc.bold(pc.cyan('  stopslop')) +
      pc.dim(`  ${result.fileCount} files  ${formatKloc(result.loc)}  ${result.elapsedMs}ms`),
  );
  lines.push('');
  lines.push(renderScore(result));
  if (result.gitBase !== undefined) {
    lines.push(
      '  ' +
        pc.dim(
          `git base: ${result.gitBase.ref} (${result.gitBase.commit.slice(0, 12)}) · ${result.gitBase.suppressed} existing · ${findings.length} new`,
        ),
    );
  } else if (result.baselineSuppressed !== undefined) {
    lines.push(
      '  ' +
        pc.dim(
          `baseline: ${result.baselineSuppressed} accepted · ${findings.length} new`,
        ),
    );
  }
  lines.push('');

  if (findings.length === 0) {
    const msg =
      result.gitBase !== undefined
        ? `✓ no new slop since ${result.gitBase.ref}`
        : result.baselineSuppressed !== undefined
          ? '✓ no new slop since baseline'
          : '✓ no slop signals';
    lines.push('  ' + pc.green(msg));
    lines.push('');
    lines.push(renderFooter(result).join('\n'));
    return lines.join('\n');
  }

  const counts = countByKind(findings);
  const chips = KIND_ORDER.filter((k) => counts[k] > 0).map(
    (k) => `${pc.bold(String(counts[k]))} ${pluralize(KIND_LABEL[k], counts[k])}`,
  );
  lines.push('  ' + chips.join(pc.dim('  ·  ')));
  lines.push('');

  const shown: Record<string, number> = {};
  for (const f of findings) {
    const n = (shown[f.kind] = (shown[f.kind] ?? 0) + 1);
    if (n <= MAX_PER_KIND) lines.push(renderFinding(f, details));
  }
  for (const kind of KIND_ORDER) {
    const hidden = counts[kind] - MAX_PER_KIND;
    if (hidden > 0) {
      lines.push(
        '  ' + pc.dim(`… ${hidden} more ${pluralize(KIND_LABEL[kind], hidden)} (--json for all)`),
      );
    }
  }

  lines.push(...renderFooter(result));
  return lines.join('\n');
}

/** The headline: one comparable number, with the densities it came from. */
function renderScore(result: AnalyzeResult): string {
  const { score, level, densities, signalCount, totalSignals, percentile } = result.slop;
  const paint = LEVEL_COLOR[level];
  // A score built from a subset of the signals is not comparable with a full
  // one: the missing weight is renormalized away, which pushes the number UP.
  // Say so, or two runs get compared as if they measured the same thing.
  const partial =
    signalCount < totalSignals
      ? pc.yellow(` — ${signalCount}/${totalSignals} signals, see notes`)
      : '';
  // Context, not another verdict: core signals vs the 41-repo OSS corpus.
  const anchor =
    percentile !== undefined ? pc.dim(`  ·  worse than ${percentile}% of reference repos`) : '';
  const head = `  slop level: ${paint(pc.bold(level))} ${pc.dim(`(${score.toFixed(1)}/100)`)}${anchor}${partial}`;

  const parts: string[] = [];
  if (densities.god !== undefined) parts.push(`god units ${densities.god.toFixed(2)}/KLOC`);
  if (densities.complexity !== undefined)
    parts.push(`complex fns ${densities.complexity.toFixed(2)}/KLOC`);
  if (densities.duplication !== undefined)
    parts.push(`duplication ${(densities.duplication * 100).toFixed(1)}%`);
  if (densities.deadCode !== undefined) parts.push(`dead code ${densities.deadCode.toFixed(2)}/KLOC`);

  return parts.length > 0 ? head + '\n  ' + pc.dim(parts.join('  ·  ')) : head;
}

const LEVEL_COLOR: Record<SlopLevel, (s: string) => string> = {
  clean: pc.green,
  low: pc.green,
  moderate: pc.yellow,
  high: pc.red,
  'legacy-grade': pc.red,
};

function renderFooter(result: AnalyzeResult): string[] {
  const lines: string[] = [''];
  for (const note of result.notes) lines.push('  ' + pc.dim(note));
  if (result.config.preliminary) {
    lines.push('  ' + pc.yellow('thresholds are preliminary (pre-calibration) — see docs/thresholds.md'));
  }
  if (result.errors.length > 0) {
    lines.push('  ' + pc.dim(`${result.errors.length} file(s) skipped on error`));
  }
  // Attribution is not optional: two of the four checks are other people's engines.
  lines.push('  ' + pc.dim('clones: Clone Alert  ·  dead code: Knip'));
  lines.push('');
  return lines;
}

function renderFinding(f: Finding, details: boolean): string {
  const tag = tagFor(f);
  const loc = pc.dim(`${f.file}:${f.line}`);
  const out = [`  ${tag} ${f.message}`, `      ${loc}`];

  if (f.kind === 'duplicate-code') {
    const occurrences = (f.data?.occurrences as CloneOccurrence[]) ?? [];
    // The first occurrence is already on the location line above.
    const rest = occurrences.slice(1);
    const list = details ? rest : rest.slice(0, 3);
    for (const o of list) out.push('      ' + pc.dim(`also ${o.file}:${o.startLine}-${o.endLine}`));
    if (!details && rest.length > list.length) {
      out.push('      ' + pc.dim(`also +${rest.length - list.length} more`));
    }
    return out.join('\n');
  }

  if (details && (f.kind === 'god-module' || f.kind === 'god-class')) {
    const axis = f.data?.axis as string | undefined;
    const groups = (f.data?.groups as string[][]) ?? [];
    const standalone = (f.data?.standalone as string[]) ?? [];
    const hubs = (f.data?.hubs as string[]) ?? [];
    if (hubs.length > 0) {
      out.push('      ' + pc.dim('cohesion held together by: ') + pc.yellow(hubs.join(', ')));
    }
    if (axis === 'size' && groups.length < 3) {
      // densely coupled monolith — no clean automatic boundaries
      out.push(
        '      ' +
          pc.dim('densely coupled — no clean split boundaries; decompose by responsibility manually'),
      );
      // Only show partial grouping when there is real substructure (2+ groups),
      // not one giant blob.
      if (groups.length >= 2) {
        out.push('      ' + pc.dim('partial grouping:'));
        groups.forEach((c, i) => out.push('        ' + pc.dim(`${i + 1}.`) + ' ' + c.join(', ')));
      }
    } else {
      out.push('      ' + pc.dim(`${groups.length} responsibility groups (suggested split boundaries):`));
      groups.forEach((c, i) => {
        out.push('        ' + pc.dim(`${i + 1}.`) + ' ' + c.join(', '));
      });
      if (standalone.length > 0) {
        out.push('      ' + pc.dim(`+ ${standalone.length} standalone: `) + pc.dim(previewList(standalone)));
      }
    }
  }
  return out.join('\n');
}

interface CloneOccurrence {
  file: string;
  startLine: number;
  endLine: number;
}

function formatKloc(loc: number): string {
  return loc >= 1000 ? `${(loc / 1000).toFixed(1)} KLOC` : `${loc} LOC`;
}

function pluralize(label: string, n: number): string {
  if (n === 1) return label;
  return /(s|x|ch|sh)$/.test(label) ? `${label}es` : `${label}s`;
}

function previewList(names: string[], max = 8): string {
  if (names.length <= max) return names.join(', ');
  return names.slice(0, max).join(', ') + `, …+${names.length - max}`;
}

function tagFor(f: Finding): string {
  const label = ` ${KIND_LABEL[f.kind]} `;
  switch (f.kind) {
    case 'god-module':
    case 'god-class':
      return pc.bgRed(pc.white(pc.bold(label)));
    case 'cognitive-complexity':
    case 'duplicate-code':
      return pc.bgYellow(pc.black(label));
    case 'unused-export':
    case 'unused-dependency':
    case 'unused-file':
      return pc.bgMagenta(pc.white(label));
    // The one dead-code finding confident enough to delete on sight.
    case 'orphan-feature':
      return pc.bgRed(pc.white(pc.bold(label)));
    default:
      return pc.bgBlue(pc.white(label));
  }
}

function countByKind(findings: Finding[]): Record<Finding['kind'], number> {
  const counts = Object.fromEntries(KIND_ORDER.map((k) => [k, 0])) as Record<Finding['kind'], number>;
  for (const f of findings) counts[f.kind]++;
  return counts;
}
