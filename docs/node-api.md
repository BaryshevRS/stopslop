# Node.js API

StopSlop ships a typed ESM API for tools that need findings and metrics in
memory instead of a CLI report. It requires Node.js `^20.19.0 || >=22.12.0`.

## Analyze with defaults

Resolve configuration before calling `analyze`:

```ts
import { analyze, resolveConfig } from 'stopslop';

const result = await analyze(process.cwd(), resolveConfig(undefined));

for (const finding of result.findings) {
  console.log(finding.kind, finding.file, finding.line, finding.message);
}

console.log({
  score: result.slop.score,
  level: result.slop.level,
  errors: result.errors,
  notes: result.notes,
});
```

`findings` contains the issues that should fail the current gate. `slop` always
describes the complete analyzed repository. Check `errors` before trusting a
result; `notes` explains non-fatal skips by project-level engines.

## Load `stopslop.json`

`loadConfig` reads `stopslop.json` from the analysis root and returns the
resolved defaults plus overrides:

```ts
import { analyze, loadConfig } from 'stopslop';

const root = process.cwd();
const result = await analyze(root, loadConfig(root));
```

To build configuration in code, pass the user-facing shape to `resolveConfig`:

```ts
import { analyze, resolveConfig, type StopSlopConfig } from 'stopslop';

const input: StopSlopConfig = {
  cognitiveComplexity: 20,
  duplicates: { minTokens: 100, minLines: 10 },
  deadCode: { files: false },
};

const result = await analyze(process.cwd(), resolveConfig(input));
```

Unknown fields and invalid values throw instead of being ignored.

## Compare with a Git revision

`analyzeGitBase` returns only findings absent from the selected revision while
retaining the current repository's complete score:

```ts
import { analyzeGitBase, loadConfig } from 'stopslop';

const root = process.cwd();
const result = await analyzeGitBase(root, 'origin/main', loadConfig(root));

if (result.errors.length > 0) process.exitCode = 2;
else if (result.findings.length > 0) process.exitCode = 1;
```

The ref must resolve in the local Git repository. StopSlop creates a temporary
detached worktree; it does not switch the current branch or modify the index.

## Extend the analyzer list

Pass a third argument to append a custom analyzer to the built-in set:

```ts
import {
  analyze,
  defaultAnalyzers,
  resolveConfig,
  type Analyzer,
} from 'stopslop';

const custom: Analyzer = {
  name: 'project-policy',
  analyzeFile(file) {
    return file.source.includes('DO NOT SHIP')
      ? [{
          kind: 'unused-file',
          file: file.relPath,
          symbol: 'DO NOT SHIP',
          line: 1,
          severity: 'warn',
          message: 'Unresolved project marker',
        }]
      : [];
  },
};

const result = await analyze(
  process.cwd(),
  resolveConfig(undefined),
  [...defaultAnalyzers(), custom],
);
```

Custom analyzers currently return the published `Finding` union, so use an
existing finding kind for integrations. Treat that surface as pre-1.0; see the
[compatibility policy](../COMPATIBILITY.md).
