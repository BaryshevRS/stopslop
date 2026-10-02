# Compatibility

Last updated: 1.1.0

StopSlop follows Semantic Versioning. Stable surfaces change incompatibly only
in a major release. Experimental surfaces may change in a minor release; such
changes are called out in the changelog.

| Surface | Tier | Compatibility policy |
| --- | --- | --- |
| CLI flags and exit codes | Stable | New flags may be added; existing flags and exit code meanings change only in a major release. |
| Versioned JSON report | Stable | Fields may be added within a `schemaVersion`; removing or changing one increments it and requires a major release. |
| SARIF 2.1.0 report | Stable | New rules and optional properties may be added; existing required fields remain compatible. |
| `stopslop.json` schema | Stable | New settings may be added; configuration valid in a 1.x release stays valid in every later 1.x release. |
| Programmatic Node.js API | Experimental | Exported functions and TypeScript types may change in a minor release. |

Findings and scores are not a compatibility surface. Detector fixes, threshold
calibration, and Knip or Clone Alert updates can change what a release reports
for the same code; such changes are called out in the changelog. Pin the
StopSlop version in CI when a gate must not move without a commit.

## Runtime support

- Node.js 20.19+, 22.12+, and 24.
- ESM only.
- Git-base gating requires the `git` executable and a non-shallow checkout that
  contains the requested base revision.

## Deprecations

None.
