import simpleGitHooks from 'simple-git-hooks';

// npm 10 may run `prepare` during `npm pack --ignore-scripts`. Keep the JSON
// output machine-readable while still installing hooks on a normal checkout.
if (process.env.npm_command !== 'pack') {
  const { setHooksFromConfig, skipInstall } = simpleGitHooks;

  if (!skipInstall()) {
    await setHooksFromConfig(process.cwd(), process.argv);
    process.stdout.write('[INFO] Successfully set all git hooks\n');
  }
}
