import { describe, expect, it } from 'vitest';
import { cognitiveComplexityAnalyzer, collectFunctions } from '../src/analyzers/cognitive-complexity.js';
import { extractClosureGraph } from '../src/analyzers/function-members.js';
import { godFunctionAnalyzer } from '../src/analyzers/god-function.js';
import { reactHooks } from '../src/analyzers/react-hooks.js';
import { clusterDependencies } from '../src/analyzers/sarf.js';
import { resolveConfig, type StopSlopConfig } from '../src/config.js';
import { parseFile } from '../src/parse.js';

function analyze(source: string, config?: StopSlopConfig) {
  const { file } = parseFile('example.tsx', '/example.tsx', source);

  return godFunctionAnalyzer().analyzeFile!(file!, { config: resolveConfig(config) });
}

describe('God Function', () => {
  it('finds extraction candidates across React state and shared dependencies', () => {
    const source = `
      import { useState as state, useCallback as callback } from 'react';
      import * as React from 'react';
      function Player(log) {
        const [mic, setMic] = state(false);
        const [step, setStep] = React.useState(0);
        const start = callback(() => { setMic(true); log('start'); }, []);
        function stop() { setMic(false); log('stop'); }
        React.useEffect(() => { if (mic) log('recording'); }, [mic, step]);
        function advance() { setStep(step + 1); log('next'); }
        function rewind() { setStep(step - 1); log('back'); }
        return <button onClick={start} disabled={mic}>{step}</button>;
      }
    `;

    const config = { godFunction: { minMembers: 4 } };
    expect(analyze(source, config)).toMatchObject([
      {
        kind: 'god-function',
        symbol: 'Player',
        data: {
          axis: 'dispersion',
          members: 5,
          groups: [
            {
              functions: [{ name: 'start' }, { name: 'stop' }, { name: 'useEffect callback' }],
              state: expect.arrayContaining(['mic']),
              externalDependencies: ['log', 'mic'],
            },
            {
              functions: [{ name: 'advance' }, { name: 'rewind' }],
              state: expect.arrayContaining(['step']),
              externalDependencies: expect.arrayContaining(['step']),
            },
          ],
        },
      },
    ]);
    expect(analyze(source)).toEqual([]);
    expect(analyze(source, { godFunction: false })).toEqual([]);
  });

  it('keeps a scope-wide finding when every local score is below the threshold', () => {
    const handlers = Array.from(
      { length: 10 },
      (_, i) => `const handler${i} = () => { if (a) { if (b) { if (c) { if (d) run(); } } } };`,
    );

    const source = `function owner(a,b,c,d) { ${handlers.join('\n')} }`;
    const { file } = parseFile('example.ts', '/example.ts', source);
    expect(cognitiveComplexityAnalyzer().analyzeFile!(file!, { config: resolveConfig(undefined) })).toEqual([]);
    expect(analyze(source)).toEqual([]);
    expect(analyze(source, { godFunction: {} })).toMatchObject([
      {
        symbol: 'owner',
        data: { axis: 'size', nestedComplexity: 100, members: 10 },
      },
    ]);
  });

  it('reports many simple helpers even with very little branching', () => {
    const handlers = Array.from({ length: 30 }, (_, i) => `function handler${i}() { return state; }`);
    expect(analyze(`function owner(state) { ${handlers.join('\n')} }`, { godFunction: {} })).toMatchObject([
      {
        data: { members: 30, nestedComplexity: 0 },
      },
    ]);
  });

  it('uses lexical bindings for shared state and tracks the output of useMemo', () => {
    const { file } = parseFile(
      'example.ts',
      '/example.ts',
      `
      import { useMemo } from 'react';
      function owner(voice, phase, input) {
        const output = useMemo(() => input.value, [input, phase]);
        function capture() { return voice.play(output); }
        function shadow() {
          for (const voice of []) voice.play();
          if (running) { var phase = 1; }
          return phase;
        }
        return output;
      }
    `,
    );

    const [owner, ...nested] = collectFunctions(file!);
    const graph = extractClosureGraph(owner!, new Map(nested.map(fn => [fn.node, fn])), reactHooks(file!));
    expect(graph.dependencies.get('capture')).toEqual(new Set(['voice', 'output']));
    expect(graph.dependencies.get('shadow')).toEqual(new Set());
    expect(graph.dependencies.get('owner.output')).toEqual(new Set(['input', 'output']));
    expect(graph.ownerRefs).toEqual(new Set(['output']));
  });
});

it('clusters a directed graph by dedication through a shared utility', () => {
  const graph = new Map(
    Object.entries({
      start: new Set(['mic', 'log']),
      stop: new Set(['mic', 'log']),
      next: new Set(['step', 'log']),
      rewind: new Set(['step', 'log']),
      mic: new Set<string>(),
      step: new Set<string>(),
      log: new Set<string>(),
    }),
  );

  const groups = clusterDependencies(graph);
  expect(groups).toEqual(clusterDependencies(graph));
  expect(groups).toEqual(
    expect.arrayContaining([
      expect.arrayContaining(['start', 'stop', 'mic']),
      expect.arrayContaining(['next', 'rewind', 'step']),
    ]),
  );
  expect(groups.find(group => group.includes('start'))).not.toContain('next');
});
