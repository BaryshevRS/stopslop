import type { Analyzer, CohesionUnit, Finding, GodGate, OxcNode, ParsedFile, ResolvedConfig } from '../types.js';
import { computeCognitiveComplexity } from './cognitive-complexity.js';
import { extractClasses, extractModule } from './members.js';
import { computeCohesion } from './cohesion.js';

// God Module / God Class detectors. Same cohesion engine, different extraction.
// Gate = "enough members AND several independent clusters AND high total
// complexity". We take the IDEA of a combined detection strategy from Marinescu
// (ICSM 2004); the calibrated constants are ours.

const complexityOf = (n: OxcNode): number => computeCognitiveComplexity(n);

function functionCount(unit: CohesionUnit): number {
  return unit.members.filter((m) => m.kind === 'function').length;
}
function totalComplexity(unit: CohesionUnit): number {
  return unit.members.reduce((sum, m) => sum + m.complexity, 0);
}

/**
 * Split clusters into substantive responsibility groups (≥2 members — real
 * refactor boundaries) and loose standalone methods. A facade/adapter has a few
 * groups plus many delegating singletons; without this split, LCOM4 reports
 * "split into 31 groups" (26 of them singletons), which is noise.
 */
function splitClusters(unit: CohesionUnit): { groups: string[][]; standalone: string[] } {
  const groups: string[][] = [];
  const standalone: string[] = [];
  for (const c of unit.clusters) {
    if (c.length >= 2) groups.push(c);
    else if (c[0]) standalone.push(c[0]);
  }
  return { groups, standalone };
}

type GodAxis = 'dispersion' | 'size' | null;

/**
 * Two-axis god detection (OR):
 *  - dispersion: several unrelated responsibility groups → clean split boundaries;
 *  - size (WMC): a monolith too large to be one unit, even if fully connected —
 *    the case an agent produces when "everything is honestly connected" but the
 *    class is 2k lines. Cohesion can't (and shouldn't) split a genuinely
 *    connected class, so bulk is a separate axis.
 * Returns which axis fired (dispersion wins if both).
 */
function godAxis(unit: CohesionUnit, gate: GodGate): GodAxis {
  const members = functionCount(unit);
  const total = totalComplexity(unit);
  const { groups } = splitClusters(unit);
  if (members >= gate.minMembers && groups.length >= gate.minClusters && total >= gate.minComplexity) {
    return 'dispersion';
  }
  if (members >= gate.sizeMembers && total >= gate.sizeComplexity) {
    return 'size';
  }
  return null;
}

function cohesionData(unit: CohesionUnit, axis: GodAxis): Record<string, unknown> {
  const { groups, standalone } = splitClusters(unit);
  return {
    axis,
    members: functionCount(unit),
    groups,
    groupCount: groups.length,
    standalone,
    standaloneCount: standalone.length,
    clusterCount: unit.clusters.length,
    hubs: unit.hubs,
    totalComplexity: totalComplexity(unit), // WMC
  };
}

function isBarrelFile(file: ParsedFile): boolean {
  // A barrel is (almost) only re-exports: `export ... from '...'`.
  const body = (file.program.body as OxcNode[]) ?? [];
  let reexports = 0;
  let other = 0;
  for (const node of body) {
    if (
      (node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration') &&
      node.source
    ) {
      reexports++;
    } else if (node.type === 'ImportDeclaration') {
      // ignore
    } else {
      other++;
    }
  }
  return reexports > 0 && other === 0;
}

function countExportedClasses(file: ParsedFile): { count: number; firstLine: number; names: string[] } {
  const body = (file.program.body as OxcNode[]) ?? [];
  const names: string[] = [];
  let firstLine = 1;
  for (const node of body) {
    let decl: OxcNode | null = null;
    if (node.type === 'ExportNamedDeclaration' && node.declaration) decl = node.declaration as OxcNode;
    else if (node.type === 'ExportDefaultDeclaration' && node.declaration) decl = node.declaration as OxcNode;
    if (decl && (decl.type === 'ClassDeclaration' || decl.type === 'ClassExpression')) {
      const id = decl.id as OxcNode | undefined;
      names.push(id ? String(id.name) : '<anonymous>');
      if (names.length === 1) firstLine = file.lineAt(node.start);
    }
  }
  return { count: names.length, firstLine, names };
}

function detectGodModule(file: ParsedFile, config: ResolvedConfig): Finding | null {
  const unit = extractModule(file, complexityOf);
  const cohesion = computeCohesion(unit.members, config.hubFanInRatio);
  unit.clusters = cohesion.clusters;
  unit.hubs = cohesion.hubs;
  const axis = godAxis(unit, config.godModule);
  if (!axis) return null;
  const { groups } = splitClusters(unit);
  const n = functionCount(unit);
  const message =
    axis === 'dispersion'
      ? `Module has ${n} top-level definitions across ${groups.length} unrelated responsibility groups`
      : `Module has ${n} top-level definitions (total complexity ${totalComplexity(unit)}) — too much in one file`;
  return {
    kind: 'god-module',
    file: file.relPath,
    symbol: '<module>',
    line: 1,
    severity: 'warn',
    message,
    data: cohesionData(unit, axis),
    preliminary: config.preliminary,
  };
}

function detectGodClasses(file: ParsedFile, config: ResolvedConfig): Finding[] {
  const findings: Finding[] = [];
  for (const unit of extractClasses(file, complexityOf)) {
    const cohesion = computeCohesion(unit.members, config.hubFanInRatio);
    unit.clusters = cohesion.clusters;
    unit.hubs = cohesion.hubs;
    const axis = godAxis(unit, config.godClass);
    if (!axis) continue;
    const { groups, standalone } = splitClusters(unit);
    const n = functionCount(unit);
    let message: string;
    if (axis === 'dispersion') {
      const tail = standalone.length > 0 ? ` (+${standalone.length} standalone)` : '';
      message = `Class ${unit.name}: ${n} methods across ${groups.length} unrelated responsibility groups${tail}`;
    } else {
      // size axis: densely connected but far too large (WMC)
      message = `Class ${unit.name}: ${n} methods, total complexity ${totalComplexity(unit)} — a single unit doing far too much`;
    }
    findings.push({
      kind: 'god-class',
      file: file.relPath,
      symbol: unit.name,
      line: unit.line,
      severity: 'warn',
      message,
      data: cohesionData(unit, axis),
      preliminary: config.preliminary,
    });
  }
  return findings;
}

function detectMultipleExportedClasses(file: ParsedFile, config: ResolvedConfig): Finding | null {
  const exported = countExportedClasses(file);
  if (exported.count <= config.multipleExportedClasses.maxPerFile) return null;
  return {
    kind: 'multiple-exported-classes',
    file: file.relPath,
    symbol: exported.names.join(','),
    line: exported.firstLine,
    severity: 'info',
    message: `${exported.count} exported classes in one file: ${exported.names.join(', ')}`,
    data: { classes: exported.names },
    preliminary: config.preliminary,
  };
}

function analyzeFile(file: ParsedFile, config: ResolvedConfig): Finding[] {
  if (isBarrelFile(file)) return [];
  const findings: Finding[] = [];

  if (config.godModule.enabled) {
    const f = detectGodModule(file, config);
    if (f) findings.push(f);
  }
  if (config.godClass.enabled) {
    findings.push(...detectGodClasses(file, config));
  }
  if (config.multipleExportedClasses.enabled) {
    const f = detectMultipleExportedClasses(file, config);
    if (f) findings.push(f);
  }

  return findings;
}

export function structureAnalyzer(): Analyzer {
  return {
    name: 'structure',
    analyzeFile(file, ctx) {
      return analyzeFile(file, ctx.config);
    },
  };
}
