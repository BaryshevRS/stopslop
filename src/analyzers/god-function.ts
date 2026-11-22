import { collectFunctions, type FunctionUnit } from './cognitive-complexity.js';
import { extractClosureGraph } from './function-members.js';
import { reactHooks } from './react-hooks.js';
import { clusterDependencies } from './sarf.js';
import { DEFAULT_GOD_FUNCTION } from '../config.js';
import type { Analyzer, Finding, GodFunctionGate, OxcNode, ParsedFile } from '../types.js';

export interface FunctionGroup {
  functions: { name: string; line: number }[];
  state: string[];
  externalDependencies: string[];
}

type ClosureGraph = ReturnType<typeof extractClosureGraph>;

function functionGroups(graph: ClosureGraph, owner: FunctionUnit): FunctionGroup[] {
  const groups: FunctionGroup[] = [];
  const { functions, dependencies, ownerRefs } = graph;

  for (const cluster of clusterDependencies(dependencies)) {
    const members = new Set(cluster);

    const units = cluster.flatMap(name => {
      const unit = functions.get(name);

      return unit ? [unit] : [];
    });

    if (units.length < 2) continue;

    const state = cluster.filter(name => !functions.has(name)).sort();
    const external = new Set(state.filter(name => ownerRefs.has(name)));

    for (const [name, refs] of dependencies) {
      for (const ref of refs) {
        if (members.has(name) && !members.has(ref)) external.add(ref);

        if (!members.has(name) && members.has(ref) && !functions.has(ref)) external.add(ref);
      }
    }

    groups.push({
      functions: units
        .sort((a, b) => a.node.start - b.node.start)
        .map(({ name, line }) => ({ name: name.slice(owner.name.length + 1), line })),
      state,
      externalDependencies: [...external].sort(),
    });
  }

  return groups.sort((a, b) => b.functions.length - a.functions.length || a.functions[0]!.line - b.functions[0]!.line);
}

function closureFindings(file: ParsedFile, gate: GodFunctionGate): Finding[] {
  const units = collectFunctions(file);
  const children = new Map<FunctionUnit, Map<OxcNode, FunctionUnit>>();
  const nestedScores = new Map<FunctionUnit, number>();

  for (let index = units.length - 1; index >= 0; index--) {
    const unit = units[index]!;

    if (!unit.owner) continue;

    let siblings = children.get(unit.owner);

    if (!siblings) children.set(unit.owner, (siblings = new Map()));

    siblings.set(unit.node, unit);
    const total = unit.complexity + (nestedScores.get(unit) ?? 0);
    nestedScores.set(unit.owner, (nestedScores.get(unit.owner) ?? 0) + total);
  }

  const hook = reactHooks(file);
  const findings: Finding[] = [];

  for (const unit of units) {
    const nested = children.get(unit);

    if (!nested || nested.size < 2) continue;

    const nestedComplexity = nestedScores.get(unit) ?? 0;
    const highComplexity = nestedComplexity >= gate.sizeComplexity;

    if (!highComplexity && nested.size < Math.min(gate.sizeMembers, gate.minMembers)) continue;

    const graph = extractClosureGraph(unit, nested, hook);
    const members = graph.functions.size;
    const size = highComplexity || members >= gate.sizeMembers;

    // Inline callback bodies still count toward the scope-wide complexity.
    if (!size && members < gate.minMembers) continue;

    const groups = functionGroups(graph, unit);
    const dispersion = members >= gate.minMembers && groups.length >= gate.minClusters;

    if (!dispersion && !size) continue;

    const axis = dispersion ? 'dispersion' : 'size';

    const message = dispersion
      ? `${unit.name} has ${members} local functions across ${groups.length} extraction candidates`
      : `${unit.name} has ${nested.size} directly nested functions and nested complexity ${nestedComplexity}`;

    findings.push({
      kind: 'god-function',
      file: file.relPath,
      symbol: unit.name,
      line: unit.line,
      severity: 'warn',
      message,
      data: {
        axis,
        members,
        groups,
        groupCount: groups.length,
        nestedComplexity,
        totalComplexity: unit.complexity + nestedComplexity,
      },
    });
  }

  return findings;
}

export function godFunctionAnalyzer(): Analyzer {
  return {
    name: 'god-function',
    analyzeFile(file, { config }) {
      const gate = config.godFunction ?? DEFAULT_GOD_FUNCTION;

      return gate.enabled ? closureFindings(file, gate) : [];
    },
  };
}
