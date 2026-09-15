import { defineConfig } from 'vite-plus'

/** Generated output is not part of the workspace: never linted, formatted, type checked or tested. */
const OUTSIDE_THE_WORKSPACE = ['reports/**', 'dist/**']

export default defineConfig({
  lint: {
    plugins: ['typescript', 'oxc', 'import'],
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
    },
    ignorePatterns: OUTSIDE_THE_WORKSPACE,
  },
  fmt: {
    printWidth: 100,
    semi: false,
    singleQuote: true,
    trailingComma: 'all',
    endOfLine: 'lf',
    ignorePatterns: [...OUTSIDE_THE_WORKSPACE, '**/*.md'],
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
