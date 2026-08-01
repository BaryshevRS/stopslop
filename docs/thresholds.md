# Threshold calibration

Two lenses on the same corpus:

- **Count percentiles** — each entity counts once. "pXX = N" means XX% of
  entities score ≤ N. This is what we use for defaults: a god finding should be
  the worst ~1–5% of entities.
- **LOC-weighted percentiles** — the Alves/Ypma/Visser (ICSM 2010) methodology:
  each entity weighted by LOC, so "pXX = N" means XX% of *code volume* sits in
  entities ≤ N. Kept for reference; it skews high because large entities are
  both more complex and hold more volume.

Corpus: `/Users/rock/Projects/clone-alert/bench/repos` — 22 repos, 65817 analyzed files
(tests, fixtures, generated and bundled code excluded).

## Count percentiles (basis for defaults)

### Function
| metric | n | p50 | p75 | p90 | p95 | p99 |
|---|---|---|---|---|---|---|
| cognitive complexity | 108102 | 0 | 2 | 7 | 13 | 38 |

### Class (≥3 methods)
| metric | n | p50 | p75 | p90 | p95 | p99 |
|---|---|---|---|---|---|---|
| methods | 2940 | 6 | 12 | 23 | 32 | 64 |
| responsibility groups (≥2) | 2940 | 1 | 1 | 2 | 2 | 4 |
| Σ cognitive complexity | 2940 | 8 | 24 | 58 | 93 | 207 |

### Module (≥5 top-level fns)
| metric | n | p50 | p75 | p90 | p95 | p99 |
|---|---|---|---|---|---|---|
| top-level definitions | 2819 | 8 | 11 | 16 | 22 | 37 |
| responsibility groups (≥2) | 2819 | 1 | 1 | 2 | 2 | 3 |
| Σ cognitive complexity | 2819 | 21 | 54 | 109 | 167 | 354 |

## LOC-weighted percentiles (Alves, reference)

### Function
| metric | n | p50 | p75 | p90 | p95 | p99 |
|---|---|---|---|---|---|---|
| cognitive complexity | 108102 | 4 | 16 | 45 | 95 | 309 |

### Class (≥3 methods)
| metric | n | p50 | p75 | p90 | p95 | p99 |
|---|---|---|---|---|---|---|
| methods | 2940 | 15 | 30 | 57 | 74 | 111 |
| responsibility groups (≥2) | 2940 | 1 | 1 | 2 | 3 | 5 |
| Σ cognitive complexity | 2940 | 41 | 104 | 205 | 341 | 825 |

### Module (≥5 top-level fns)
| metric | n | p50 | p75 | p90 | p95 | p99 |
|---|---|---|---|---|---|---|
| top-level definitions | 2819 | 10 | 17 | 29 | 38 | 72 |
| responsibility groups (≥2) | 2819 | 1 | 1 | 2 | 2 | 4 |
| Σ cognitive complexity | 2819 | 51 | 128 | 280 | 455 | 1175 |

## Recommended defaults

A god finding should be rare by construction — around count p95–p99.

| setting | count p95 | count p99 | recommended |
|---|---|---|---|
| `cognitiveComplexity` | 13 | 38 | **15** (Sonar-floored) |
| `godClass.minMembers` | 32 | 64 | **32** |
| `godClass.minComplexity` | 93 | 207 | **93** |
| `godModule.minMembers` | 22 | 37 | **22** |
| `godModule.minComplexity` | 167 | 354 | **167** |

`minClusters` stays at **3** for both: the group split (≥2 members) already makes
extra groups rare, and 3 unrelated responsibility groups is the smallest count
that reads as "this should be several units."

## Per-repo file counts
- angular: 1971 files
- angular-components: 1971 files
- chakra-ui: 2359 files
- create-react-app: 122 files
- gatsby: 3086 files
- ionic-framework: 508 files
- material-ui: 26447 files
- nest: 1306 files
- nextjs: 4498 files
- ng-bootstrap: 527 files
- ng-bootstrap-fresh: 527 files
- nx: 3330 files
- playwright: 788 files
- primeng: 2743 files
- react: 1711 files
- react-bootstrap: 440 files
- remix: 805 files
- shadcn-ui: 3473 files
- storybook: 2617 files
- svelte: 2299 files
- taiga-ui: 2770 files
- tanstack-table: 1519 files
