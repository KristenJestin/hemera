import { join } from 'node:path'

import { storybookTest } from '@storybook/addon-vitest/vitest-plugin'
import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

/**
 * Every story is a test, run in a real Chromium (design D1-06).
 *
 * A component whose only proof is a snapshot in jsdom proves nothing about a focus ring, a
 * computed font or a transition: those are things a browser decides. Vite+ carries Vitest 4,
 * which is what the Storybook addon asks for, so there is one runner in the repository.
 */
export default defineConfig({
  plugins: [storybookTest({ configDir: join(import.meta.dirname, '.storybook') })],
  test: {
    name: 'ui',
    root: import.meta.dirname,
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: 'chromium' }],
    },
  },
})
