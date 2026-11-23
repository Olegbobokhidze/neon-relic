// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

/**
 * Project conventions enforced here (see AGENTS.md and ADR-0001):
 *  - No `enum` and no `interface` declarations: use `as const` objects + `type` aliases.
 *  - The engine package is pure TypeScript: no DOM, React, Pixi or audio imports.
 *  - The renderer and audio packages never import React.
 */
const noEnumNoInterface = [
  {
    selector: 'TSEnumDeclaration',
    message: 'Use a `const X = {...} as const` object plus a derived union type instead of `enum`.',
  },
  {
    selector: 'TSInterfaceDeclaration',
    message: 'Use a `type` alias instead of `interface`.',
  },
];

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      'no-restricted-syntax': ['error', ...noEnumNoInterface],
      '@typescript-eslint/consistent-type-definitions': ['error', 'type'],
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['packages/engine/**/*.ts'],
    languageOptions: { globals: {} },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['react', 'react-*', 'react/*'], message: 'Engine must stay framework-free (ADR-0001).' },
            { group: ['pixi.js', '@pixi/*'], message: 'Engine must not depend on the renderer (ADR-0001).' },
            { group: ['@slot/*'], message: 'Engine is the dependency root; it imports no other workspace package.' },
          ],
        },
      ],
      'no-restricted-globals': ['error', 'window', 'document', 'localStorage', 'requestAnimationFrame', 'AudioContext'],
    },
  },
  {
    files: ['packages/renderer-pixi/**/*.ts', 'packages/audio/**/*.ts', 'packages/adapters/**/*.ts', 'packages/themes/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [{ group: ['react', 'react-*', 'react/*'], message: 'Only apps/* may import React (ADR-0001).' }] },
      ],
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    files: ['scripts/**/*.mjs', '*.js'],
    languageOptions: { globals: globals.node },
  },
);
