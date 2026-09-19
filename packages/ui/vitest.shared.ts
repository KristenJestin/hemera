import { join } from 'node:path'

import { storybookTest } from '@storybook/addon-vitest/vitest-plugin'
import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

/**
 * The catalogue run as tests in a real Chromium, once per theme (design D1-06).
 *
 * A story is not written twice to be seen in both themes — the toolbar swaps the theme on any
 * story at any moment, and a story that pins one is a story that lies about the component.
 * What has to happen twice is the *run*: a contrast that passes on white can fail on black,
 * and only the runner can be in both places at once. So the theme is a project, not a story.
 */
export function catalogue(theme: 'light' | 'dark') {
  return defineConfig({
    plugins: [
      storybookTest({
        configDir: join(import.meta.dirname, '.storybook'),
        initialGlobals: { theme },
      }),
    ],
    // Declared rather than discovered: a dependency the optimizer meets for the first time
    // mid-run makes it reload the page under the tests, and a run that reloads is a run that
    // fails for no reason anyone can act on.
    optimizeDeps: {
      include: [
        '@base-ui/react/button',
        '@base-ui/react/dialog',
        '@base-ui/react/field',
        '@base-ui/react/menu',
        '@base-ui/react/popover',
        '@base-ui/react/radio',
        '@base-ui/react/radio-group',
        '@base-ui/react/select',
        '@base-ui/react/tabs',
        '@base-ui/react/tooltip',
        '@tabler/icons-react',
        '@tanstack/react-form',
        '@tanstack/react-hotkeys',
        'class-variance-authority',
        'cn',
        'motion/react',
        'zod',
      ],
    },
    test: {
      name: `storybook-${theme}`,
      root: import.meta.dirname,
      browser: {
        enabled: true,
        headless: true,
        provider: playwright(),
        instances: [{ browser: 'chromium' }],
      },
    },
  })
}
