import { describe, expect, it } from 'vitest';
import { resolveConfig, DEFAULT_CONFIG } from '../src/config.js';

describe('resolveConfig', () => {
  it('returns defaults for empty input', () => {
    const c = resolveConfig(undefined);
    expect(c.cognitiveComplexity).toEqual({ enabled: true, threshold: 15 });
    expect(c.godClass.enabled).toBe(true);
    expect(c.multipleExportedClasses).toEqual({ enabled: true, maxPerFile: 1 });
  });

  it('overrides a scalar threshold', () => {
    const c = resolveConfig({ cognitiveComplexity: 25 });
    expect(c.cognitiveComplexity).toEqual({ enabled: true, threshold: 25 });
  });

  it('disables a check with false', () => {
    const c = resolveConfig({ cognitiveComplexity: false, godModule: false });
    expect(c.cognitiveComplexity.enabled).toBe(false);
    expect(c.godModule.enabled).toBe(false);
    expect(c.godClass.enabled).toBe(true); // untouched
  });

  it('deep-merges partial god gates over defaults', () => {
    const c = resolveConfig({ godClass: { sizeMembers: 50 } });
    expect(c.godClass.sizeMembers).toBe(50);
    expect(c.godClass.minMembers).toBe(DEFAULT_CONFIG.godClass.minMembers); // kept
    expect(c.godClass.enabled).toBe(true);
  });

  it('overrides multipleExportedClasses.maxPerFile', () => {
    const c = resolveConfig({ multipleExportedClasses: { maxPerFile: 3 } });
    expect(c.multipleExportedClasses).toEqual({ enabled: true, maxPerFile: 3 });
  });

  it('keeps defaults immutable across calls', () => {
    resolveConfig({ godClass: { minMembers: 999 } });
    expect(DEFAULT_CONFIG.godClass.minMembers).toBe(12);
  });

  it('merges partial duplicates and dead-code gates', () => {
    const c = resolveConfig({ duplicates: { minTokens: 100 }, deadCode: { files: false } });
    expect(c.duplicates.minTokens).toBe(100);
    expect(c.duplicates.minLines).toBe(DEFAULT_CONFIG.duplicates.minLines); // kept
    expect(c.deadCode.files).toBe(false);
    expect(c.deadCode.exports).toBe(true); // kept
  });

  it('disables the stage-2 engines with false', () => {
    const c = resolveConfig({ duplicates: false, deadCode: false });
    expect(c.duplicates.enabled).toBe(false);
    expect(c.deadCode.enabled).toBe(false);
  });

  it('merges score weights, budgets, and floors independently', () => {
    const c = resolveConfig({
      score: { weights: { god: 0.5 }, budgets: { duplication: 0.2 }, floors: { duplication: 0.1 } },
    });
    expect(c.score.weights.god).toBe(0.5);
    expect(c.score.weights.complexity).toBe(DEFAULT_CONFIG.score.weights.complexity);
    expect(c.score.budgets.duplication).toBe(0.2);
    expect(c.score.budgets.god).toBe(DEFAULT_CONFIG.score.budgets.god);
    expect(c.score.floors.duplication).toBe(0.1);
    expect(c.score.floors.god).toBe(DEFAULT_CONFIG.score.floors.god);
  });

  it('preserves a top-level Knip config verbatim and ignores $schema as runtime config', () => {
    const knip = {
      $schema: 'https://unpkg.com/knip@6/schema.json',
      entry: ['src/index.ts'],
      project: ['src/**/*.ts'],
      ignore: ['src/generated/**'],
      workspaces: {
        '.': { entry: ['src/index.ts'] },
        'packages/*': { project: ['src/**/*.ts'] },
      },
    };

    const config = resolveConfig({
      $schema: 'https://stopslop.dev/schema.json',
      knip,
    });

    expect(config.knip).toEqual(knip);
    expect(config).not.toHaveProperty('$schema');
  });

  it('does not mutate a supplied Knip config', () => {
    const knip = { entry: ['src/index.ts'], workspaces: { '.': { project: ['src/**/*.ts'] } } };

    expect(resolveConfig({ knip }).knip).toEqual(knip);
    expect(knip).toEqual({ entry: ['src/index.ts'], workspaces: { '.': { project: ['src/**/*.ts'] } } });
  });
});
