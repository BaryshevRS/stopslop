---
name: stopslop
description: Find and fix structural slop in JavaScript and TypeScript with the StopSlop analyzer — over-complex functions, god classes and modules, copy-pasted blocks, unused exports, dependencies and files, and features kept alive only by their own test. Use after writing or refactoring JS/TS code and before calling the work done, when a StopSlop hook, CI run, or SARIF alert reports findings, or when the user asks about complexity, duplication, dead code, or AI slop in a JS/TS project.
---

# StopSlop

StopSlop reports structural overproduction: code that compiles and passes its
tests but is too tangled, too large, copied, or connected to nothing. It does not
judge whether code is correct, and a clear run does not mean it is.

## Run it

Check what the current changes add, against the last commit:

```bash
npx stopslop . --base HEAD --details
```

If the repository has `.stopslop-baseline.json`, CI gates on that file instead.
Use the same gate, so a clear run here means a clear run there:

```bash
npx stopslop . --baseline .stopslop-baseline.json --details
```

`npx` uses the project's own pinned `stopslop` when it is installed. Exit code
`0` means clear, `1` means findings, `2` means the analysis itself failed —
read stderr; it is usually invalid `stopslop.json`.

`--details` prints the suggested split groups for god units and every location
of a clone. For structured data, use `--format json`: each entry in `findings`
has `kind`, `file`, `line`, `symbol`, `message`, and `data`, and `rules[kind]`
holds `why` and `fix` for each reported kind. The JSON report also carries the
full configuration, so prefer the text report when only reading.

## Fix by kind

- **cognitive-complexity** — Return early instead of nesting; move each
  independent decision into a function named for what it decides; replace a long
  if/else or switch over one value with a lookup table. Splitting a body into
  `part1`/`part2` helpers moves the complexity and fixes nothing.
- **god-module**, **god-class** — Move each responsibility group listed under
  `--details` into its own module or class; the groups are the split boundaries.
  Names listed as holding cohesion together are shared helpers: put them where
  every group can import them. A size-axis finding has no clean boundaries; split
  by responsibility and say which split you chose.
- **multiple-exported-classes** — One exported class per file, named after it.
- **duplicate-code** — Extract one function and call it from every listed
  occurrence. Where the copies differ on purpose, make the difference a
  parameter. Before writing a new helper, search for one that already exists.
- **unused-export** — Delete it, or drop `export` when the file uses it.
- **unused-dependency** — Remove it from `package.json`.
- **unused-file** — Read the `config hints` block first: a missing Knip entry
  point makes live files look unreachable. Otherwise delete the file.
- **orphan-feature** — Delete the symbol and the test the message names,
  together. If the feature is meant to exist, wire it into the production code
  that needs it instead.

Before deleting anything reported as unused, check for uses the analysis cannot
see: framework file conventions, dynamic imports, a public package entry point.
Such an entry belongs under `knip` in `stopslop.json`.

Run the same command again after the fixes and repeat until it is clear.

## Fix the code, not the measurement

- Do not raise thresholds, add `ignore` globs, or disable checks in
  `stopslop.json` to get a clear run, unless the user asks for it.
- Do not run `--update-baseline` or edit `.stopslop-baseline.json`. The baseline
  is the reviewed list of debt the user accepted; adding to it is their decision.
  When a finding should stay, say which one and why, and let the user decide.
- Do not create `knip.json`; StopSlop reads Knip settings only from the `knip`
  property of `stopslop.json`.
- Renaming copied variables does not hide a clone from
  `duplicates.ignoreIdentifiers`, and a call added only to keep an orphan alive is
  still dead code.

Rule reference: https://github.com/BaryshevRS/stopslop/blob/main/docs/rules.md
