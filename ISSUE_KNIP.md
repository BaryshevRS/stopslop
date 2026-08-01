# Knip needs an exclusive in-memory configuration API

## Status

Blocked on a Knip API capability. Do not treat the temporary bootstrap adapter
as the long-term architecture.

Verified against Knip 6.26.0 (currently pinned by the lockfile) and 6.27.0
(latest when this issue was written).

## Context

StopSlop owns the dead-code configuration. The complete JSON-compatible Knip
configuration lives under `stopslop.json#knip`:

```json
{
  "knip": {
    "workspaces": {
      ".": { "entry": ["src/index.ts"] },
      "packages/*": {
        "entry": ["src/index.ts"],
        "project": ["src/**/*.ts"]
      }
    }
  }
}
```

Project-local Knip configuration must have no effect on a StopSlop run. This
includes `knip.json`, `.knip.json`, `knip.config.*`, and `package.json#knip`.
JavaScript and TypeScript Knip configs must not be executed.

StopSlop still needs Knip to read the real project metadata: `package.json`
entries and dependencies, package-manager workspaces, catalogs, scripts, and
workspace manifests.

## The limitation

Knip's public session API exposes `createOptions` and `createSession`, but
`createOptions` cannot accept a `KnipConfiguration` object as the exclusive
configuration source. It always discovers configuration from the filesystem.

An explicit config path does not provide isolation. Knip still merges the
explicit file over `package.json#knip`:

```ts
const loadedConfig = Object.assign(
  {},
  manifest.knip,
  configFilePath ? await loadResolvedConfigFile(configFilePath, args) : {},
);
```

Source: [Knip `create-options.ts`](https://github.com/webpro-nl/knip/blob/main/packages/knip/src/util/create-options.ts).
The documented configuration sources are files and `package.json`:
[Knip configuration](https://knip.dev/overview/configuration).

## Why the current workaround is not acceptable

The prototype adapter in `src/knip-options.ts`:

1. Creates a temporary bootstrap directory.
2. Copies a sanitized `package.json` without its `knip` field.
3. Writes `stopslop.json#knip` as a temporary Knip config.
4. Calls `createOptions` inside the bootstrap directory.
5. Mutates the returned `MainOptions` paths back to the real project root.
6. Deletes the bootstrap directory.

This satisfies the isolation requirement today, but it relies on undocumented
details of `MainOptions`. A Knip update can add another cwd-derived field and
silently make the rebinding incomplete. It also duplicates package-manager
metadata handling and makes workspace/catalog behavior harder to trust.

Constructing `MainOptions` ourselves would be worse: it would duplicate most of
Knip's option normalization and couple StopSlop to an even larger internal
surface.

## Desired Knip API

Knip should accept a raw configuration object directly:

```ts
import type { KnipConfiguration } from 'knip';
import { createOptions, createSession } from 'knip/session';

const configuration: KnipConfiguration = stopslopConfig.knip;

const options = await createOptions({
  cwd: packageRoot,
  configuration,
  isSession: true,
  isProduction,
});

const session = await createSession(options);
```

`configuration` is intentionally distinct from the existing CLI/config-path
field. Supplying it should select one unambiguous mode: configuration comes
from this object only.

Expected behavior when `configuration` is present:

- do not discover `knip.json`, `.knip.json`, or `knip.config.*`;
- do not merge `package.json#knip`;
- validate the object with Knip's normal configuration schema;
- continue reading the real project manifest and package-manager metadata;
- preserve native Knip workspace, plugin, catalog, entry, and project behavior;
- keep existing behavior unchanged when `configuration` is absent.

Possible implementation inside Knip:

```ts
interface CreateOptions extends Partial<Options> {
  args?: ParsedCLIArgs;
  configuration?: RawConfiguration;
}

const loadedConfig =
  options.configuration !== undefined
    ? options.configuration
    : Object.assign(
        {},
        manifest.knip,
        configFilePath
          ? await loadResolvedConfigFile(configFilePath, args)
          : {},
      );
```

Config-file discovery should also be skipped entirely in the in-memory branch,
so a throwing `knip.config.js` is never imported.

## Upstream acceptance criteria

- An in-memory config is parsed by the same schema as a file config.
- An invalid or conflicting `package.json#knip` has no effect.
- A throwing `knip.config.js` is not executed.
- `package.json#workspaces` and `pnpm-workspace.yaml` are still honored.
- Root (`.`), glob, and exact workspace keys retain normal Knip precedence.
- Existing CLI and config-file tests remain unchanged and green.
- The new option is exported and documented as part of `knip/session`.

## StopSlop acceptance criteria after the upstream release

- Delete `src/knip-options.ts` and all temporary bootstrap logic.
- Call `createOptions` directly against the real package root.
- Keep regression tests proving external Knip configs have no effect.
- Add an end-to-end monorepo fixture covering workspace entry/project settings.
- Pin the Knip version that first provides the API, then relax the range only
  after compatibility is established.

## Interim options

In order of preference:

1. Submit the small API change upstream and wait for a Knip release.
2. If shipping cannot wait, publish a minimal scoped Knip fork containing only
   this API addition and its upstream tests.
3. Keep the bootstrap adapter only as an explicitly temporary, exact-version-
   pinned workaround.

A package-manager patch is not a distributable solution: patches applied in
this repository are not automatically applied when another project installs
StopSlop from npm.

## Configuration generation

This issue concerns runtime configuration injection only. Project inspection
and config generation remain separate. Knip already publishes
[`@knip/mcp`](https://github.com/webpro-nl/knip/tree/main/packages/mcp-server)
with a `knip-configure` workflow; it may be reusable when implementing the
future generator for `stopslop.json#knip`.
