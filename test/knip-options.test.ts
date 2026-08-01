import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { isUnconfiguredMonorepo } from '../src/analyzers/dead-code.js';
import { createKnipOptions } from '../src/knip-options.js';

const fixtures: string[] = [];

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'stopslop-knip-'));
  fixtures.push(root);
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', 'entry.ts'), 'export const entry = true;\n');
  return root;
}

function write(root: string, file: string, contents: string): void {
  writeFileSync(join(root, file), contents);
}

afterEach(() => {
  for (const root of fixtures.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('stopslop Knip options', () => {
  it('uses only stopslop.knip, never ambient Knip configuration sources', async () => {
    const root = fixture();
    // If Knip's normal config discovery runs, package.json#knip fails validation,
    // knip.json changes the entry point, and this JS config throws on import.
    write(root, 'package.json', JSON.stringify({ name: 'fixture', knip: { entry: 42 } }));
    write(root, 'knip.json', JSON.stringify({ entry: ['ambient/never-use.ts'] }));
    write(root, 'knip.config.js', "throw new Error('knip.config.js must never execute');\n");

    const config = {
      knip: {
        entry: ['src/entry.ts'],
        project: ['src/**/*.ts'],
        workspaces: {
          '.': { entry: ['src/entry.ts'] },
          'packages/*': { project: ['src/**/*.ts'] },
        },
      },
    } as Parameters<typeof createKnipOptions>[1];

    const options = await createKnipOptions(root, config);

    expect(options.cwd).toBe(root.replaceAll('\\', '/'));
    expect(options.parsedConfig.entry).toEqual(['src/entry.ts']);
    expect(options.parsedConfig.project).toEqual(['src/**/*.ts']);
    expect(options.parsedConfig.workspaces).toEqual({
      '.': { entry: ['src/entry.ts'] },
      'packages/*': { project: ['src/**/*.ts'] },
    });
  });

  it('does not execute an ambient JavaScript Knip config', async () => {
    const root = fixture();
    write(root, 'package.json', JSON.stringify({ name: 'fixture' }));
    write(root, 'knip.config.js', "throw new Error('ambient Knip config executed');\n");

    await expect(
      createKnipOptions(root, { knip: { entry: ['src/entry.ts'] } }),
    ).resolves.toMatchObject({
      cwd: root.replaceAll('\\', '/'),
      parsedConfig: { entry: ['src/entry.ts'] },
    });
  });

  it('ignores exports used inside their own file, unless the project says otherwise', async () => {
    const root = fixture();
    write(root, 'package.json', JSON.stringify({ name: 'fixture' }));

    // Default: a symbol called within its own file is not an unused export. The
    // `export` keyword is merely wider than needed, which is not the waste we
    // report — and it is indistinguishable from a genuinely orphaned symbol.
    const byDefault = await createKnipOptions(root, { knip: {} });
    expect(byDefault.parsedConfig.ignoreExportsUsedInFile).toBe(true);

    const overridden = await createKnipOptions(root, {
      knip: { ignoreExportsUsedInFile: false },
    });
    expect(overridden.parsedConfig.ignoreExportsUsedInFile).toBe(false);

    const granular = await createKnipOptions(root, {
      knip: { ignoreExportsUsedInFile: { interface: true } },
    });
    expect(granular.parsedConfig.ignoreExportsUsedInFile).toEqual({ interface: true });
  });

  it('preserves package-manager workspace discovery metadata after rebinding', async () => {
    const root = fixture();
    write(root, 'package.json', JSON.stringify({ name: 'fixture', workspaces: ['packages/*'] }));

    const options = await createKnipOptions(root, {
      knip: { workspaces: { 'packages/*': { entry: ['src/index.ts'] } } },
    });

    expect(options.cwd).toBe(root.replaceAll('\\', '/'));
    expect(options.workspaces).toEqual(['packages/*']);
    expect(options.parsedConfig.workspaces).toEqual({
      'packages/*': { entry: ['src/index.ts'] },
    });
  });
});

describe('unconfigured-monorepo guard', () => {
  it('uses only stopslop knip.workspaces, including dot and glob workspace keys', () => {
    expect(isUnconfiguredMonorepo('/repo')).toBe(true);
    expect(isUnconfiguredMonorepo('/repo', { workspaces: {} })).toBe(false);
    expect(
      isUnconfiguredMonorepo('/repo', {
        workspaces: {
          '.': { entry: ['src/index.ts'] },
          'packages/*': { project: ['src/**/*.ts'] },
        },
      }),
    ).toBe(false);
  });

  it('does not treat ambient Knip config files or package.json#knip as configuration', () => {
    const root = fixture();
    write(
      root,
      'package.json',
      JSON.stringify({ workspaces: ['packages/*'], knip: { workspaces: { 'packages/*': {} } } }),
    );
    write(root, 'knip.json', JSON.stringify({ workspaces: { 'packages/*': {} } }));

    expect(isUnconfiguredMonorepo(root)).toBe(true);
  });
});
