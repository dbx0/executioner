import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/out/**',
      '**/release/**',
      '**/build/**',
      '**/*.tsbuildinfo',
      'apps/desktop/src/renderer/assets/**',
      // Local, git-ignored README video scenes (plain browser scripts).
      'docs/.readme-media/**',
      // Agent worktrees are whole repo checkouts; linting them double-counts.
      '.claude/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Unused code is exactly the debt this sweep exists to remove, so it is an
    // error rather than a warning. A leading underscore marks a deliberate
    // discard.
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // The renderer is React. The codebase already carries
    // `react-hooks/exhaustive-deps` disable comments, so the plugin those
    // comments refer to must actually be loaded or ESLint errors on them.
    files: ['apps/desktop/src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // react-hooks 7 folds the React Compiler diagnostics into `recommended`.
      // The renderer predates them and does not use the compiler, so they are
      // warnings (a backlog to work down) rather than errors. The two classic
      // rules keep their usual severities.
      ...Object.fromEntries(
        Object.keys(reactHooks.configs.recommended.rules)
          .filter((rule) => rule !== 'react-hooks/rules-of-hooks' && rule !== 'react-hooks/exhaustive-deps')
          .map((rule) => [rule, 'warn']),
      ),
    },
  },
  {
    // Every query lives behind a repository in packages/db. Outside it, nothing
    // imports the driver or the query builder, nor reaches into an open
    // database's handles, so a raw query cannot creep back in elsewhere.
    files: ['**/*.{ts,tsx}'],
    ignores: ['packages/db/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'better-sqlite3', message: 'Query through a repository in @exe/db.' },
            { name: 'drizzle-orm', message: 'Query through a repository in @exe/db.' },
          ],
          patterns: [{ group: ['drizzle-orm/*'], message: 'Query through a repository in @exe/db.' }],
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[property.name=/^(orm|raw|\\$client)$/][object.property.name=/^(db|globalDb)$/]",
          message: 'Only packages/db reads a database handle; add a repository method instead.',
        },
      ],
    },
  },
  {
    // Node scripts and config files run outside the browser.
    files: ['scripts/**/*.{js,mjs,cjs}', 'apps/*/scripts/**/*.{js,mjs,cjs}', '**/*.config.{js,mjs,cjs,ts}'],
    languageOptions: { globals: globals.node },
  },
  {
    // electron-builder hooks are loaded with require(), so they are CommonJS.
    files: ['**/*.cjs'],
    languageOptions: { sourceType: 'commonjs' },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
)
