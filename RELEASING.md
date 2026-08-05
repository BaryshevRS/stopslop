# Releasing StopSlop

Releases are automated from Conventional Commits on `main`. Release Please keeps
an open release PR with the next SemVer version and generated `CHANGELOG.md`
entries. Merging that PR creates the `v<version>` tag and GitHub Release; the same
workflow then publishes the package to npm.

## Commit format

Commit messages and pull request titles must follow
[Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` creates a minor release.
- `fix:` creates a patch release.
- `feat!:` or a `BREAKING CHANGE:` footer creates a major release.
- `docs:`, `ci:`, `chore:`, `refactor:`, `test:`, and `perf:` are valid; Release
  Please decides whether they produce a release according to its Node strategy.

`pnpm install` installs a `commit-msg` hook through simple-git-hooks. CI also
validates every pull request title and commit, so `--no-verify` does not bypass
the repository policy.

## Automated flow

1. Merge Conventional Commits to `main`.
2. Review the Release Please PR: version, generated changelog, and compatibility
   notes in `COMPATIBILITY.md`.
3. Run `pnpm release:check` locally if the public API or package shape changed.
4. Merge the release PR.
5. The [release workflow](.github/workflows/publish.yml) creates the tag and
   GitHub Release, reruns the full release gate, and publishes to npm via OIDC.

GitHub Actions must have read/write workflow permissions and the repository
setting **Allow GitHub Actions to create and approve pull requests** must be
enabled so Release Please can maintain its release PR.

The publish job checks that the tag exactly matches `package.json`, runs tests,
type-checking, the production build, the production dependency audit, and the
packed-package smoke test before npm receives anything.

Public surfaces and maturity tiers remain declared in `COMPATIBILITY.md` and
`release.config.json`. Breaking changes to preview surfaces require at least a
minor release while the project is pre-1.0 and must be called out in the release
PR.

## npm trusted publishing

The npm trusted publisher must point to:

- organization/user: `BaryshevRS`
- repository: `stopslop`
- workflow file: `publish.yml`
- environment: empty

No `NODE_AUTH_TOKEN` or npm automation secret is used. The workflow requests an
OIDC identity token and npm attaches provenance automatically.

For an unclaimed package, bootstrap the first publish interactively after
`pnpm release:check`, then configure the trusted publisher:

```sh
npm publish --ignore-scripts --access public
npm trust github stopslop \
  --repo BaryshevRS/stopslop \
  --file publish.yml \
  --allow-publish \
  --yes
```
