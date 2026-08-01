import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts', 'src/cli.ts'],
  format: ['esm'],
  target: 'node20',
  dts: true,
  outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
  // Public exports point at stable names (`dist/index.js` + `dist/index.d.ts`).
  // tsdown hashes shared declaration chunks by default unless disabled.
  hash: false,
  publint: true,
  attw: { profile: 'esm-only', level: 'error' },
  clean: true,
});
