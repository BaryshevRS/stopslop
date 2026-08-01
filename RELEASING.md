# Releasing StopSlop

Releases are cut from a clean, up-to-date `main` branch. A tag must match the
version in `package.json`; the publish workflow rejects mismatches.

## Readiness gate

```sh
pnpm install --frozen-lockfile
pnpm release:check
```

The gate runs all tests, type-checks, builds production artifacts, creates the
exact npm tarball, installs it into a clean temporary consumer project, starts
the installed CLI, and imports the installed Node.js API.

Public surfaces and their maturity tiers are declared in
[`COMPATIBILITY.md`](COMPATIBILITY.md) and `release.config.json`. While all
surfaces are pre-1.0, breaking preview changes require a minor version and must
be described in [`CHANGELOG.md`](CHANGELOG.md).

## First publish: bootstrap trusted publishing

An unclaimed npm package cannot have a trusted publisher yet. Publish the first
release interactively from a maintainer machine, then configure the same
tokenless OIDC flow used by later releases:

1. Enable two-factor authentication on the npm account and run `npm login`.
2. From the release-checked commit, run:

   ```sh
   npm publish --ignore-scripts --access public
   ```

3. With npm CLI 11.15.0 or newer, configure the permanent OIDC publisher:

   ```sh
   npm trust github stopslop \
     --repo BaryshevRS/stopslop \
     --file publish.yml \
     --allow-publish \
     --yes
   ```

4. Future tagged releases publish from GitHub Actions with OIDC and no npm
   secret. GitHub-hosted trusted publishing adds provenance automatically.

## Subsequent releases

1. Update `CHANGELOG.md` and `COMPATIBILITY.md`.
2. Bump `package.json` using SemVer and refresh `pnpm-lock.yaml` if necessary.
3. Run `pnpm release:check`.
4. Commit, tag `v<version>`, and push the branch and tag.

The tag triggers [`.github/workflows/publish.yml`](.github/workflows/publish.yml).
