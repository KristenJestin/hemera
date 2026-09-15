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
    // What the design-system rules consider a component: anything coming out of `@hemera/ui`,
    // through its entry point or through one of its subpaths. The theme itself is found by the
    // linter, which reads the stylesheet that imports Tailwind and declares the most tokens.
    settings: {
      shadcn: {
        ui: '@hemera/ui',
        note: 'Every visual value comes from packages/ui/src/theme.css; see AGENTS.md, UI rules.',
      },
    },
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
      'shadcn/no-unknown-classes': 'error',
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
    // A component is the one place a class of its own is not a restyling: inside it, a colour
    // and a padding are the design decision. Everywhere else, passing one is taking it back.
    overrides: [
      {
        files: ['packages/ui/src/components/**'],
        rules: { 'shadcn/no-restyle': 'off' },
      },
    ],
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
  // Two projects, because two things are being proved. The first runs on Node and asks the
  // repository what it claims about itself; the second runs every story of the design system
  // in a real Chromium, because a focus ring, a computed font and a transition are things only
  // a browser decides. One `pnpm test` runs both.
  test: {
    projects: [
      {
        test: {
          name: 'repository',
          include: [
            'apps/*/tests/**/*.test.ts',
            'packages/*/tests/**/*.test.ts',
            'tools/boundaries.test.ts',
            'tools/environment-report.test.ts',
            'tools/git-flow.test.ts',
            'tools/motion-properties.test.ts',
            'tools/package-desktop.test.ts',
            'tools/scales.test.ts',
            'tools/verification.test.ts',
            'tools/window-options.test.ts',
          ],
        },
      },
      './packages/ui/vitest.config.ts',
    ],
  },
})
