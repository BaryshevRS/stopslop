import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temporaryRoot = mkdtempSync(join(tmpdir(), 'stopslop-package-smoke-'));

try {
  const packDirectory = join(temporaryRoot, 'pack');
  const consumerDirectory = join(temporaryRoot, 'consumer');
  mkdirSync(packDirectory);
  mkdirSync(consumerDirectory);

  const pack = run(
    'npm',
    ['pack', '--ignore-scripts', '--json', '--pack-destination', packDirectory],
    repositoryRoot,
  );
  const [manifest] = JSON.parse(pack.stdout);
  if (!manifest?.filename || !Array.isArray(manifest.files)) {
    throw new Error('npm pack did not return a package manifest');
  }
  verifyPacklist(manifest.files.map((file) => file.path));

  const tarball = join(packDirectory, manifest.filename);
  writeFileSync(
    join(consumerDirectory, 'package.json'),
    `${JSON.stringify({ private: true, type: 'module' }, null, 2)}\n`,
  );
  run(
    'npm',
    [
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--package-lock=false',
      tarball,
    ],
    consumerDirectory,
  );

  const installedRoot = join(consumerDirectory, 'node_modules', 'stopslop');
  const installedPackage = JSON.parse(readFileSync(join(installedRoot, 'package.json'), 'utf8'));
  if (installedPackage.version !== manifest.version) {
    throw new Error(`installed ${installedPackage.version}, packed ${manifest.version}`);
  }

  const installedBin = join(
    consumerDirectory,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'stopslop.cmd' : 'stopslop',
  );
  if (!existsSync(installedBin)) throw new Error('npm did not install the stopslop binary');
  const help = run(installedBin, ['--help'], consumerDirectory);
  if (!help.stdout.includes('stopslop') || !help.stdout.includes('--base <ref>')) {
    throw new Error('installed CLI did not render the expected help');
  }

  run(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      "const api = await import('stopslop'); if (typeof api.analyze !== 'function') process.exit(1)",
    ],
    consumerDirectory,
  );

  process.stdout.write(
    `package smoke passed: stopslop@${manifest.version} (${manifest.files.length} files)\n`,
  );
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}

function verifyPacklist(paths) {
  const required = [
    'LICENSE',
    'README.md',
    'package.json',
    'schema.json',
    'dist/cli.js',
    'dist/index.js',
    'dist/index.d.ts',
  ];
  for (const path of required) {
    if (!paths.includes(path)) throw new Error(`npm package is missing ${path}`);
  }
  const forbidden = paths.find(
    (path) => path.startsWith('src/') || path.startsWith('test/') || path.startsWith('.github/'),
  );
  if (forbidden) throw new Error(`npm package unexpectedly contains ${forbidden}`);
}

function run(command, args, cwd) {
  const env = {
    ...process.env,
    npm_config_cache: join(temporaryRoot, 'npm-cache'),
    npm_config_update_notifier: 'false',
  };
  delete env.npm_config_verify_deps_before_run;
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed (${result.status})\n${result.stdout}${result.stderr}`,
    );
  }
  return result;
}
