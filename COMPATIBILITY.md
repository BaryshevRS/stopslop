# Compatibility

Last updated: 2.0.0 (2026-11-21)

StopSlop follows Semantic Versioning. Stable surfaces change incompatibly only
in a major release. Experimental surfaces may change in a minor release; such
changes are called out in the changelog.

| Surface | Tier | Compatibility policy |
| --- | --- | --- |
| CLI flags and exit codes | Stable | New flags may be added; existing flags and exit code meanings change only in a major release. |
| Versioned JSON report | Stable | Fields may be added within a `schemaVersion`; removing or changing one increments it and requires a major release. |
| SARIF 2.1.0 report | Stable | New rules and optional properties may be added; existing required fields remain compatible. |
| `stopslop.json` schema | Stable | New settings may be added; configuration valid in a 2.x release stays valid in every later 2.x release. |
| Programmatic Node.js API | Experimental | Exported functions and TypeScript types may change in a minor release. |
| Agent plugins (`stopslop` skill and stop hook for Claude Code, Codex, Cursor, Gemini CLI) | Experimental | When the hook runs, what it reports, and the skill's instructions may change in a minor release. |

Findings and scores are not a compatibility surface. Detector fixes, threshold
calibration, and Knip or Clone Alert updates can change what a release reports
for the same code; such changes are called out in the changelog. Pin the
StopSlop version in CI when a gate must not move without a commit.

Version 2.0.0 requires Node.js 22.13 or later, dropping support for Node.js 20
and 22.12. It updates Clone Alert, Knip, and Oxc Parser; these engine updates
can produce new findings or different scores for existing code. There are no
new deprecations.

## Runtime support

- Node.js 22.13 or later.
- ESM only.
- Git-base gating requires the `git` executable and a non-shallow checkout that
  contains the requested base revision.

## Deprecations

None.
