import { execSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

type JsonSchema = {
  $defs?: Record<string, JsonSchema>;
  definitions?: Record<string, JsonSchema>;
  $ref?: string;
  additionalProperties?: boolean | JsonSchema;
  allOf?: JsonSchema[];
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
};

function schemaAt(root: JsonSchema, ref: string): JsonSchema {
  return ref
    .slice(2)
    .split('/')
    .reduce((schema, key) => (schema as Record<string, JsonSchema>)[key]!, root);
}

// The generated schema intentionally needs only this small JSON Schema subset.
// Keeping the assertion local avoids a runtime dependency solely for schema tests.
function validates(root: JsonSchema, schema: JsonSchema, value: unknown): boolean {
  if (schema.$ref) return validates(root, schemaAt(root, schema.$ref), value);
  if (schema.allOf && !schema.allOf.every((branch) => validates(root, branch, value))) return false;
  if (schema.anyOf) return schema.anyOf.some((branch) => validates(root, branch, value));
  if (schema.oneOf) return schema.oneOf.filter((branch) => validates(root, branch, value)).length === 1;

  const types = schema.type ? (Array.isArray(schema.type) ? schema.type : [schema.type]) : [];
  if (types.length > 0) {
    const isNull = value === null;
    const actual = Array.isArray(value) ? 'array' : isNull ? 'null' : typeof value;
    if (!types.includes(actual)) return false;
  }

  if (value === null || typeof value !== 'object' || Array.isArray(value)) return true;
  const object = value as Record<string, unknown>;
  if (schema.required?.some((key) => !(key in object))) return false;

  for (const [key, child] of Object.entries(object)) {
    const property = schema.properties?.[key];
    if (property && !validates(root, property, child)) return false;
    if (!property && schema.additionalProperties === false) return false;
    if (!property && typeof schema.additionalProperties === 'object' && !validates(root, schema.additionalProperties, child)) return false;
  }
  return true;
}

const schemaPath = resolve(process.cwd(), 'schema.json');

describe('published config schema', () => {
  it('accepts a representative config, including $schema and pass-through Knip settings', () => {
    const schema = JSON.parse(readFileSync(schemaPath, 'utf8')) as JsonSchema;
    const config = {
      $schema: 'https://example.test/stopslop/schema.json',
      cognitiveComplexity: 20,
      godClass: { minMembers: 15 },
      deadCode: { exports: false },
      knip: {
        entry: ['src/index.ts'],
        workspaces: { '.': { entry: ['src/index.ts'] }, 'packages/*': { project: ['src/**/*.ts'] } },
      },
    };

    expect(validates(schema, schema, config)).toBe(true);
  });

  it('rejects unknown runtime config fields', () => {
    const schema = JSON.parse(readFileSync(schemaPath, 'utf8')) as JsonSchema;

    expect(validates(schema, schema, { cognitiveComplexity: 20, misspelledGate: true })).toBe(false);
    expect(validates(schema, schema, { knip: { entry: 42 } })).toBe(false);
  });

  it('is included in npm pack output', () => {
    const npmCache = mkdtempSync(join(tmpdir(), 'stopslop-npm-cache-'));
    let packed: Array<{ files: Array<{ path: string }> }>;
    try {
      const env: NodeJS.ProcessEnv = { ...process.env, npm_config_cache: npmCache };
      delete env.npm_config_verify_deps_before_run;
      packed = JSON.parse(
        execSync('npm pack --dry-run --json --ignore-scripts', {
          cwd: process.cwd(),
          encoding: 'utf8',
          env,
        }),
      ) as Array<{ files: Array<{ path: string }> }>;
    } finally {
      rmSync(npmCache, { recursive: true, force: true });
    }

    expect(packed).toHaveLength(1);
    expect(packed[0]!.files.map((file) => file.path)).toContain('schema.json');
  }, 15_000);
});
