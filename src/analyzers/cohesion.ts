import type { CohesionUnit, Member } from '../types.js';

// LCOM4 cohesion graph (Hitz & Montazeri 1995) + hub exclusion (our heuristic,
// see ARCH.md). Nodes are function-members; state members are shared connectors;
// dependency members never connect. A high-fan-in "hub" (glue) is removed and
// components recomputed, so a pseudo-connected monster splits into its real
// responsibility groups.

class UnionFind {
  private parent = new Map<string, string>();
  add(x: string): void {
    if (!this.parent.has(x)) this.parent.set(x, x);
  }
  find(x: string): string {
    let root = x;
    while (this.parent.get(root) !== root) root = this.parent.get(root)!;
    // path compression
    let cur = x;
    while (this.parent.get(cur) !== root) {
      const next = this.parent.get(cur)!;
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }
  union(a: string, b: string): void {
    this.add(a);
    this.add(b);
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
  components(): string[][] {
    const groups = new Map<string, string[]>();
    for (const x of this.parent.keys()) {
      const r = this.find(x);
      (groups.get(r) ?? groups.set(r, []).get(r)!).push(x);
    }
    return [...groups.values()];
  }
}

export interface CohesionResult {
  clusters: string[][];
  hubs: string[];
  /** Number of components if hubs were NOT removed (for diagnostics/tests). */
  clustersBeforeHubs: number;
}

function byKind(members: Member[]): {
  functions: Member[];
  states: Set<string>;
  index: Map<string, Member>;
} {
  const index = new Map<string, Member>();
  const functions: Member[] = [];
  const states = new Set<string>();
  for (const m of members) {
    index.set(m.name, m);
    if (m.kind === 'function') functions.push(m);
    else if (m.kind === 'state') states.add(m.name);
  }
  return { functions, states, index };
}

/** Connected components over function-members, given a set of excluded members. */
function components(
  functions: Member[],
  states: Set<string>,
  excluded: Set<string>,
): string[][] {
  const uf = new UnionFind();
  const active = functions.filter((f) => !excluded.has(f.name));
  for (const f of active) uf.add(f.name);
  const activeNames = new Set(active.map((f) => f.name));

  // call edges: A references function-member B
  for (const f of active) {
    for (const r of f.refs) {
      if (excluded.has(r)) continue;
      if (activeNames.has(r)) uf.union(f.name, r);
    }
  }
  // shared-state edges: functions touching the same state member are connected
  for (const s of states) {
    if (excluded.has(s)) continue;
    let prev: string | null = null;
    for (const f of active) {
      if (f.refs.has(s)) {
        if (prev !== null) uf.union(prev, f.name);
        prev = f.name;
      }
    }
  }
  return uf.components();
}

/** Fan-in per member = number of distinct function-members that reference it. */
function fanIn(functions: Member[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const f of functions) {
    for (const r of f.refs) counts.set(r, (counts.get(r) ?? 0) + 1);
  }
  return counts;
}

export function computeCohesion(members: Member[], hubFanInRatio: number): CohesionResult {
  const { functions, states } = byKind(members);
  if (functions.length === 0) {
    return { clusters: [], hubs: [], clustersBeforeHubs: 0 };
  }

  const before = components(functions, states, new Set());

  // Identify hubs: members whose fan-in exceeds ratio * (#function-members).
  const counts = fanIn(functions);
  const threshold = hubFanInRatio * functions.length;
  const hubs: string[] = [];
  for (const [name, count] of counts) {
    if (count > threshold && count >= 2) hubs.push(name);
  }
  hubs.sort();

  const excluded = new Set(hubs);
  const after = hubs.length > 0 ? components(functions, states, excluded) : before;

  const clusters = after
    .map((c) => [...c].sort())
    .sort((a, b) => (b.length - a.length) || a[0]!.localeCompare(b[0]!));

  return { clusters, hubs, clustersBeforeHubs: before.length };
}

/** Fill clusters/hubs on a unit in place and return it. */
export function annotateCohesion(unit: CohesionUnit, hubFanInRatio: number): CohesionUnit {
  const { clusters, hubs } = computeCohesion(unit.members, hubFanInRatio);
  unit.clusters = clusters;
  unit.hubs = hubs;
  return unit;
}
