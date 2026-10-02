# StopSlop

[![StopSlop](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/BaryshevRS/stopslop/main/stopslop-badge.json)](https://github.com/BaryshevRS/stopslop) [![clone-alert: 0 clones](https://img.shields.io/badge/clone--alert-0%20clones-brightgreen)](https://github.com/BaryshevRS/clone-alert) [![CI](https://github.com/BaryshevRS/stopslop/actions/workflows/ci.yml/badge.svg)](https://github.com/BaryshevRS/stopslop/actions/workflows/ci.yml) [![npm version](https://img.shields.io/npm/v/stopslop.svg)](https://www.npmjs.com/package/stopslop)
<!-- clone-alert badge: pnpm exec clone-alert --minimum-tokens 100 --files src --format shields --no-fail-on-violation -->

**Stop AI-generated code from becoming instant legacy.**

Coding agents are good at making code compile. They are also good at making too
much of it: tangled functions, god files, copied blocks, dead exports, and entire
features that pass their own tests but are never connected to the application.

StopSlop is a static analyzer for JavaScript and TypeScript codebases under
heavy AI-agent change. It catches that structural overproduction before it
becomes permanent. It complements ESLint, Biome, Oxlint, SonarQube, and
SonarCloud rather than repeating their style and type rules.

```bash
npx stopslop .
```

It runs locally against JavaScript and TypeScript. No account. No source-code
upload.

## What it catches

- **Tangled functions** using cognitive complexity from the SonarSource
  specification.
- **God classes and god modules** that mix unrelated responsibilities or have
  grown into densely connected monoliths.
- **Useful split boundaries** for god units when cohesion exposes responsibility
  groups that should move together.
- **Copy-pasted blocks**, with optional identifier normalization to catch copies
  whose variables were renamed.
- **Dead exports, dependencies, and files.**
- **Orphan features** kept alive only by their own paired test but called by no
  production code.
- **Files exporting multiple classes**, a common sign that generation kept
  appending instead of designing.

Complexity and structural analysis are implemented by StopSlop. Clone detection
uses [Clone Alert](https://www.npmjs.com/package/clone-alert); dead-code analysis
uses [Knip](https://knip.dev). StopSlop detects code patterns, not whether a human
or an AI wrote them.

## Start with one command

Run without installing:

```bash
npx stopslop .
```

Or pin it in the project so local runs and CI use the same version:

```bash
npm install --save-dev stopslop
npx stopslop .

# pnpm
pnpm add -D stopslop
pnpm exec stopslop .

# Yarn
yarn add --dev stopslop
yarn stopslop .
```

The default report gives you the full repository score, the signal densities,
and a grouped finding list. Add `--details` to show all clone locations and the
suggested split boundaries for god units; use `--json` for every finding.

```text
  stopslop  27 files  4.3 KLOC  980ms

  slop level: low (22.3/100)  ·  worse than 49% of reference repos
  god units 0.00/KLOC  ·  complex fns 4.42/KLOC  ·  duplication 0.8%
  baseline: 23 accepted · 0 new

  ✓ no new slop since baseline
```

Exit codes are made for CI: `0` means clear, `1` means findings, and `2` means
the analysis itself failed.

## Adopt an existing codebase without cleaning it first

You do not need a perfect repository to start. Record today's findings once,
commit them, and fail only when a change adds an unaccepted finding:

```bash
# Record accepted legacy.
npx stopslop . \
  --baseline .stopslop-baseline.json \
  --update-baseline

git add .stopslop-baseline.json

# Use the same file as the CI gate.
npx stopslop . --baseline .stopslop-baseline.json
```

The baseline is a sorted, reviewable list of finding identities. Updating it is
an explicit acceptance of debt, so baseline changes should be reviewed like
source changes.

The baseline never lowers the score. These three surfaces answer different
questions:

| Surface | What it tells you |
| --- | --- |
| Findings | What needs attention in this run |
| Gate | Whether any finding remains unaccepted |
| Score | How much slop the complete repository carries, including accepted legacy |

A baselined run therefore remains honest: the report can show
`moderate (43/100)`, `30 accepted`, and `0 new` while the gate is green.

## Put the gate in your README

The badge is deliberately binary. It is a public CI status, not a miniature
analytics report.

```text
AI slop | clear       0 unaccepted findings
AI slop | detected    1 or more unaccepted findings
```

Generate the [Shields endpoint JSON](https://shields.io/badges/endpoint-badge)
with the same baseline used by CI:

```bash
npx stopslop . \
  --baseline .stopslop-baseline.json \
  --format shields > stopslop-badge.json
```

Commit or publish `stopslop-badge.json`, then add this Markdown:

```md
[![AI slop](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/OWNER/REPO/main/stopslop-badge.json)](https://github.com/BaryshevRS/stopslop)
```

Replace `OWNER/REPO` in the image URL with your repository. Keep the outer link
unchanged: clicking the badge takes readers to StopSlop.

Without `--baseline` or `--base`, `clear` requires zero findings across the
entire scan. With a baseline, it requires zero findings outside the committed
baseline. The full score is still present in the terminal and JSON reports.

`--format shields` exits `0` for both `clear` and `detected` so a publishing step
can write the current state. An incomplete or failed analysis exits `2` before
emitting a badge.

## Gate pull requests

Use a committed baseline for a stable, explicitly reviewed allowlist:

```yaml
- name: Reject new AI slop
  run: npx stopslop . --baseline .stopslop-baseline.json
```

Or compare the working tree directly with the target branch and keep no baseline
file:

```bash
npx stopslop . --base origin/main
```

`--base` analyzes both revisions and reports findings that exist only in the
current tree. CI must check out enough Git history to resolve the base revision.
The command never switches your branch or changes the index.

For GitHub Code Scanning, emit SARIF before propagating the gate failure:

```bash
npx stopslop . --base origin/main --format sarif > stopslop.sarif
```

See [CI and automation](docs/ci-and-automation.md) for a complete workflow that
uploads SARIF and still preserves StopSlop's exit code.

## Send the findings back to the agent

The JSON report is stable and versioned. Feed it into the next coding-agent turn
instead of paraphrasing terminal output:

```bash
npx stopslop . --json > slop-report.json
```

God-unit findings include member groups that serve as concrete refactoring
boundaries. Clone findings include every occurrence. Baseline and Git-base runs
retain the complete score while returning only new findings.

## Score: trend the repository, do not gate on the number

The `0..100` slop score normalizes findings by KLOC, so a repository can be
compared with itself over time instead of merely growing a larger raw count. It
combines four densities: god units, duplication, over-complex functions, and
dead code.

Floors and budgets are anchored in a benchmark of 41 mature TypeScript
repositories totaling 9.4 MLOC. The weights remain an explicit judgement call,
not a scientific truth. That is why the binary gate uses findings rather than an
arbitrary score cutoff.

The complete formula, calibration rationale, limitations, and corpus comparison
are in [docs/score.md](docs/score.md) and
[docs/thresholds.md](docs/thresholds.md).

## CLI

```text
stopslop [path]            analyze a directory or file (default: .)

  --format <fmt>           text (default) · json · sarif · shields
  --json                   alias for --format json
  --details, -d            show split groups, hubs, and all clone locations
  --fast                   skip clone and dead-code analysis
  --config <file>          use a specific stopslop.json
  --base <ref>             gate on findings absent from a Git revision
  --baseline <file>        gate on findings absent from a baseline file
  --update-baseline        replace the baseline with current findings
  --help, -h               show help
```

Invalid configuration, no supported source files, and hard analysis errors exit
with code `2` before StopSlop emits a report, badge, or baseline.

## Configuration

StopSlop works without configuration. To tune a check, add `stopslop.json`:

```json
{
  "$schema": "https://unpkg.com/stopslop/schema.json",
  "cognitiveComplexity": 20,
  "duplicates": {
    "minTokens": 100,
    "minLines": 10,
    "ignoreIdentifiers": true
  },
  "ignore": ["**/*.generated.ts"]
}
```

Every field is optional. Set a check to `false` to disable it. The published
schema provides editor completion and rejects unknown or invalid properties.

See [docs/configuration.md](docs/configuration.md) for every field, default, and
Knip workspace example. See [stopslop.example.json](stopslop.example.json) for a
complete configuration.

### Dead-code configuration

Knip settings go under `knip` in `stopslop.json`. A project's own `knip.json`,
`.knip.json`, `knip.config.*` and `package.json#knip` are never read, so an
analysis does not change with whatever happens to sit in the directory.
Everything in [Knip's configuration reference](https://knip.dev/reference/configuration)
works there unchanged.

You do not have to work out what belongs there. Run the analysis and Knip
reports what its configuration is missing — which workspace it never reached,
which declared entry point resolved to nothing — under **config hints**, with
the file count each one accounts for:

```
  config hints  (from Knip)
  packages/core  ·  12 files
    Add entry and/or refine project files in workspaces["packages/core"] (12 unused files)
  → Knip settings live under `knip` in stopslop.json (knip.json is not read)
    reference: https://knip.dev/reference/configuration
```

Address them, run again, repeat until they are gone. Until then dead code is
reported but left out of the score, because a run without entry points reports
live files as unreachable. The same list is in `configHints` of `--format json`.

## Node.js API

StopSlop ships ESM JavaScript and TypeScript declarations for programmatic use:

```ts
import { analyze, loadConfig } from 'stopslop';

const root = process.cwd();
const result = await analyze(root, loadConfig(root));

console.log(result.slop.score, result.findings);
```

The API also exports the resolved defaults, scoring helpers, baseline helpers,
and report types. See the [Node.js API guide](docs/node-api.md) for Git-base
analysis, typed configuration, result semantics, and custom analyzers. The API
is experimental before 1.0; see [COMPATIBILITY.md](COMPATIBILITY.md).

## Design and limitations

- StopSlop supports `.js`, `.jsx`, `.mjs`, `.cjs`, `.ts`, and `.tsx` source.
- Tests, generated code, build output, dependencies, and common framework output
  directories are excluded by default.
- A high score does not prove poor engineering, and a low score does not prove
  correctness. StopSlop measures structural overproduction, not total quality.
- Dead-code accuracy depends on Knip knowing the project's entry points; the
  run says so through config hints when it does not.
- A baseline accepts finding identities. If an accepted function becomes more
  complex without changing identity, the score rises but the gate stays clear.

Architecture, research references, and the boundary between published methods
and StopSlop heuristics are documented in [ARCH.md](ARCH.md).

## FAQ

### Is StopSlop an AI-generated code detector?

No. It does not guess who wrote a line of code. It finds structural waste that
coding agents often produce—duplicate blocks, over-complex functions, god
classes and modules, dead code, and orphan features—and reports the same issue
when a human wrote it.

### How is StopSlop different from ESLint, SonarQube, SonarCloud, or Knip?

ESLint and similar linters focus on local rules. SonarQube and SonarCloud are
broad quality platforms. Knip specializes in unused code and dependencies.
StopSlop is a local, zero-account AI code quality gate focused on structural
overproduction. It combines several signals into one report and keeps accepted
legacy visible through its score while blocking only new findings through a
baseline or Git comparison. Knip and
[Clone Alert](https://www.npmjs.com/package/clone-alert) power two of those
signals.

### Can I add StopSlop to a legacy repository?

Yes. Generate `.stopslop-baseline.json`, review and commit it, then use that same
file in CI. Existing findings remain in the score and report as accepted debt;
only unaccepted findings fail the gate.

### Does StopSlop support monorepos and CI code scanning?

Yes. Configure Knip workspaces under `stopslop.json#knip.workspaces` for accurate
dead-code analysis in a monorepo. Use SARIF for GitHub Code Scanning, JSON for
automation and coding agents, or the Shields format for a README status badge.

## Development

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm check:clones
pnpm build
pnpm test:package
pnpm release:check
```

MIT licensed. See [LICENSE](LICENSE).
