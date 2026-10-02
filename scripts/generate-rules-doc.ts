import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RULE_KINDS, ruleHelp, ruleMarkdown } from '../src/report/rules.js';
import { emitGenerated } from './emit-generated.js';

// docs/rules.md is rendered from src/report/rules.ts, the same text SARIF rule
// help and the JSON `rules` block carry, so the three cannot drift apart.

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = resolve(projectRoot, 'docs/rules.md');

const sections = RULE_KINDS.map((kind) => {
  const rule = ruleHelp(kind);
  return [`## ${kind}`, `${rule.summary}.`, ruleMarkdown(rule)].join('\n\n');
});

const generated = `${[
  '<!-- Generated from src/report/rules.ts by `pnpm rules:generate`. Do not edit by hand. -->',
  '# Rules',
  [
    'Every StopSlop finding has a `kind`. This page says, for each one, why it is a',
    'finding and what resolves it. The same text is the rule help in GitHub Code',
    'Scanning (`--format sarif`) and the `rules` block of `--format json`, so a',
    'reviewer and a coding agent read the same instructions.',
  ].join('\n'),
  [
    'Every setting named below lives in `stopslop.json`; see the',
    '[configuration reference](configuration.md). Setting a check to `false`',
    'disables it.',
  ].join('\n'),
  ...sections,
].join('\n\n')}\n`;

emitGenerated(outputPath, generated, 'docs/rules.md', 'pnpm rules:generate');
