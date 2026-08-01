# Slop level: the formula

The slop level is one number in `0..100` plus a band label. It exists so that a
repo can be compared **with itself over time** and **with other repos**, which
raw finding counts cannot do: a 200 KLOC monorepo will always "win" on absolute
counts without being any sloppier per line written.

Nothing here is a black box, and nothing here is science. The **densities are
the facts**; the score is a weighted aggregate over them, with heuristic weights
and budgets that you can change.

## The formula

```
score = 100 · Σ wᵢ · sat(xᵢ) / Σ wᵢ
sat(x) = clamp((x − floorᵢ) / (budgetᵢ − floorᵢ), 0, 1)
```

where `i` ranges over the **enabled** signals:

| signal | xᵢ (density) | weight wᵢ | floor | budget |
|---|---|---|---|---|
| `god` | (god modules + god classes) / KLOC | 0.35 | 0 | 0.1 |
| `duplication` | duplicated lines / total lines (0..1) | 0.25 | 0.05 | 0.30 |
| `complexity` | over-complex functions / KLOC | 0.20 | 0 | 4 |
| `deadCode` | (unused exports + deps) / KLOC | 0.20 | 0 | 4 |

Below the floor a signal contributes nothing — that density is the baseline of
any living codebase, not slop. At the budget the contribution saturates.

Only `warn`-severity findings feed the score. `info` findings — unused *files*,
which hang entirely on Knip's entry-point detection — are reported but never
scored: a misdetected entry point must not outweigh a real god class.

Bands: `clean` <10 · `low` <25 · `moderate` <50 · `high` <75 · `legacy-grade` ≥75.
The top band is `legacy-grade`, not "severe": a high score means the code reads
like accumulated legacy — true whether a team wrote it over a decade or an agent
produced it last week. It is a description, not a verdict on the engineers.

Three properties are deliberate:

- **Size independence.** Every signal is a rate, not a count. Four god classes in
  20 KLOC score exactly like one in 5 KLOC.
- **Saturation.** `min(1, …)` caps each signal at its budget: a repo with 100 god
  modules is not "20× worse" than one with 5 — it is simply maxed out on that
  axis, and the other axes still matter. Without the cap, one pathological file
  would drown out everything else.
- **A check that did not run leaves the formula.** If you turn off `deadCode` — or
  if Knip bails out because the project's dependencies are not installed, or the
  project is a monorepo without `stopslop.json#knip.workspaces` (where Knip's
  entry-point detection produces a landslide of false "unused") — its weight drops out of the
  denominator instead of contributing zero. Not measuring something must never
  read as a clean bill of health. The terminal report shows only the signals
  that were actually measured, and says in a note why one is missing.

`multiple-exported-classes` is reported but not scored: it is a structural hint,
not a quantity of slop, and it correlates with the god-module signal already.

## Where the numbers come from

Honestly: the **weights are a judgement call**; the **floors and budgets are
measured**, not invented. Every non-zero anchor comes from a 41-repo / 9.4 MLOC
benchmark run over mature TypeScript OSS (angular, react, playwright, nextjs,
svelte, vue-core, nest, vite, material-ui and the like — the corpus ships in
`src/corpus.ts`), by one rule: a *floor* is what ordinary repos carry (~p25), a
*budget* is "past anything in the reference corpus" (~max/p90). All of it is
flagged `preliminary` and configurable (`score.weights`, `score.budgets`,
`score.floors`).

- **Weights** encode what we claim slop *is*. Misplaced structure (god units) and
  copy-paste are the expensive kinds — they are what an agent produces when it
  keeps appending instead of refactoring, and they are what a human has to undo
  by hand. A single hairy function or a stale export is cheaper to fix, so
  complexity and dead code weigh less. `god` (0.35) > `duplication` (0.25) >
  `complexity` = `deadCode` (0.20).
- **`god` budget = 0.1/KLOC** — corpus median 0.013, half the repos at exactly 0,
  worst repo (playwright) at 0.071. No floor: a single god unit is already slop.
- **`duplication` floor = 5%, budget = 30%** — corpus p25 ≈ 5% (unavoidable
  boilerplate of a living TS codebase), p90 ≈ 31% (mantine). The first-guess
  budget (10%, the jscpd convention) sat *below the corpus median of ~13%*: the
  signal saturated on ¾ of the corpus, became a constant +25 points for nearly
  everyone, and compressed all 42 benchmark scores into 27..56 — a scale with
  only two live bands. Measured beats conventional.
- **`complexity` budget = 4/KLOC** — the detection threshold is already the count
  p95 of the calibration corpus ([thresholds.md](thresholds.md)); the corpus
  maximum of repos crossing it is 3.31/KLOC (svelte — a compiler, i.e. honestly
  complex). 4 = past anything in the corpus.
- **`deadCode` budget = 4/KLOC** — ≈ p75 of the sub-corpus where dead code was
  actually measurable; one unused export/dependency every 250 lines means the
  project has stopped removing what it stopped using. This is the noisiest
  signal (it leans on Knip config quality, and a library's public API reads as
  "unused exports"), which is why it carries the smallest weight and never
  enters the corpus percentile below.

## "Worse than N% of reference repos"

Alongside the absolute score, the report anchors the repo against the reference
corpus: the share of the 41 benchmark repos with a strictly lower **core score**
— the score computed from the three signals measured identically everywhere
(god, duplication, complexity; dead code is excluded as infrastructure-dependent).
The comparison uses *your* weights/floors/budgets, so a custom config re-ranks
the corpus with the same yardstick it applies to your repo. It appears only when
all three core signals were measured (`--fast` has no percentile).

This is context, not a second verdict: "43/100, worse than 60% of reference
repos" tells you where the number sits among codebases nobody calls slop.

## What the score means — and what it does *not*

The score is **"how much uncleaned, suspicious code is left"**, not a verdict on
engineering quality. The intended reading:

- Clean it up and the number goes to zero: no god units, no duplication, no dead
  code → 0, whether the code was written by a human or an agent. Fix the god
  class, deduplicate, remove dead exports — the score follows.
- Its primary use is comparing a repo **with itself over time** (did the agent's
  last week of commits push it up?). Cross-repo comparison is meaningful but
  needs the caveat below.
- A genuinely complex domain scores high honestly: playwright tops the corpus
  ranking because it really does carry the corpus's highest god-unit density
  (0.071/KLOC) and near-maximal density of over-complex functions. The score
  reports that; it does not know (or claim to know) that the complexity is
  well-earned. High score = "a lot here would need justification", not "bad
  engineers".

Other non-goals:

- `deadCode` anchors are the weakest: the signal depends on Knip configuration
  and misreads a library's public API as unused exports (see above).
- It does not weigh a finding by how bad it is individually (a complexity-80
  function counts the same as a complexity-16 one). Severity lives in the
  findings, not the score.
- It is not a quality score. Clean code with zero slop signals can still be bad
  code — stopslop only claims to measure *overproduction*.
