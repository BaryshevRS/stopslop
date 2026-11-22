interface Community {
  nodes: string[];
  incoming: number;
  outgoing: number;
  neighbors: Map<Community, number>;
}

/** Weight every edge to a dependency by the inverse of its fan-in. */
function dedicationGraph(dependencies: ReadonlyMap<string, ReadonlySet<string>>): Community[] {
  const graph = new Map<string, Community>();
  const fanIn = new Map<string, number>();

  for (const [name, refs] of dependencies) {
    graph.set(name, { nodes: [name], incoming: 0, outgoing: 0, neighbors: new Map() });

    for (const ref of refs) {
      if (ref !== name && dependencies.has(ref)) fanIn.set(ref, (fanIn.get(ref) ?? 0) + 1);
    }
  }

  for (const [name, refs] of dependencies) {
    const source = graph.get(name)!;

    for (const ref of refs) {
      const target = graph.get(ref);

      if (!target || source === target) continue;

      const weight = 1 / fanIn.get(ref)!;
      source.outgoing += weight;
      target.incoming += weight;
      connect(source, target, weight);
    }
  }

  return [...graph.values()];
}

function connect(a: Community, b: Community, weight: number): void {
  const combined = (a.neighbors.get(b) ?? 0) + weight;
  a.neighbors.set(b, combined);
  b.neighbors.set(a, combined);
}

function merge(into: Community, from: Community): void {
  into.nodes.push(...from.nodes);
  into.incoming += from.incoming;
  into.outgoing += from.outgoing;
  into.neighbors.delete(from);

  for (const [neighbor, weight] of from.neighbors) {
    if (neighbor === into) continue;

    neighbor.neighbors.delete(from);
    connect(into, neighbor, weight);
  }
}

/**
 * SArF's original greedy maximization of directed modularity, using the best
 * cut of the merge tree. See Kobayashi et al. (ICSM 2012), equations 1 and 4.
 * https://arxiv.org/abs/1306.2096
 */
export function clusterDependencies(dependencies: ReadonlyMap<string, ReadonlySet<string>>): string[][] {
  const active = new Set(dedicationGraph(dependencies));
  const totalWeight = [...active].reduce((total, node) => total + node.outgoing, 0);

  for (;;) {
    let best: [Community, Community] | undefined;
    let bestGain = Number.EPSILON * totalWeight;

    for (const a of active) {
      for (const [b, weight] of a.neighbors) {
        // Combined weight and expectation in both directions, scaled by totalWeight.
        const expected = (a.outgoing * b.incoming + b.outgoing * a.incoming) / totalWeight;
        const gain = weight - expected;

        if (gain > bestGain) {
          best = [a, b];
          bestGain = gain;
        }
      }
    }

    if (!best) return [...active].map(({ nodes }) => nodes);

    const [into, from] = best;
    merge(into, from);
    active.delete(from);
  }
}
