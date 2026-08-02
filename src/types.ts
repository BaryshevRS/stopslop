import type { KnipConfiguration } from 'knip';

// Core data model shared across the pipeline. See ARCH.md for the rationale
// behind Member.kind and the cohesion model.

export type FindingKind =
  | 'cognitive-complexity'
  | 'god-module'
  | 'god-class'
  | 'multiple-exported-classes'
  // Stage 2 — project-wide, produced by the integrated engines.
  | 'duplicate-code' // Clone Alert
  | 'unused-export' // Knip
  | 'unused-dependency' // Knip
  | 'unused-file' // Knip
  | 'orphan-feature'; // Knip's module graph — dead in production, kept by its own test

export type Severity = 'info' | 'warn';

/** A single reported problem. Identity is `file + symbol` (see baseline, Stage 3). */
export interface Finding {
  kind: FindingKind;
  file: string; // relative to the analysis root, POSIX separators
  symbol: string; // function/class/module name — the stable identity within a file
  line: number; // 1-based
  severity: Severity;
  message: string;
  /** Structured payload for --json consumers and --details rendering. */
  data?: Record<string, unknown>;
  /** Compatibility marker for reports produced with provisional thresholds. */
  preliminary?: boolean;
}

/** A parsed source file with everything analyzers need, produced once per file. */
export interface ParsedFile {
  /** Relative path from the analysis root, POSIX separators. */
  relPath: string;
  absPath: string;
  source: string;
  /** oxc Program node (ESTree-like). Typed loosely; we treat nodes structurally. */
  program: OxcNode;
  /** Convert a 0-based offset into a 1-based line number. */
  lineAt: (offset: number) => number;
}

/** Loose AST node. oxc returns ESTree-shaped nodes with byte/UTF-16 offsets. */
export interface OxcNode {
  type: string;
  start: number;
  end: number;
  [key: string]: unknown;
}

export type MemberKind = 'function' | 'state' | 'dependency';

export interface Member {
  name: string;
  kind: MemberKind;
  /** Cognitive complexity of the member body (0 for plain state/dependency). */
  complexity: number;
  /** Names of same-unit members this member references. */
  refs: Set<string>;
  exported: boolean;
  /** 1-based line of the member declaration. */
  line: number;
  loc: number;
}

export interface CohesionUnit {
  kind: 'module' | 'class';
  /** Module: relative path. Class: class name. */
  name: string;
  file: string;
  line: number;
  members: Member[];
  /** Connected components after hub removal — each a list of member names. */
  clusters: string[][];
  /** Members removed as glue (high fan-in) before recomputing components. */
  hubs: string[];
}

export interface Analyzer {
  name: string;
  /** Stage 1 analyzers: pure AST work, one file at a time. */
  analyzeFile?(file: ParsedFile, ctx: AnalyzeContext): Finding[];
  /** Stage 2 analyzers (Knip, Clone Alert): whole-project, async. */
  analyzeProject?(ctx: ProjectContext): Promise<Finding[]>;
}

export interface AnalyzeContext {
  config: ResolvedConfig;
}

export interface ProjectContext {
  root: string;
  files: ParsedFile[];
  config: ResolvedConfig;
  /** Non-fatal notes from an engine (e.g. "knip skipped: no package.json"). */
  notes: string[];
  /**
   * What the Stage-2 engines actually measured. An engine that was disabled —
   * or that bailed out at runtime — leaves its entry unset, and the score then
   * drops that signal instead of scoring it as clean.
   */
  metrics: Partial<ProjectMetrics>;
}

/** Signals the score is computed from. Absent = not measured (≠ measured zero). */
export interface ProjectMetrics {
  /** Duplicated physical lines / total physical lines, 0..1. */
  duplicationRatio: number;
  /** Set only once Knip has actually produced results. */
  deadCodeMeasured: boolean;
}

export interface GodGate {
  enabled: boolean;
  /** Dispersion axis: several unrelated responsibility groups with real boundaries. */
  minMembers: number;
  minClusters: number;
  minComplexity: number;
  /** Size axis (WMC): a monolith too large to be one unit, even if fully connected. */
  sizeMembers: number;
  sizeComplexity: number;
}

export interface CognitiveGate {
  enabled: boolean;
  /** Functions strictly above this cognitive-complexity score are reported. */
  threshold: number;
}

export interface MultiClassGate {
  enabled: boolean;
  /** Files with more than this many exported classes are reported. */
  maxPerFile: number;
}

/** Clone Alert gate. */
export interface DuplicatesGate {
  enabled: boolean;
  /** Minimum duplicated token span reported as a clone (Clone Alert default: 50). */
  minTokens: number;
  /** Minimum physical lines a clone must span — kills dense one-liner matches. */
  minLines: number;
  /** Ignore identifier names when matching — catches renamed copy-paste. */
  ignoreIdentifiers: boolean;
  /** Ignore literal values when matching. */
  ignoreLiterals: boolean;
}

/** Knip gate. Each issue class can be turned off on its own. */
export interface DeadCodeGate {
  enabled: boolean;
  /** Unused exports and exported types — high confidence. */
  exports: boolean;
  /** Unused (dev)dependencies in package.json — high confidence. */
  dependencies: boolean;
  /** Unused files — depends on entry-point detection; reported as info. */
  files: boolean;
  /** Symbols kept alive by nothing but their own paired test. */
  orphans: boolean;
  /** Treat the project as production-only (drops test-only usage). */
  production: boolean;
}

/**
 * Slop score: weighted sum of per-KLOC densities, each rising from its floor
 * and saturating at its budget. See docs/score.md — the formula is published,
 * not a black box.
 */
export interface ScoreConfig {
  weights: ScoreSignals;
  /** Density (per KLOC; duplication is a 0..1 ratio) that saturates a signal. */
  budgets: ScoreSignals;
  /**
   * Density below which a signal contributes nothing. Zero for most signals;
   * duplication has a real floor — a few percent of duplicated lines is the
   * baseline of any living codebase (benchmark corpus p25 ≈ 5%), not slop.
   */
  floors: ScoreSignals;
}

export interface ScoreSignals {
  god: number;
  complexity: number;
  duplication: number;
  deadCode: number;
}

export interface ResolvedConfig {
  cognitiveComplexity: CognitiveGate;
  godModule: GodGate;
  godClass: GodGate;
  multipleExportedClasses: MultiClassGate;
  duplicates: DuplicatesGate;
  deadCode: DeadCodeGate;
  /** Complete Knip configuration, sourced only from stopslop.json#knip. */
  knip: KnipConfiguration;
  score: ScoreConfig;
  /** fan-in fraction above which a member is treated as a hub (0..1). */
  hubFanInRatio: number;
  ignore: string[];
  /** Whether current thresholds are provisional. False for the calibrated defaults. */
  preliminary: boolean;
}
