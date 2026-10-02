import type { Finding, FindingKind } from '../types.js';

// What each finding kind means, why it is worth a finding, and what resolves it.
// A finding message says what failed; this says why the rule exists and what to
// do — the part a reviewer or a coding agent otherwise has to guess. One source
// for the SARIF rule help, the JSON `rules` block, and docs/rules.md.

export interface RuleHelp {
  /** One line: what the finding is. */
  summary: string;
  /** Why the pattern is worth a finding. */
  why: string;
  /** What resolves it, written for whoever makes the change — person or agent. */
  fix: string;
  /** stopslop.json setting that tunes or disables the check. */
  config: string;
  /** Long-form documentation: this kind's section of docs/rules.md. */
  helpUri: string;
}

const RULES_DOC = 'https://github.com/BaryshevRS/stopslop/blob/main/docs/rules.md';

const RULES: Record<FindingKind, Omit<RuleHelp, 'helpUri'>> = {
  'cognitive-complexity': {
    summary: 'Function is harder to follow than the threshold allows',
    why:
      'Cognitive complexity counts what a reader has to hold in mind to follow a function: ' +
      'branches, loops, nesting, and boolean chains (SonarSource specification). Above the ' +
      'threshold a function is hard to review and easy to break, and it keeps growing the same ' +
      'way: each new case lands beside the existing ones instead of in a place of its own.',
    fix:
      'Return early instead of nesting, and move each independent decision into a function ' +
      'whose name says what it decides. Replace a long if/else or switch over one value with a ' +
      'lookup table. Cutting the body into arbitrary part1/part2 helpers moves the complexity ' +
      'without removing it.',
    config: 'cognitiveComplexity',
  },
  'god-module': {
    summary: 'Module mixes unrelated responsibilities or has outgrown one file',
    why:
      'Its top-level definitions fall into groups that do not use each other, or the file is ' +
      'too large and too complex to be one unit. Every change touches a file that does several ' +
      'jobs, and new code keeps landing in it because it is the file already open.',
    fix:
      'Move each responsibility group to its own module; `--details` and the JSON report list ' +
      'the groups found in the reference graph, the ready-made split boundaries. Members listed ' +
      'as holding cohesion together are shared helpers: move them where every group can import ' +
      'them. A size-axis finding has no clean boundaries, so split it by responsibility by hand.',
    config: 'godModule',
  },
  'god-class': {
    summary: 'Class mixes unrelated responsibilities or has outgrown one unit',
    why:
      'Its methods fall into groups that do not share state or call each other, or the class ' +
      'is too large and too complex to be one unit. Every change risks the unrelated behaviour ' +
      'next to it, and the class cannot be tested one responsibility at a time.',
    fix:
      'Extract each responsibility group into its own class or set of functions, and let the ' +
      'original delegate to them or disappear; `--details` and the JSON report list the groups. ' +
      'A size-axis finding has no clean boundaries, so split it by responsibility by hand.',
    config: 'godClass',
  },
  'multiple-exported-classes': {
    summary: 'File exports more than one class',
    why:
      'Several exported classes in one file usually mean code was appended where it was ' +
      'convenient instead of placed where it belongs. Readers cannot find a class by its file ' +
      'name, and the file drifts toward a god module.',
    fix:
      'Give each exported class its own file named after it. A class that only serves another ' +
      'can stay in the same file without being exported.',
    config: 'multipleExportedClasses',
  },
  'duplicate-code': {
    summary: 'Block of code is copied in more than one place',
    why:
      'Copies drift. A bug fixed in one stays in the others, and the copies start to disagree ' +
      'about the same computation. It is usually cheaper to write a block again than to find ' +
      'the helper that already does it, which is how copies accumulate.',
    fix:
      'Extract the block into one function and call it from every occurrence; the finding lists ' +
      'all of them. Where the copies differ on purpose, make the difference a parameter. ' +
      'Renaming variables does not hide a copy when `duplicates.ignoreIdentifiers` is on.',
    config: 'duplicates',
  },
  'unused-export': {
    summary: 'Export is not imported anywhere',
    why:
      'Code nothing uses still has to be read, compiled, kept type-correct, and migrated. Code ' +
      'is added readily and deleted reluctantly, so unused exports only accumulate.',
    fix:
      'Delete it, or drop the `export` keyword when the file uses it internally. If something ' +
      'Knip does not know about uses it, such as a framework convention or a public package ' +
      'entry, declare that entry under `knip` in stopslop.json instead.',
    config: 'deadCode.exports',
  },
  'unused-dependency': {
    summary: 'Dependency in package.json is not imported anywhere',
    why:
      'An unused package still installs, still gets audited and updated, and still widens the ' +
      'supply chain the project trusts.',
    fix:
      'Remove it from package.json. If it is used in a way Knip cannot see, such as a binary ' +
      'run from a script or a plugin loaded by name, list it in `ignoreDependencies` under ' +
      '`knip` in stopslop.json.',
    config: 'deadCode.dependencies',
  },
  'unused-file': {
    summary: 'File is not reachable from any entry point',
    why:
      'Often a superseded version of a module, left next to the one that replaced it. Reported ' +
      'as info and not scored: the result is only as good as the entry points Knip knows.',
    fix:
      'Resolve the config hints in the report first; a missing entry point makes live files ' +
      'look unreachable. Then delete the file.',
    config: 'deadCode.files',
  },
  'orphan-feature': {
    summary: 'Function or class is used only by its own test',
    why:
      'No production code calls it; one test is the only thing that imports it. That is a ' +
      'feature written together with its test and never wired in, and the green test makes it ' +
      'look finished.',
    fix:
      'Delete the symbol and its test together: deleting only the source breaks the test, and ' +
      'deleting only the test leaves dead code. If the feature is meant to exist, wire it into ' +
      'the production code that needs it.',
    config: 'deadCode.orphans',
  },
};

export function ruleHelp(kind: FindingKind): RuleHelp {
  return { ...RULES[kind], helpUri: `${RULES_DOC}#${kind}` };
}

/** Every kind, in the order docs/rules.md lists them. */
export const RULE_KINDS = Object.keys(RULES) as FindingKind[];

/** Help for the kinds present in a set of findings, keyed by kind. */
export function rulesFor(findings: readonly Finding[]): Partial<Record<FindingKind, RuleHelp>> {
  const rules: Partial<Record<FindingKind, RuleHelp>> = {};
  for (const { kind } of findings) rules[kind] ??= ruleHelp(kind);
  return rules;
}

/** The rule's help as Markdown: the body of a SARIF rule help and of docs/rules.md. */
export function ruleMarkdown(rule: RuleHelp): string {
  return [
    `**Why it matters.** ${rule.why}`,
    `**How to fix.** ${rule.fix}`,
    `**Tune or disable:** \`${rule.config}\` in \`stopslop.json\`.`,
  ].join('\n\n');
}
