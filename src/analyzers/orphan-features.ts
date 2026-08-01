import { relative, sep } from 'node:path';
import type { File } from 'knip/session';
import type { Finding, OxcNode, ParsedFile } from '../types.js';
import { isStoryPath, isTestPath } from '../discover.js';

// Orphan features: a function no production code calls, kept alive by nothing
// but a single test. The signature of a generated feature that was never wired
// in — the model wrote the function and the test together and stopped there. See
// IDEA_DEATH_TEST_CODE.md.
//
// Stronger than a plain unused export, which has an innocent explanation ready
// ("forgot to delete it"). Here there is almost none: nobody writes a test for
// code they never connected to anything.
//
// The finding names a pair to delete, source symbol and test, because deleting
// one without the other either breaks the build or leaves a green test standing
// over nothing.

export interface OrphanOptions {
  root: string;
  /** Production files stopslop analyzed — tests and stories are not among them. */
  files: ParsedFile[];
  /** Knip's own module graph: who imports each export of this file. */
  describeFile: (absPath: string) => File | undefined;
}

export function findOrphanFeatures(options: OrphanOptions): Finding[] {
  const findings: Finding[] = [];

  for (const file of options.files) {
    let described: File | undefined;
    try {
      described = options.describeFile(file.absPath);
    } catch {
      continue; // a file Knip cannot describe simply yields no candidates
    }
    if (!described) continue;
    const callables = callableDeclarations(file.program);

    for (const exported of described.exports) {
      if (!callables.has(exported.identifier)) continue;
      const consumers = consumersOf(exported.importLocations, options.root, file.relPath);

      // Exactly one importer is the whole signal. None means ordinary dead code,
      // already reported as `unused-export`. More than one means either a shared
      // test helper (legitimate, if misplaced) or a live production consumer —
      // both must be left alone.
      //
      // Note it is one *test*, not one *paired* test. Requiring `foo.ts` ↔
      // `foo.test.ts` assumes a suite laid out one file per source file; where
      // suites are grouped by area instead — a `spec.test.ts` covering all of
      // `spec/` — every real orphan hides behind a test that is not its pair.
      // Both orphans found while validating this were of exactly that shape,
      // and dropping the requirement added no findings anywhere else.
      if (consumers.length !== 1) continue;
      const test = consumers[0]!;
      if (isStoryPath(test) || !isTestPath(test)) continue;
      if (isUsedWithinFile(file.source, exported.identifier)) continue;

      findings.push({
        kind: 'orphan-feature',
        file: file.relPath,
        symbol: exported.identifier,
        line: exported.line,
        severity: 'warn',
        message: `\`${exported.identifier}\` is dead in production — only the test \`${test}\` uses it; delete both`,
        data: { test },
      });
    }
  }

  return findings;
}

/**
 * Top-level names bound to something callable: a function, a class, or a const
 * holding a function expression.
 *
 * The signal is about an orphaned *feature* — behaviour the model wrote and
 * never wired in. A plain constant rarely fits that description and often fits a
 * worse one: `export const STYLE = renderPrompt('style.liquid')` is a handle a
 * test uses to reach an asset living outside the module graph, and the asset is
 * very much alive — a Liquid `{% render %}`, a SQL file, a generated schema.
 * Knip cannot see those edges, so about a non-callable export we simply do not
 * know enough to tell anyone to delete it. Both false positives this rule was
 * written for had exactly that shape.
 */
function callableDeclarations(program: OxcNode): Set<string> {
  const names = new Set<string>();
  const body = Array.isArray(program.body) ? (program.body as OxcNode[]) : [];

  for (const statement of body) {
    // `export function f() {}` wraps the declaration; `function f() {}` with a
    // separate `export { f }` does not. Both are the same declaration to us.
    const node = asNode(statement.declaration) ?? statement;
    if (node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration') {
      const id = asNode(node.id);
      if (typeof id?.name === 'string') names.add(id.name);
      continue;
    }
    if (node.type !== 'VariableDeclaration') continue;
    const declarations = Array.isArray(node.declarations) ? (node.declarations as OxcNode[]) : [];
    for (const declarator of declarations) {
      const init = asNode(declarator.init);
      if (init?.type !== 'ArrowFunctionExpression' && init?.type !== 'FunctionExpression') continue;
      const id = asNode(declarator.id);
      if (typeof id?.name === 'string') names.add(id.name);
    }
  }
  return names;
}

function asNode(value: unknown): OxcNode | undefined {
  return typeof value === 'object' && value !== null && 'type' in value
    ? (value as OxcNode)
    : undefined;
}

/** Distinct importing files, relative and POSIX, excluding the file itself. */
function consumersOf(
  locations: readonly { filePath: string }[],
  root: string,
  self: string,
): string[] {
  const seen = new Set<string>();
  for (const location of locations) {
    const rel = relative(root, location.filePath).split(sep).join('/');
    // An importer outside the analysis root is production code we cannot see;
    // counting it keeps the export off the list, which is the safe direction.
    if (rel !== self) seen.add(rel);
  }
  return [...seen];
}

/**
 * Is the symbol referenced inside its own file, beyond the declaration itself?
 *
 * This is the difference between an orphan and the export-for-testing pattern —
 * a function that production code calls one line down, exported only so the test
 * can reach it. Knip reports both as unused exports; only the first is slop, and
 * deleting the second breaks a working program.
 *
 * Deliberately matched against source text rather than the AST: text catches
 * every AST reference plus type positions and comments, so it over-reports usage.
 * Every extra match costs us a finding and never costs the user working code —
 * the right direction for a finding that says "delete this".
 */
function isUsedWithinFile(source: string, identifier: string): boolean {
  const pattern = new RegExp(`(?<![\\w$])${identifier.replace(/\$/g, '\\$')}(?![\\w$])`, 'g');
  let matches = 0;
  while (pattern.exec(source) !== null) {
    if (++matches > 1) return true; // the declaration is the first match
  }
  return false;
}
