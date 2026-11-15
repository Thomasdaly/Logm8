// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/coverage/**', '**/dist/**', '**/.expo/**'] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    files: ['**/*.ts'],
    languageOptions: { parserOptions: { ecmaVersion: 2022, sourceType: 'module' } },
  },
  {
    files: ['**/test/**/*.ts', '**/__tests__/**/*.{ts,tsx}', '**/jest.setup.tsx'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off', '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    // CommonJS tool configs (Babel, Metro, Jest).
    files: ['**/*.config.js', '**/*.cjs'],
    languageOptions: { sourceType: 'commonjs', globals: { module: 'writable', require: 'readonly', __dirname: 'readonly' } },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    // packages/rules-engine must stay pure: no clock reads, no randomness, no I/O (CLAUDE.md, SPEC §4.2).
    files: ['packages/rules-engine/src/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        { selector: "MemberExpression[object.name='Date'][property.name='now']", message: 'rules-engine is pure: pass `now` in instead of reading the clock.' },
        { selector: "NewExpression[callee.name='Date'][arguments.length=0]", message: 'rules-engine is pure: `new Date()` reads the clock.' },
        { selector: "CallExpression[callee.name='Date']", message: 'rules-engine is pure: `Date()` reads the clock.' },
        { selector: "MemberExpression[object.name='Math'][property.name='random']", message: 'rules-engine must be deterministic.' },
      ],
      'no-restricted-globals': [
        'error',
        'performance', 'process', 'fetch', 'XMLHttpRequest', 'setTimeout', 'setInterval', 'localStorage', 'require', 'crypto',
      ],
      'no-restricted-imports': [
        'error',
        { patterns: [{ group: ['node:*', 'fs', 'fs/*', 'path', 'os', 'http', 'https', 'net', 'child_process', 'crypto'], message: 'rules-engine must not do I/O.' }] },
      ],
    },
  },
);
