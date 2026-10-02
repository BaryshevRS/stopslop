<!-- Generated from src/report/rules.ts by `pnpm rules:generate`. Do not edit by hand. -->

# Rules

Every StopSlop finding has a `kind`. This page says, for each one, why it is a
finding and what resolves it. The same text is the rule help in GitHub Code
Scanning (`--format sarif`) and the `rules` block of `--format json`, so a
reviewer and a coding agent read the same instructions.

Every setting named below lives in `stopslop.json`; see the
[configuration reference](configuration.md). Setting a check to `false`
disables it.

## cognitive-complexity

Function is harder to follow than the threshold allows.

**Why it matters.** Cognitive complexity counts what a reader has to hold in mind to follow a function: branches, loops, nesting, and boolean chains (SonarSource specification). Above the threshold a function is hard to review and easy to break, and it keeps growing the same way: each new case lands beside the existing ones instead of in a place of its own.

**How to fix.** Return early instead of nesting, and move each independent decision into a function whose name says what it decides. Replace a long if/else or switch over one value with a lookup table. Cutting the body into arbitrary part1/part2 helpers moves the complexity without removing it.

**Tune or disable:** `cognitiveComplexity` in `stopslop.json`.

## god-module

Module mixes unrelated responsibilities or has outgrown one file.

**Why it matters.** Its top-level definitions fall into groups that do not use each other, or the file is too large and too complex to be one unit. Every change touches a file that does several jobs, and new code keeps landing in it because it is the file already open.

**How to fix.** Move each responsibility group to its own module; `--details` and the JSON report list the groups found in the reference graph, the ready-made split boundaries. Members listed as holding cohesion together are shared helpers: move them where every group can import them. A size-axis finding has no clean boundaries, so split it by responsibility by hand.

**Tune or disable:** `godModule` in `stopslop.json`.

## god-class

Class mixes unrelated responsibilities or has outgrown one unit.

**Why it matters.** Its methods fall into groups that do not share state or call each other, or the class is too large and too complex to be one unit. Every change risks the unrelated behaviour next to it, and the class cannot be tested one responsibility at a time.

**How to fix.** Extract each responsibility group into its own class or set of functions, and let the original delegate to them or disappear; `--details` and the JSON report list the groups. A size-axis finding has no clean boundaries, so split it by responsibility by hand.

**Tune or disable:** `godClass` in `stopslop.json`.

## multiple-exported-classes

File exports more than one class.

**Why it matters.** Several exported classes in one file usually mean code was appended where it was convenient instead of placed where it belongs. Readers cannot find a class by its file name, and the file drifts toward a god module.

**How to fix.** Give each exported class its own file named after it. A class that only serves another can stay in the same file without being exported.

**Tune or disable:** `multipleExportedClasses` in `stopslop.json`.

## duplicate-code

Block of code is copied in more than one place.

**Why it matters.** Copies drift. A bug fixed in one stays in the others, and the copies start to disagree about the same computation. It is usually cheaper to write a block again than to find the helper that already does it, which is how copies accumulate.

**How to fix.** Extract the block into one function and call it from every occurrence; the finding lists all of them. Where the copies differ on purpose, make the difference a parameter. Renaming variables does not hide a copy when `duplicates.ignoreIdentifiers` is on.

**Tune or disable:** `duplicates` in `stopslop.json`.

## unused-export

Export is not imported anywhere.

**Why it matters.** Code nothing uses still has to be read, compiled, kept type-correct, and migrated. Code is added readily and deleted reluctantly, so unused exports only accumulate.

**How to fix.** Delete it, or drop the `export` keyword when the file uses it internally. If something Knip does not know about uses it, such as a framework convention or a public package entry, declare that entry under `knip` in stopslop.json instead.

**Tune or disable:** `deadCode.exports` in `stopslop.json`.

## unused-dependency

Dependency in package.json is not imported anywhere.

**Why it matters.** An unused package still installs, still gets audited and updated, and still widens the supply chain the project trusts.

**How to fix.** Remove it from package.json. If it is used in a way Knip cannot see, such as a binary run from a script or a plugin loaded by name, list it in `ignoreDependencies` under `knip` in stopslop.json.

**Tune or disable:** `deadCode.dependencies` in `stopslop.json`.

## unused-file

File is not reachable from any entry point.

**Why it matters.** Often a superseded version of a module, left next to the one that replaced it. Reported as info and not scored: the result is only as good as the entry points Knip knows.

**How to fix.** Resolve the config hints in the report first; a missing entry point makes live files look unreachable. Then delete the file.

**Tune or disable:** `deadCode.files` in `stopslop.json`.

## orphan-feature

Function or class is used only by its own test.

**Why it matters.** No production code calls it; one test is the only thing that imports it. That is a feature written together with its test and never wired in, and the green test makes it look finished.

**How to fix.** Delete the symbol and its test together: deleting only the source breaks the test, and deleting only the test leaves dead code. If the feature is meant to exist, wire it into the production code that needs it.

**Tune or disable:** `deadCode.orphans` in `stopslop.json`.
