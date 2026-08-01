import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { KnipConfiguration } from 'knip';
import type { MainOptions } from 'knip/session';
import type { ResolvedConfig } from './types.js';

/**
 * Knip settings stopslop applies unless the project overrides them.
 *
 * `ignoreExportsUsedInFile`: Knip's default reports an export that nothing
 * imports even when the symbol is called inside its own file. That is a wider
 * `export` keyword than necessary — a style nit, not slop, and dropping the
 * keyword changes no behaviour. We report structural waste, so those are noise.
 */
const KNIP_DEFAULTS: KnipConfiguration = { ignoreExportsUsedInFile: true };

/**
 * Build Knip session options without letting Knip discover configuration in
 * the analyzed project. Knip's createOptions normally merges an explicit
 * config with package.json#knip, so an explicit path alone is not isolation.
 *
 * A short-lived bootstrap directory gives createOptions a sanitized manifest
 * and the exact stopslop.json#knip object. The parsed options are then rebound
 * to the real package root before a session is created. Project package and
 * workspace manifests remain available to the actual Knip run; only Knip's
 * root configuration discovery happens inside the bootstrap.
 */
export async function createKnipOptions(
  packageRoot: string,
  config: Pick<ResolvedConfig, 'knip'>,
  options: { isProduction?: boolean } = {},
): Promise<MainOptions> {
  const root = resolve(packageRoot);
  const manifestPath = join(root, 'package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
  delete manifest.knip;

  const bootstrap = mkdtempSync(join(tmpdir(), 'stopslop-knip-'));
  const bootstrapManifestPath = join(bootstrap, 'package.json');
  const bootstrapConfigPath = join(bootstrap, 'stopslop-knip.json');
  const pnpmWorkspacePath = join(root, 'pnpm-workspace.yaml');
  const bootstrapPnpmWorkspacePath = join(bootstrap, 'pnpm-workspace.yaml');

  try {
    writeFileSync(bootstrapManifestPath, JSON.stringify(manifest));
    writeFileSync(bootstrapConfigPath, JSON.stringify({ ...KNIP_DEFAULTS, ...config.knip }));
    if (existsSync(pnpmWorkspacePath)) {
      copyFileSync(pnpmWorkspacePath, bootstrapPnpmWorkspacePath);
    }

    const { createOptions } = await import('knip/session');
    const knipOptions = await createOptions({
      cwd: bootstrap,
      args: { config: bootstrapConfigPath },
      isProduction: options.isProduction,
      isSession: true,
    });

    // These paths are the only bootstrap-derived values consumed by a session.
    // parsedConfig/workspaces/catalog contents have already been loaded.
    // Knip keeps graph keys and its cwd in POSIX form, including on Windows.
    // Rebinding the bootstrap cwd with native backslashes makes describeFile()
    // miss every graph node by exact-key lookup.
    knipOptions.cwd = root.replaceAll('\\', '/');
    knipOptions.cacheLocation = join(root, 'node_modules', '.cache', 'knip');
    knipOptions.config = undefined;
    knipOptions.configFilePath = undefined;
    knipOptions.catalog.filePath = existsSync(pnpmWorkspacePath) ? pnpmWorkspacePath : manifestPath;

    return knipOptions;
  } finally {
    rmSync(bootstrap, { recursive: true, force: true });
  }
}
