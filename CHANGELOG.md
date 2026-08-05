# Changelog

All notable changes to StopSlop will be documented in this file. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
