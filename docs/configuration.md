# Configuration

stopslop reads `stopslop.json` from the analyzed directory (or `--config <path>`).
Every field is optional and merged over the defaults, so a config only needs the
knobs you want to change. Defaults are calibrated on a 22-repo TypeScript corpus
(see [thresholds.md](thresholds.md)).

The CLI validates StopSlop-owned fields at runtime as well as publishing the
schema: unknown properties, wrong types, and out-of-range values are errors
rather than silently ignored configuration.

## Full example (all defaults)

```json
{
  "$schema": "https://unpkg.com/stopslop/schema.json",
  "cognitiveComplexity": 15,
  "godModule": { "minMembers": 15, "minClusters": 3, "minComplexity": 150, "sizeMembers": 37, "sizeComplexity": 350 },
  "godClass": { "minMembers": 12, "minClusters": 3, "minComplexity": 90, "sizeMembers": 30, "sizeComplexity": 200 },
  "multipleExportedClasses": { "maxPerFile": 1 },
  "duplicates": { "minTokens": 50, "minLines": 5, "ignoreIdentifiers": false, "ignoreLiterals": false },
  "deadCode": { "exports": true, "dependencies": true, "files": true, "orphans": true, "production": false },
  "knip": {
    "workspaces": {
      ".": { "entry": ["src/index.ts"] },
      "packages/*": { "entry": ["src/index.ts"], "project": ["src/**/*.ts"] }
    }
  },
  "score": {
    "weights": { "god": 0.35, "duplication": 0.25, "complexity": 0.2, "deadCode": 0.2 },
    "budgets": { "god": 0.1, "duplication": 0.3, "complexity": 4, "deadCode": 4 },
    "floors": { "god": 0, "duplication": 0.05, "complexity": 0, "deadCode": 0 }
  },
  "hubFanInRatio": 0.5,
  "ignore": []
}
```

## Disabling a check

Set any check to `false` to turn it off entirely:

```json
{
  "godModule": false,
  "multipleExportedClasses": false
}
```

## Metrics

### `cognitiveComplexity` — number | false

Functions whose cognitive complexity (Campbell / SonarSource spec) is **strictly
above** this value are reported. Default **15** (the Sonar community default; on
the corpus it sits between count p95 ≈ 13 and p99 ≈ 38). Lower = stricter.

```json
{ "cognitiveComplexity": 20 }
```

### `godClass` / `godModule` — object | false

A class (or a module's top-level definitions) is flagged on **either** of two
axes — see [ARCH.md](../ARCH.md) for the reasoning.

| field | meaning | default (class / module) |
|---|---|---|
| `minMembers` | dispersion axis: minimum methods / top-level definitions | 12 / 15 |
| `minClusters` | dispersion axis: minimum **substantive** responsibility groups (≥2 members) | 3 / 3 |
| `minComplexity` | dispersion axis: minimum total (Σ) cognitive complexity | 90 / 150 |
| `sizeMembers` | size/WMC axis: method count that alone signals a monolith | 30 / 37 |
| `sizeComplexity` | size/WMC axis: total complexity (WMC) that alone signals a monolith | 200 / 350 |

- **Dispersion** fires when `members ≥ minMembers AND groups ≥ minClusters AND
  Σcomplexity ≥ minComplexity` — a class doing several unrelated things, with
  clean split boundaries in the report.
- **Size (WMC)** fires when `members ≥ sizeMembers AND Σcomplexity ≥
  sizeComplexity` — a densely-connected monolith too large to be one unit, even
  if fully cohesive. Reported honestly as "no automatic split boundaries".

Raise `size*` for fewer, higher-confidence size findings; raise `minClusters` to
demand more distinct responsibilities before flagging dispersion.

```json
{
  "godClass": { "sizeMembers": 45, "sizeComplexity": 300 },
  "godModule": false
}
```

### `multipleExportedClasses` — object | false

Flags files exporting **more than** `maxPerFile` classes. Default `maxPerFile`
**1** (i.e. flag 2+). Informational severity.

```json
{ "multipleExportedClasses": { "maxPerFile": 2 } }
```

### `duplicates` — object | false

Copy-paste detection, powered by [Clone Alert](https://www.npmjs.com/package/clone-alert).
Only the files stopslop discovered are fed to it, so the ignore rules above apply
here too.

| field | meaning | default |
|---|---|---|
| `minTokens` | minimum duplicated token span reported as a clone | 50 |
| `minLines` | minimum physical lines a clone must span (its tightest occurrence) | 5 |
| `ignoreIdentifiers` | normalize identifier names before matching (Type-2 clones) | `false` |
| `ignoreLiterals` | normalize literal values before matching | `false` |

The default is **exact matching (Type-1 clones)** — the reported percentage is
real copy-paste. Set `ignoreIdentifiers: true` to also catch Type-2 clones (an
agent copy-pasting a block and renaming the variables); the cost is that
structurally-similar boilerplate matches too, which inflates the duplication
ratio on component libraries by several points. `minLines` keeps dense
one-liners (config tables, long template strings) from matching on token count
alone; turn it up to only see substantial clones.

```json
{ "duplicates": { "minTokens": 100, "minLines": 10, "ignoreIdentifiers": true } }
```

### `deadCode` — object | false

Unused code, powered by [Knip](https://knip.dev) via its programmatic session API
(no CLI spawn). This section controls which Knip findings StopSlop reports and
whether Knip runs in production mode. It is StopSlop policy, not Knip's own
configuration.

| field | meaning | default |
|---|---|---|
| `exports` | report unused exports and unused exported types (warn) | `true` |
| `dependencies` | report unused (dev)dependencies from package.json (warn) | `true` |
| `files` | report files unreachable from any entry point (info) | `true` |
| `orphans` | report functions kept alive by nothing but their own paired test (warn) | `true` |
| `production` | analyze as production-only: usage from tests no longer counts | `false` |

Unused files are **info**, not warn, on purpose: they depend on entry-point
detection, which misfires on projects with unconventional entries. Verify before
deleting — or configure `entry` under `stopslop.json#knip`.

An **orphan feature** is a function or class no production code calls, imported
by exactly one file: its own paired test. The trace of a generated feature that
was never wired in — a plain unused export has an innocent explanation ready,
this one has almost none. The finding names both halves to delete, source symbol
and test file, because removing either alone breaks the build or leaves a green
test standing over nothing. It is reported and deliberately never scored: the
point is to get the pair deleted, and a weight in the number removes no code.

Symbols still used inside their own file are excluded, as are shared test
helpers, stories, and non-callable constants — every one of them a way for a
live symbol to look like an orphan. Orphans need Knip to see the test files at
all, which means either a test-runner plugin it recognises or `entry` patterns
covering the tests.

```json
{ "deadCode": { "files": false, "production": true } }
```

### `knip` — object

The complete JSON-compatible [Knip configuration](https://knip.dev/reference/configuration).
This is the **only** Knip configuration StopSlop uses. It never reads, merges,
or executes project `knip.json`, `.knip.json`, or `knip.config.*` files. The
root `package.json` is still project metadata, but its `knip` field is discarded
and never merged. Move any settings StopSlop should use into this property.

```json
{
  "knip": {
    "ignoreDependencies": ["optional-adapter"],
    "workspaces": {
      ".": { "entry": ["src/index.ts"] },
      "packages/*": { "entry": ["src/index.ts"], "project": ["src/**/*.ts"] },
      "packages/cli": { "entry": ["src/cli.ts"] }
    }
  }
}
```

Workspace keys and overrides follow Knip unchanged: `.` configures the root,
glob keys select groups of packages, and a more specific key can override a
group. In a detected monorepo without `knip.workspaces`, findings are still
shown but excluded from the dead-code score because entry-point detection is
not trustworthy enough to grade the repository.

In a single-package project, `entry` and `project` belong directly under
`knip`. In a monorepo they belong under `knip.workspaces`; Knip ignores the
top-level forms once multiple workspaces are present.

One Knip default is changed: StopSlop sets `ignoreExportsUsedInFile` to `true`.
Knip otherwise reports an export nothing imports even when the symbol is used
inside its own file — a `export` keyword wider than it needs to be, which no
behaviour depends on. That is a style nit rather than the structural waste
StopSlop reports. Set it back to `false` under `knip` to get Knip's own default;
the granular per-symbol-type form works as documented upstream.

The package ships `schema.json`. Add
`"$schema": "https://unpkg.com/stopslop/schema.json"` for editor completion,
field descriptions, and validation. StopSlop consumes configuration only; it
does not infer or generate project settings. That project inspection is kept as
a boundary for future external tooling (such as an MCP server).

### `score` — object

Weights, floors, and budgets of the slop level. A signal contributes nothing
below its floor, rises linearly, and saturates at its budget. Full formula and
rationale (all anchors measured on a 41-repo benchmark of mature TypeScript
OSS): [score.md](score.md).

```json
{
  "score": {
    "weights": { "god": 0.35, "duplication": 0.25, "complexity": 0.2, "deadCode": 0.2 },
    "budgets": { "god": 0.1, "duplication": 0.3, "complexity": 4, "deadCode": 4 },
    "floors": { "god": 0, "duplication": 0.05, "complexity": 0, "deadCode": 0 }
  }
}
```

Weights need not sum to 1 — the score divides by the sum of the weights that
actually ran. Disabling a check removes its signal from the formula entirely
rather than scoring it as clean. The "worse than N% of reference repos" anchor
is recomputed with your weights/floors/budgets, so a custom config re-ranks the
corpus with the same yardstick it applies to your repo.

## Engine knobs

### `hubFanInRatio` — number (0..1)

A member referenced by more than this fraction of the unit's methods is treated
as a "hub" (shared glue), removed from the cohesion graph, and the responsibility
groups are recomputed — so a class held together by one shared field still splits
into its real parts. Default **0.5**. Lower = more aggressive splitting.

### `ignore` — string[]

Extra glob patterns (matched against POSIX-relative paths) to exclude, on top of
the built-in excludes (`node_modules`, `dist`/`build`, tests, fixtures, `.d.ts`,
minified/bundled files, and generator subtrees such as openapi-generator).

```json
{ "ignore": ["**/*.generated.ts", "src/legacy/**"] }
```

## Reference

The JSON report (`--json`) echoes the fully-resolved config under `thresholds`,
so you can confirm exactly what ran.
