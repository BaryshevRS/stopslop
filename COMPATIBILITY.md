# Compatibility

Last updated: 0.1.2 (2026-08-02)

StopSlop is pre-1.0. Public surfaces are usable, but none are declared stable
yet. Breaking preview changes require a minor release and are called out in the
changelog. Experimental surfaces may change in any release.

| Surface | Tier | Compatibility policy |
| --- | --- | --- |
| CLI flags and exit codes | Preview | Existing flags and exit meanings are preserved within a minor line. |
| Versioned JSON report | Preview | Breaking payload changes increment `schemaVersion`. |
| SARIF 2.1.0 report | Preview | New rules and optional properties may be added; existing required fields remain compatible. |
| `stopslop.json` schema | Preview | Existing valid configuration remains valid within a minor line. |
| Programmatic Node.js API | Experimental | Exported functions and TypeScript types may change before 1.0. |

## Runtime support

- Node.js 20.19+, 22.12+, and 24.
- ESM only.
- Git-base gating requires the `git` executable and a non-shallow checkout that
  contains the requested base revision.

## Deprecations

None.
