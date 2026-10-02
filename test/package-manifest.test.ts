import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const packageManifest = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as {
  name?: string;
  description?: string;
  keywords?: string[];
  main?: string;
  types?: string;
  exports?: Record<string, unknown>;
  files?: string[];
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

const context7 = JSON.parse(
  readFileSync(new URL('../context7.json', import.meta.url), 'utf8'),
) as {
  $schema?: string;
  projectTitle?: string;
  description?: string;
  folders?: string[];
  rules?: string[];
};

const llmsIndex = readFileSync(new URL('../llms.txt', import.meta.url), 'utf8');

describe('published package manifest', () => {
  it('pins Knip to exactly version 6.39.0', () => {
    expect(packageManifest.name).toBe('stopslop');
    expect(packageManifest.dependencies?.knip ?? packageManifest.devDependencies?.knip).toBe(
      '6.39.0',
    );
  });

  it('publishes complete registry discovery metadata', () => {
    expect(packageManifest.description).toContain('AI-generated JavaScript and TypeScript');
    expect(packageManifest.main).toBe('./dist/index.js');
    expect(packageManifest.types).toBe('./dist/index.d.ts');
    expect(packageManifest.exports).toHaveProperty('./package.json');
    expect(packageManifest.files).toEqual(
      expect.arrayContaining(['README.md', 'LICENSE', 'llms.txt', 'context7.json']),
    );
    expect(packageManifest.keywords).toEqual(
      expect.arrayContaining([
        'ai-slop',
        'vibe-coding',
        'static-analysis',
        'cognitive-complexity',
        'duplicate-code',
        'dead-code',
        'sarif',
        'quality-gate',
      ]),
    );
    expect(new Set(packageManifest.keywords).size).toBe(packageManifest.keywords?.length);
  });

  it('keeps Context7 focused on public documentation and usage rules', () => {
    expect(context7.$schema).toBe('https://context7.com/schema/context7.json');
    expect(context7.projectTitle).toBe('StopSlop');
    expect(context7.description?.length).toBeLessThanOrEqual(200);
    expect(context7.folders).toEqual(['docs']);
    expect(context7.rules?.length).toBeGreaterThanOrEqual(8);
    expect(context7.rules?.every((rule) => rule.length <= 255)).toBe(true);
    expect(llmsIndex).toContain('/docs/ci-and-automation.md');
    expect(llmsIndex).toContain('/docs/node-api.md');
  });
});
