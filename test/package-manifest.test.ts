import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const packageManifest = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

describe('published package manifest', () => {
  it('pins Knip to exactly version 6.31.0', () => {
    expect(packageManifest.name).toBe('stopslop');
    expect(packageManifest.dependencies?.knip ?? packageManifest.devDependencies?.knip).toBe(
      '6.31.0',
    );
  });
});
