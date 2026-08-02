# stopslop

[![slop](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/BaryshevRS/stopslop/main/stopslop-badge.json)](https://github.com/BaryshevRS/stopslop)

> **0.1 preview.** The CLI and report formats are usable in CI; compatibility
> tiers and the pre-1.0 change policy are documented in
> [COMPATIBILITY.md](COMPATIBILITY.md). Requires Node.js 20.19+ or 22.12+.

**Slop is instant legacy.** A linter checks *how* code is written. **stopslop**
checks whether the agent *overproduced junk* — over-complex functions, god
modules/classes, and responsibilities dumped into one file. It measures how much
uncleaned, unrefactored overproduction a repo carries — whether that took an
agent a week or a team a decade. Zero style or type rules; it is not a competitor
to ESLint/Biome/Oxlint.

```bash
npx stopslop .
```

Or install it in the project so CI uses the version pinned in your lockfile:

```bash
pnpm add --save-dev stopslop
pnpm exec stopslop .
```

## What it finds

- **Cognitive complexity** — functions that are hard to follow, scored by the
  G. Ann Campbell / SonarSource specification.
- **God class** — flagged on either of two axes: **dispersion** (methods split
  into several unrelated responsibility groups — LCOM4 cohesion + hub removal,
  with clean split boundaries) or **size/WMC** (a densely-connected monolith too
  large to be one unit — the "everything is honestly connected but it's 2k lines"
  class an agent produces, which cohesion can't and shouldn't split).
- **God module** — the same, applied to a file's top-level definitions: a
  "dump" of unrelated functions/classes/constants.
- **Multiple exported classes** in one file.
- **Clones** — copy-pasted blocks, *including ones whose variables were renamed*
  (identifiers are normalized before matching). Engine:
  [Clone Alert](https://www.npmjs.com/package/clone-alert).
- **Dead code** — unused exports, unused dependencies, unreachable files. Engine:
  [Knip](https://knip.dev), driven through its programmatic session API and
  configured exclusively under `stopslop.json#knip`.
- **Orphan features** — a function no production code calls, kept alive by
  nothing but its own paired test. A feature that was generated together with
  its test and never wired in: the test is green, the code does nothing. Read
  off Knip's module graph; the finding names both halves to delete.

The last two checks are other people's engines, and we say so in the output.
Everything above them is ours.

Each god finding lists the responsibility groups by member name — ready-made
refactor boundaries.

```
  god class  Class ExpressAdapter: 41 methods across 4 unrelated responsibility groups (+27 standalone)
      4 responsibility groups (suggested split boundaries):
        1. close, closeOpenConnections, initHttpServer, trackOpenConnections
        2. applyStreamHeaders, reply, setHeaderIfNotExists
        3. set, setBaseViewsDir, setViewEngine
        4. isMiddlewareApplied, registerParserMiddleware
```

## Slop level

One number, so a repo can be compared with itself over time and with other repos
regardless of size — absolute counts just track how big the codebase is.

```
  slop level: moderate (49.4/100)
  god units 0.00/KLOC  ·  complex fns 5.81/KLOC  ·  duplication 3.7%  ·  dead code 5.09/KLOC
```

Every signal is a **density** (per KLOC; duplication is a share of lines). Each
rises linearly from a *floor* (below it the density is the baseline of any
living codebase — not slop) to a *budget* (the density at which the signal is as
bad as it gets), then saturates, and is weighted:

```
score = 100 · Σ wᵢ · sat(xᵢ) / Σ wᵢ        (i = enabled signals)
sat(x) = clamp((x − floorᵢ) / (budgetᵢ − floorᵢ), 0, 1)
```

| signal | xᵢ | weight | floor | budget |
|---|---|---|---|---|
| god units | (god modules + god classes) / KLOC | 0.35 | 0 | 0.1 |
| duplication | duplicated lines / total lines | 0.25 | 0.05 | 0.30 |
| complexity | over-complex functions / KLOC | 0.20 | 0 | 4 |
| dead code | (unused exports + deps + files) / KLOC | 0.20 | 0 | 4 |

Floors and budgets are calibrated on a benchmark of **41 mature TypeScript OSS
repos (9.4 MLOC)** — angular, react, playwright, nextjs, svelte, vue and the
like: a floor is what ordinary repos carry (~p25), a budget is past anything in
the reference corpus (~max/p90).
The report also anchors the number against that corpus directly:

```
  slop level: moderate (43.0/100)  ·  worse than 60% of reference repos
```

Bands: `clean` <10 · `low` <25 · `moderate` <50 · `high` <75 · `legacy-grade` ≥75.
A disabled check leaves the formula entirely (it is not scored as clean).
Weights, floors, and budgets are configurable — details and rationale in
[docs/score.md](docs/score.md). **The densities are the facts; the score is an
aggregate.**

## Slop badge

Show off a clean codebase with a [shields.io](https://shields.io/badges/endpoint-badge)
badge. `--format shields` prints a shields **endpoint JSON** to stdout — host it
(a committed file, a gist, anywhere reachable) and point shields at it:

```sh
stopslop . --format shields > stopslop-badge.json
```

```md
[![slop](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/OWNER/REPO/main/stopslop-badge.json)](https://github.com/OWNER/REPO)
```

shields fetches the JSON and renders the badge, so it refreshes whenever you
regenerate the file. The message is the level and score; the color comes from a
fixed scale, tuned to reward near-zero slop:

| Result | Color | |
| --- | --- | --- |
| **`0 slop`** | 🟢 bright green | the flex — nothing to clean up |
| **`clean` <10** | 🟢 bright green | clean |
| **`low` <25** | 🟢 green | a little debt |
| **`moderate` <50** | 🟡 yellow | has debt |
| **`high` <75** | 🟠 orange | needs attention |
| **`legacy-grade` ≥75** | 🔴 red | reads like accumulated legacy |

`--format shields` always exits `0` (it is badge generation, not a gate), so a CI
step can regenerate it without failing the build. A score built from a subset of
the signals (a check was disabled or bailed out) is inflated, so its message is
marked with a `*` — run the full set for a comparable badge. Regenerate it in CI
to keep it fresh:

```yaml
      - run: npx stopslop . --format shields > stopslop-badge.json
      # then commit the file (or push it to a gist) so shields serves the latest value
```

## Usage

```
stopslop [path]            analyze a directory or file (default: .)
  --format <fmt>           text (default) · json · sarif · shields (badge JSON)
  --json                   alias for --format json (stable, versioned schema)
  --details, -d            show cluster composition, hubs, all clone sites
  --fast                   AST checks only: skip clones and dead code
  --config <file>          path to a stopslop.json
  --base <ref>             gate only on findings absent from this Git revision
  --baseline <file>        gate only on findings not in this baseline
  --update-baseline        write current findings to --baseline and exit 0
```

Exit codes: `0` clean · `1` findings · `2` error.

Invalid configuration, zero supported source files, and hard analysis errors
exit `2` before StopSlop emits a report, badge, or baseline.

### For an agent loop

```bash
stopslop --json > slop.json   # feed to the agent: clusters are the split boundaries
```

### Git-base gate

For pull requests, `--base <ref>` analyzes both the current working tree and the
given Git revision, then reports only findings absent from the base:

```sh
stopslop . --base origin/main
stopslop . --base origin/main --format sarif > stopslop.sarif
```

The current tree is analyzed as-is, including uncommitted changes. The base is
checked out detached into a fresh directory under the operating system's temp
directory. StopSlop links the installed dependency context (`node_modules` and
supported generated directories) into that checkout, analyzes the same project
subdirectory on both sides, and removes the temporary worktree in `finally`.
It never switches the user's branch or edits the index or working files.

This is an identity gate, not a metric diff: an existing finding with the same
StopSlop fingerprint is accepted; a fingerprint seen only in the current tree is
new. The full current slop score remains unchanged. `--base` is mutually
exclusive with `--baseline` and `--update-baseline`.

`--format sarif` emits SARIF 2.1.0 for GitHub Code Scanning. It has the normal
gate exit codes (`0` clean, `1` findings, `2` error), so upload the report before
re-failing the job:

```yaml
name: stopslop
on: pull_request

permissions:
  contents: read
  security-events: write

jobs:
  stopslop:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0
      - id: scan
        continue-on-error: true
        run: npx stopslop . --base "origin/${{ github.base_ref }}" --format sarif > stopslop.sarif
      - if: always() && steps.scan.outcome != 'cancelled'
        uses: github/codeql-action/upload-sarif@v4
        with:
          sarif_file: stopslop.sarif
          category: stopslop
      - if: steps.scan.outcome == 'failure'
        run: exit 1
```

## Baseline (adopting an existing project)

A mature or already-sloppy repo can light up red on day one. A **baseline** lets
you accept today's findings as legacy and gate CI only on what is added
afterwards — the honest answer to "this codebase is old and complex, but I don't
want the agent making it *worse*."

```sh
# 1. Record today's findings (writes the file, exits 0)
stopslop . --baseline .stopslop-baseline.json --update-baseline

# 2. In CI: fail only on findings not in the baseline
stopslop . --baseline .stopslop-baseline.json
```

The baseline is a small, sorted JSON file you commit and review in pull requests.
A finding's identity is `kind + file + symbol` — no line numbers, no messages — so
a baselined god class stays accepted as it grows, and the file produces a stable,
churn-free diff. Clones key on their content fingerprint alone, so they stay
suppressed even when moved between files. Re-run `--update-baseline` to re-adopt
after an intentional change.

Use this committed file when you want a deliberately reviewed, stable allowlist.
Use `--base` when the target branch itself should be the source of truth and no
baseline artifact should be maintained. They share fingerprints but are separate
CLI modes; one does not read or rewrite the other's state.

**The baseline never touches the slop score or the badge.** The score is the
honest state of the repo ("how much uncleaned code is here"); the baseline is
only a CI gate ("don't add more"). A gated run reports the new findings and its
score line reads e.g. `moderate (43.0/100)` with `baseline: 30 accepted · 1 new`
below it — the number stays truthful while CI fails only on the one new finding.

## Config (`stopslop.json`)

Every metric is configurable — thresholds, and each check can be turned off with
`false`. All fields are optional and merged over the defaults.

```json
{
  "$schema": "https://unpkg.com/stopslop/schema.json",
  "cognitiveComplexity": 15,
  "godModule": { "minMembers": 15, "minClusters": 3, "minComplexity": 150, "sizeMembers": 37, "sizeComplexity": 350 },
  "godClass": { "minMembers": 12, "minClusters": 3, "minComplexity": 90, "sizeMembers": 30, "sizeComplexity": 200 },
  "multipleExportedClasses": { "maxPerFile": 1 },
  "duplicates": { "minTokens": 50, "minLines": 5, "ignoreIdentifiers": true, "ignoreLiterals": false },
  "deadCode": { "exports": true, "dependencies": true, "files": true, "production": false },
  "knip": {
    "workspaces": {
      ".": { "entry": ["src/index.ts"] },
      "packages/*": { "entry": ["src/index.ts"], "project": ["src/**/*.ts"] }
    }
  },
  "score": { "weights": { "god": 0.35 }, "budgets": { "duplication": 0.3 }, "floors": { "duplication": 0.05 } },
  "hubFanInRatio": 0.5,
  "ignore": ["**/*.generated.ts"]
}
```

| key | what it tunes |
|---|---|
| `cognitiveComplexity` | report functions above this score (or `false` to disable) |
| `godClass` / `godModule` | `min*` = dispersion axis (unrelated groups); `size*` = size/WMC axis (a monolith too big even if fully connected); or `false` |
| `multipleExportedClasses` | `maxPerFile` classes per file before flagging; or `false` |
| `duplicates` | clone size floors and token normalization; or `false` |
| `deadCode` | which Knip issue classes to report; or `false` |
| `knip` | complete JSON-compatible Knip config, including `workspaces` |
| `score` | slop-level weights, floors, and budgets |
| `hubFanInRatio` | fan-in fraction that marks a shared "hub" member for removal |
| `ignore` | extra exclude globs on top of the built-ins |

Set a check to `false` to disable it, e.g. `"godModule": false`.

`stopslop.json` is the only Knip configuration source. StopSlop does not load or
execute `knip.json`, `.knip.json`, or `knip.config.*`; `package.json#knip` is
discarded and never merged with `knip`. The published `schema.json` provides editor
completion and validation for both StopSlop fields and the installed Knip
configuration surface. StopSlop deliberately has no config generator or init
wizard; project-aware generation belongs to separate tooling.

For a single-package project, put `entry` and `project` directly under `knip`.
For a monorepo, put them under `knip.workspaces`: Knip intentionally ignores
top-level `entry` and `project` when multiple workspaces are present.

**Full reference with every field, defaults, and examples:
[docs/configuration.md](docs/configuration.md).** Defaults are calibrated on a
22-repo TypeScript corpus ([docs/thresholds.md](docs/thresholds.md)).

## How it works & why the numbers

Architecture, literature references, and which parts are our heuristics:
[ARCH.md](ARCH.md). Implementation plan: [PLAN.md](PLAN.md).

Under the hood: **complexity and god module/class are ours**; clones are
[Clone Alert](https://www.npmjs.com/package/clone-alert) and dead code is
[Knip](https://knip.dev).

## Development

```bash
pnpm install
pnpm test
pnpm build
pnpm test:package       # install and execute the packed npm artifact
pnpm release:check      # complete pre-publish gate
pnpm schema:generate      # refresh schema.json after a Knip/config change
pnpm calibrate            # regenerate docs/thresholds.md from a corpus
```
