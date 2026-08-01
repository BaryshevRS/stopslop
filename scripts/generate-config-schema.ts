import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Schema = { [key: string]: Json };

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const knipSchemaPath = resolve(projectRoot, 'node_modules/knip/schema.json');
const outputPath = resolve(projectRoot, 'schema.json');

function rewriteKnipRefs(value: Json): Json {
  if (Array.isArray(value)) return value.map(rewriteKnipRefs);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => {
      if (key === '$ref' && typeof child === 'string' && child.startsWith('#/')) {
        return [key, `#/definitions/knip/${child.slice(2)}`];
      }
      return [key, rewriteKnipRefs(child)];
    }),
  );
}

const booleanProperty = (description: string, defaultValue: boolean): Schema => ({
  type: 'boolean',
  description,
  default: defaultValue,
});

const numberProperty = (description: string, defaultValue: number, minimum = 0): Schema => ({
  type: 'number',
  description,
  default: defaultValue,
  minimum,
});

const objectOrFalse = (properties: Record<string, Schema>): Schema => ({
  anyOf: [
    { const: false },
    { type: 'object', additionalProperties: false, properties },
  ],
});

const scoreSignals = (defaults: Record<string, number>): Schema => ({
  type: 'object',
  additionalProperties: false,
  properties: Object.fromEntries(
    Object.entries(defaults).map(([name, value]) => [name, numberProperty(`${name} signal`, value)]),
  ),
});

const rawKnipSchema = JSON.parse(readFileSync(knipSchemaPath, 'utf8')) as Schema;
delete rawKnipSchema.$schema;
const knipSchema = rewriteKnipRefs(rawKnipSchema);

const schema: Schema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'https://unpkg.com/stopslop/schema.json',
  title: 'StopSlop configuration',
  description:
    'Configuration for StopSlop. The knip property is the sole source of Knip configuration; project Knip configs are ignored.',
  type: 'object',
  additionalProperties: false,
  properties: {
    $schema: {
      type: 'string',
      description: 'JSON Schema URL used by editors for completion and validation.',
    },
    cognitiveComplexity: {
      anyOf: [
        { const: false },
        numberProperty('Report functions strictly above this cognitive complexity.', 15),
      ],
    },
    godModule: objectOrFalse({
      minMembers: numberProperty('Minimum members for the dispersion gate.', 15),
      minClusters: numberProperty('Minimum responsibility groups for the dispersion gate.', 3),
      minComplexity: numberProperty('Minimum total complexity for the dispersion gate.', 150),
      sizeMembers: numberProperty('Member threshold for the size gate.', 37),
      sizeComplexity: numberProperty('Complexity threshold for the size gate.', 350),
    }),
    godClass: objectOrFalse({
      minMembers: numberProperty('Minimum members for the dispersion gate.', 12),
      minClusters: numberProperty('Minimum responsibility groups for the dispersion gate.', 3),
      minComplexity: numberProperty('Minimum total complexity for the dispersion gate.', 90),
      sizeMembers: numberProperty('Member threshold for the size gate.', 30),
      sizeComplexity: numberProperty('Complexity threshold for the size gate.', 200),
    }),
    multipleExportedClasses: objectOrFalse({
      maxPerFile: numberProperty('Maximum exported classes allowed in one file.', 1),
    }),
    duplicates: objectOrFalse({
      minTokens: numberProperty('Minimum token span reported as a clone.', 50, 1),
      minLines: numberProperty('Minimum physical lines reported as a clone.', 5, 1),
      ignoreIdentifiers: booleanProperty('Normalize identifier names while matching.', false),
      ignoreLiterals: booleanProperty('Normalize literal values while matching.', false),
    }),
    deadCode: objectOrFalse({
      exports: booleanProperty('Report unused exports and exported types.', true),
      dependencies: booleanProperty('Report unused dependencies and devDependencies.', true),
      files: booleanProperty('Report files unreachable from an entry point.', true),
      orphans: booleanProperty(
        'Report functions kept alive by nothing but their own paired test.',
        true,
      ),
      production: booleanProperty('Analyze production code only.', false),
    }),
    knip: {
      description:
        'Complete JSON-compatible Knip configuration. knip.json, knip.config.* and package.json#knip are ignored.',
      $ref: '#/definitions/knip',
    },
    score: {
      type: 'object',
      additionalProperties: false,
      properties: {
        weights: scoreSignals({ god: 0.35, complexity: 0.2, duplication: 0.25, deadCode: 0.2 }),
        budgets: scoreSignals({ god: 0.1, complexity: 4, duplication: 0.3, deadCode: 4 }),
        floors: scoreSignals({ god: 0, complexity: 0, duplication: 0.05, deadCode: 0 }),
      },
    },
    hubFanInRatio: {
      ...numberProperty('Fan-in fraction above which a member is treated as shared glue.', 0.5),
      maximum: 1,
    },
    ignore: {
      type: 'array',
      description: 'Additional source globs excluded by StopSlop.',
      items: { type: 'string' },
      default: [],
    },
  },
  definitions: { knip: knipSchema },
};

const generated = `${JSON.stringify(schema, null, 2)}\n`;
if (process.argv.includes('--check')) {
  let current = '';
  try {
    current = readFileSync(outputPath, 'utf8');
  } catch {
    // The error below explains how to create the missing artifact.
  }
  if (current !== generated) {
    throw new Error('schema.json is stale; run `pnpm schema:generate` and commit the result');
  }
} else {
  writeFileSync(outputPath, generated);
}
