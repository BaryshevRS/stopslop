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

An unclaimed npm package cannot yet have a trusted publisher. Bootstrap only the
first release with a short-lived granular npm token:

1. Enable two-factor authentication on the npm account.
2. Create a granular token allowed to publish public packages and add it to the
   GitHub repository as the `NPM_TOKEN` Actions secret.
3. Push the release commit to `main`, then create and push `v0.1.0`.
4. Confirm that npm shows provenance for `stopslop@0.1.0`.
5. With npm CLI 11.5.1 or newer, configure the permanent OIDC publisher:

   ```sh
   npm trust github stopslop \
     --repo BaryshevRS/stop-slop \
     --file publish.yml \
     --allow-publish \
     --yes
   ```

6. Delete the `NPM_TOKEN` repository secret. Future tagged releases use GitHub
   OIDC trusted publishing and carry provenance without a long-lived token.

Do not run `npm publish` from a laptop: automatic provenance generation is
supported by npm in GitHub Actions, not in a local shell.

## Subsequent releases

1. Update `CHANGELOG.md` and `COMPATIBILITY.md`.
2. Bump `package.json` using SemVer and refresh `pnpm-lock.yaml` if necessary.
3. Run `pnpm release:check`.
4. Commit, tag `v<version>`, and push the branch and tag.

The tag triggers [`.github/workflows/publish.yml`](.github/workflows/publish.yml).
