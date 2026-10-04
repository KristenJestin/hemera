import { join } from 'node:path'

import { storybookTest } from '@storybook/addon-vitest/vitest-plugin'
import { playwright } from '@vitest/browser-playwright'
import { type Plugin, defineConfig } from 'vitest/config'

/**
 * The prebundled dependencies handed to a page without their source maps.
 *
 * The dev server writes a module's map into the module every time a page asks for it, and every
 * story file is a page that asks for every dependency again: the icons alone carry a map of nine
 * megabytes. With both themes run at once that work held the runner's one thread for seconds at a
 * time, and everything a story waits on waited behind it. A stack that goes through a dependency
 * reads its bundled code instead of its sources, which is all this costs.
 */
const withoutDependencyMaps: Plugin = {
  name: 'hemera:without-dependency-maps',
  apply: 'serve',
  transform(code, id) {
    const { environment } = this
    if (environment.mode !== 'dev') return null
    if (environment.depsOptimizer?.isOptimizedDepFile(id) !== true) return null
    return { code, map: { mappings: '' } }
  },
}

/**
 * A dependency cache of the theme's own: the Storybook plugin names the cache after the
 * Storybook folder, which both themes share, and two dev servers prebundling into one folder at
 * the same moment replace what the other is writing.
 */
function ownDependencyCache(theme: 'light' | 'dark'): Plugin {
  return {
    name: 'hemera:own-dependency-cache',
    config: (config) => ({ cacheDir: `${config.cacheDir ?? 'node_modules/.vite'}-${theme}` }),
  }
}

/**
 * The catalogue run as tests in a real Chromium, once per theme.
 *
 * A story is not written twice to be seen in both themes: the toolbar swaps the theme of any
 * story. What has to happen twice is the run, because a contrast that passes on white can fail on
 * black. So the theme is a project, not a story.
 *
 * The page asks for less movement, so every story is played on the end state of every movement:
 * a play checks where a component lands, never the journey. What moves on the way — a breath, a
 * sweep, a morph — is checked on image sequences of the catalogue (`frames.ts`), where a frame is
 * a picture and not a timing a busy runner can stretch.
 */
export function catalogue(theme: 'light' | 'dark') {
  return defineConfig({
    plugins: [
      storybookTest({
        configDir: join(import.meta.dirname, '.storybook'),
        initialGlobals: { theme },
      }),
      withoutDependencyMaps,
      ownDependencyCache(theme),
    ],
    // Declared rather than discovered: a dependency the optimizer meets for the first time
    // mid-run makes it reload the page under the tests.
    optimizeDeps: {
      include: [
        '@base-ui/react/button',
        '@base-ui/react/checkbox',
        '@base-ui/react/dialog',
        '@base-ui/react/field',
        '@base-ui/react/menu',
        '@base-ui/react/popover',
        '@base-ui/react/select',
        '@base-ui/react/tabs',
        '@base-ui/react/tooltip',
        '@tabler/icons-react',
        'class-variance-authority',
        'cn',
        'motion/react',
      ],
    },
    test: {
      name: `storybook-${theme}`,
      root: import.meta.dirname,
      // What a story waits on is partly the browser's to give: a font, a popup's first paint.
      // With both themes run at once, two dozen pages share one browser.
      testTimeout: 30_000,
      hookTimeout: 30_000,
      browser: {
        enabled: true,
        headless: true,
        provider: playwright({ contextOptions: { reducedMotion: 'reduce' } }),
        instances: [{ browser: 'chromium' }],
      },
    },
  })
}
