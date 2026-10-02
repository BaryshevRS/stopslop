# Changelog

All notable changes to StopSlop will be documented in this file. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0](https://github.com/BaryshevRS/stopslop/compare/v1.0.0...v1.1.0) (2026-10-02)


### Features

* **dead-code:** report Knip configuration hints ([4e06762](https://github.com/BaryshevRS/stopslop/commit/4e06762878a6380234bc98f439fb6a26f85e0ad6))

## [1.0.0](https://github.com/BaryshevRS/stopslop/compare/v0.2.0...v1.0.0) (2026-08-05)


### Features

* optimize npm and Context7 discovery ([9a22e93](https://github.com/BaryshevRS/stopslop/commit/9a22e9305a0f1ea2dcfd35be04abcccef7f1752a))


### Miscellaneous Chores

* release 1.0.0 ([14c73a6](https://github.com/BaryshevRS/stopslop/commit/14c73a6e768aa774ee840275b8f32491b9ee6a9a))

## [0.2.0](https://github.com/BaryshevRS/stopslop/compare/v0.1.2...v0.2.0) (2026-08-05)


### Features

* make AI slop badge a baseline gate ([e1e599f](https://github.com/BaryshevRS/stopslop/commit/e1e599fd61c3897e798a534ea0866370f690557c))


### Bug Fixes

* **ci:** keep npm pack JSON clean ([c512786](https://github.com/BaryshevRS/stopslop/commit/c5127861c3f56ac014607e1c908aa3cbff34810a))

## [0.1.2] - 2026-08-02

### Fixed

- Invalid configuration, empty source scans, and hard analysis failures now exit
  with code 2 before writing reports, badges, or baselines.

### Changed

- StopSlop-owned configuration fields are validated at runtime instead of
  silently accepting unknown properties, wrong types, or invalid ranges.
- Knip is pinned to the verified 6.31.0 release, and the packed-package smoke
  test now executes a complete four-signal analysis in a clean consumer project.
- Detection thresholds are marked final and their two-axis calibration is
  documented consistently with the runtime defaults.

## [0.1.1] - 2026-08-02

### Fixed

- Windows path canonicalization for Git-base gating and Knip orphan-feature analysis.
- Cross-platform schema verification under CRLF checkouts.

### Changed

- npm releases now use GitHub Trusted Publishing with OIDC and no stored registry token.

## [0.1.0] - 2026-08-01

### Added

- Cognitive-complexity, god-module, god-class, and multi-class-file analysis.
- Clone detection through Clone Alert and dead-code analysis through Knip.
- Orphan-feature detection for code kept alive only by its paired test.
- Versioned JSON, terminal, Shields, and SARIF 2.1.0 reports.
- Committed baselines and temporary-worktree Git-base gating for new findings.
- Configurable thresholds, score calibration, and a published JSON Schema.

[0.1.2]: https://github.com/BaryshevRS/stopslop/releases/tag/v0.1.2
[0.1.1]: https://github.com/BaryshevRS/stopslop/releases/tag/v0.1.1
[0.1.0]: https://github.com/BaryshevRS/stopslop/releases/tag/v0.1.0
