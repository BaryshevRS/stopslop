import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { analyze, type AnalyzeResult } from '../src/index.js';
import { toJson } from '../src/report/json.js';
import { renderTerminal } from '../src/report/terminal.js';

// StopSlop drives Knip through a bootstrap directory so that no project-local
// Knip config can reach it (see src/knip-options.ts). That isolation is built on
// rebinding paths in Knip's own options object, and a Knip release can extend
// that object without telling us: the run would then still succeed and simply
// stop seeing things. These tests are the alarm for exactly that — each one
// fails loudly if a capability that works today quietly stops working.

const fixtures: string[] = [];

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'stopslop-knip-int-'));
  fixtures.push(root);
  for (const [file, contents] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), contents);
  }
  // Knip resolves nothing without an install, and StopSlop refuses to run then.
  mkdirSync(join(root, 'node_modules'), { recursive: true });
  return root;
}

/** The real path: read stopslop.json from the analyzed root, then analyze. */
function run(root: string): Promise<AnalyzeResult> {
  return analyze(root, loadConfig(root));
}

function kinds(result: AnalyzeResult, kind: string): string[] {
  return result.findings.filter((finding) => finding.kind === kind).map((finding) => finding.file);
}

function isScored(result: AnalyzeResult): boolean {
  return result.metrics.deadCodeMeasured === true;
}

afterEach(() => {
  for (const root of fixtures.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('Knip plugins through the bootstrap', () => {
  const withVitest = {
    'package.json': '{"name":"p","main":"./src/index.ts","devDependencies":{"vitest":"^3.0.0"}}',
    'vitest.config.ts': 'export default { test: { setupFiles: ["./src/setup.ts"] } };\n',
    'src/index.ts': 'export function api(): number { return 1; }\n',
    'src/index.test.ts': 'import { api } from "./index.js";\napi();\n',
    'src/setup.ts': 'globalThis.__ready = true;\n',
  };

  it('enables a plugin from the dependency list, so Knip loads the test files', async () => {
    // An orphan feature can only be found by a run that loaded the tests: it is
    // an export whose sole importer is one. Finding it proves the Vitest
    // plugin contributed its entry patterns.
    const result = await run(fixture(withVitest));

    expect(kinds(result, 'orphan-feature')).toEqual(['src/index.ts']);
  });

  it("reads the tool's own config file for files nothing imports", async () => {
    // `src/setup.ts` has no importer anywhere — it is named as a string inside
    // vitest.config.ts. Keeping it alive means the plugin loaded that config
    // and resolved the value out of it.
    const result = await run(fixture(withVitest));

    expect(kinds(result, 'unused-file')).not.toContain('src/setup.ts');
  });

  it('reports the same file as dead once the config stops naming it', async () => {
    const result = await run(
      fixture({ ...withVitest, 'vitest.config.ts': 'export default { test: {} };\n' }),
    );

    expect(kinds(result, 'unused-file')).toContain('src/setup.ts');
  });

  it('leaves the tool config unreachable when the plugin is not enabled', async () => {
    const result = await run(
      fixture({ ...withVitest, 'package.json': '{"name":"p","main":"./src/index.ts"}' }),
    );

    expect(kinds(result, 'unused-file')).toContain('vitest.config.ts');
  });
});

describe('configuration hints', () => {
  /** A monorepo whose packages enter through a file no default pattern covers. */
  function monorepo(config?: string): Record<string, string> {
    const files: Record<string, string> = {
      'package.json': '{"name":"mono","private":true,"workspaces":["packages/*"]}',
    };
    if (config) files['stopslop.json'] = config;
    for (const name of ['core', 'ui']) {
      files[`packages/${name}/package.json`] = `{"name":"${name}"}`;
      const imports = Array.from({ length: 12 }, (_, i) => `import "./mod${i}.js";`);
      files[`packages/${name}/src/api.ts`] = `${imports.join('\n')}\n`;
      for (let i = 0; i < 12; i++) {
        files[`packages/${name}/src/mod${i}.ts`] = `export const v${i} = ${i};\n`;
      }
    }
    return files;
  }

  it('asks Knip what the configuration is missing, and withholds the score', async () => {
    const result = await run(fixture(monorepo()));

    expect(result.configHints.map((hint) => hint.identifier)).toEqual([
      'packages/core',
      'packages/ui',
    ]);
    expect(result.configHints[0]?.type).toBe('workspace-unconfigured');
    // Reported, but never scored: a landslide of false positives from a
    // misconfigured run must not outrank real structural slop.
    expect(kinds(result, 'unused-file').length).toBeGreaterThan(20);
    expect(isScored(result)).toBe(false);
  });

  it('words the hint against stopslop.json, never knip.json', async () => {
    const result = await run(fixture(monorepo()));

    const messages = result.configHints.map((hint) => hint.message).join('\n');
    expect(messages).toContain('workspaces["packages/core"]');
    expect(messages).not.toContain('knip.json');
  });

  it('names the file passed to --config as the one to edit', async () => {
    // The tmpdir root is a symlink on macOS: the analysis resolves it, and the
    // config path has to be resolved the same way to stay inside the root.
    const root = fixture({ ...monorepo(), 'config/stopslop.json': '{}' });
    const result = await analyze(root, loadConfig(root, join(root, 'config/stopslop.json')));

    const report = JSON.parse(toJson(result)) as { configFile: { path: string } };
    expect(report.configFile.path).toBe('config/stopslop.json');
    expect(renderTerminal(result, false)).toContain('`knip` in config/stopslop.json');
    expect(result.notes.join('\n')).toContain('fix the config hints in config/stopslop.json');
  });

  it('clears the hint and scores the run once the configuration answers it', async () => {
    const result = await run(
      fixture(monorepo('{"knip":{"workspaces":{"packages/*":{"entry":["src/api.ts"]}}}}')),
    );

    expect(kinds(result, 'unused-file')).toEqual([]);
    expect(result.configHints).toEqual([]);
    expect(isScored(result)).toBe(true);
  });
});
