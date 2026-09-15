import { defineConfig } from 'vite-plus'

/** Generated output is not part of the workspace: never linted, formatted, type checked or tested. */
const OUTSIDE_THE_WORKSPACE = ['reports/**', 'dist/**']
/** Vendored lint rules keep their upstream style so a resync stays a readable diff. */
const VENDORED = ['tools/oxlint/**']

export default defineConfig({
  lint: {
    plugins: ['typescript', 'oxc', 'import'],
    // The design-system rules agents are held to: no colour outside the theme, no arbitrary
    // Tailwind value, no inline style, no class built at run time, no restyling of a
    // component through className. Tailwind and the theme arrive in lot 1; the rules stand now.
    jsPlugins: [
      '@shadcn/lint',
      { name: 'anti-slop', specifier: './tools/oxlint/anti-slop/index.ts' },
    ],
    categories: {
      correctness: 'error',
      suspicious: 'error',
      perf: 'error',
    },
    rules: {
      'no-console': 'off',
      'typescript/no-explicit-any': 'error',
      'typescript/consistent-type-imports': 'error',
      'import/no-cycle': 'error',
      'shadcn/no-raw-colors': 'error',
      'shadcn/no-arbitrary-values': 'error',
      'shadcn/no-inline-styles': 'error',
      'shadcn/require-static-classes': 'error',
      // Off until Tailwind and the theme exist (lot 1): every class of lot 0 is plain CSS.
      'shadcn/no-unknown-classes': 'off',
      'shadcn/no-restyle': ['error', { allow: ['layout'] }],
      'anti-slop/no-chained-type-assertions': 'error',
      'anti-slop/no-conditional-empty-object-spread': 'error',
      'anti-slop/no-known-value-widening': 'error',
      'anti-slop/no-module-mocking': 'error',
      'anti-slop/no-object-parameters': 'error',
      'anti-slop/no-reduce-accumulator-copy': 'error',
      'anti-slop/no-runtime-typeof': 'error',
      'anti-slop/no-unknown-parameters': 'error',
      'anti-slop/no-unknown-returns': 'error',
      'anti-slop/no-unknown-type-aliases': 'error',
      'anti-slop/no-unsafe-dictionary-type': 'error',
      'anti-slop/no-widen-then-assert': 'error',
      'anti-slop/require-safety-comment-for-type-assertion': 'error',
    },
    ignorePatterns: [...OUTSIDE_THE_WORKSPACE, ...VENDORED],
  },
  fmt: {
    printWidth: 100,
    semi: false,
    singleQuote: true,
    trailingComma: 'all',
    endOfLine: 'lf',
    ignorePatterns: [...OUTSIDE_THE_WORKSPACE, ...VENDORED, '**/*.md'],
  },
  test: {
    include: [
      'apps/*/tests/**/*.test.ts',
      'packages/*/tests/**/*.test.ts',
      'tools/boundaries.test.ts',
      'tools/environment-report.test.ts',
      'tools/git-flow.test.ts',
      'tools/motion-properties.test.ts',
      'tools/package-desktop.test.ts',
      'tools/traceability.test.ts',
      'tools/verification.test.ts',
      'tools/window-options.test.ts',
    ],
  },
})
