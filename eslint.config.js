import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/node_modules/', '**/.next/', '**/dist/', '**/coverage/', 'prototipo/', 'logo/', '_privado/', '.data/', '**/next-env.d.ts'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      eqeqeq: ['error', 'always'],
      'no-console': ['error', { allow: ['warn', 'error', 'info'] }],
    },
  },
  {
    // The database is reached only through packages/core: there, every content query
    // runs inside withWorkspace() (row-level security). Nothing else opens connections.
    files: ['**/*.{ts,tsx}'],
    ignores: ['packages/core/src/db/**', 'packages/core/test/**', 'packages/core/scripts/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'pg', message: 'Use @noergo/core: queries go through withWorkspace().' },
            { name: 'kysely', message: 'Use @noergo/core (sql and types are re-exported from @noergo/core/db).' },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/web/**/*.tsx'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: { globals: { ...globals.browser } },
    rules: reactHooks.configs.recommended.rules,
  },
);
