import stylistic from '@stylistic/eslint-plugin';
import tsParser from '@typescript-eslint/parser';

export default [
  {
    ignores: ['dist/**', 'node_modules/**', 'out/**', 'coverage/**'],
  },
  {
    files: ['src/**/*.ts', 'scripts/**/*.{ts,mjs}', 'test/**/*.ts', 'hooks/**/*.mjs', '*.{ts,mjs}'],
    languageOptions: { parser: tsParser },
    plugins: { '@stylistic': stylistic },
    rules: {
      '@stylistic/padding-line-between-statements': [
        'error',
        { blankLine: 'always', prev: '*', next: ['if', 'for', 'while', 'switch', 'try', 'return', 'throw'] },
        { blankLine: 'always', prev: ['if', 'for', 'while', 'switch', 'try'], next: '*' },
        { blankLine: 'always', prev: ['multiline-const', 'multiline-let', 'multiline-var'], next: '*' },
        { blankLine: 'any', prev: ['import', 'export'], next: ['import', 'export'] },
      ],
    },
  },
];
