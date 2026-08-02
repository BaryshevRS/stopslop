# Threshold calibration

Two lenses on the same corpus:

- **Count percentiles** — each entity counts once. "pXX = N" means XX% of
  entities score ≤ N. This is what we use for defaults: a god finding should be
  the worst ~1–5% of entities.
- **LOC-weighted percentiles** — the Alves/Ypma/Visser (ICSM 2010) methodology:
  each entity weighted by LOC, so "pXX = N" means XX% of *code volume* sits in
  entities ≤ N. Kept for reference; it skews high because large entities are
  both more complex and hold more volume.

Corpus: 22 TypeScript repositories, 65,817 analyzed files (tests, fixtures,
generated and bundled code excluded). The per-repository counts are listed
below.

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

## Final defaults

A god finding is rare by construction, but the detector does not compare each
metric with an independent p95 cutoff. It has two alternative axes:

- **dispersion** requires members **and** responsibility groups **and** total
  complexity together, so its member floor can stay sensitive;
- **size/WMC** requires both a high member count and high total complexity, even
  when the unit is cohesive.

| gate | members | groups | Σ complexity | final setting |
|---|---:|---:|---:|---|
| cognitive complexity | — | — | 15 | `cognitiveComplexity: 15` |
| class dispersion | 12 | 3 | 90 | `godClass: 12 / 3 / 90` |
| class size/WMC | 30 | — | 200 | `godClass: 30 / 200` |
| module dispersion | 15 | 3 | 150 | `godModule: 15 / 3 / 150` |
| module size/WMC | 37 | — | 350 | `godModule: 37 / 350` |

The size thresholds sit near the count p95–p99 tail. On the dispersion axis,
three substantive groups are already rare (between class p95 and p99; module
p99), and the conjunction with complexity supplies the precision. Raising the
member floor itself to p95 would make the conjunction unnecessarily blind to
smaller units that clearly contain three unrelated responsibilities.

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
