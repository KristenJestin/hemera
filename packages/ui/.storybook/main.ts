import type { StorybookConfig } from '@storybook/react-vite'

import { withBadges } from './badges.ts'

/**
 * Storybook is where the design system is drawn and where its stories run as tests.
 *
 * The stories sit beside the component they show, so a component and everything said about it
 * move together. Tailwind is added here because the design system has no application to borrow a
 * build from: the theme is compiled for the catalogue exactly as it is for the window.
 */
const config: StorybookConfig = {
  stories: ['../src/**/*.stories.tsx'],
  addons: ['@storybook/addon-a11y', '@storybook/addon-vitest', 'storybook-addon-tag-badges'],
  framework: { name: '@storybook/react-vite', options: {} },
  core: { disableTelemetry: true },
  // The `new` and `updated` badges are Git's to say, not the story file's: see `badges.ts`.
  experimental_indexers: async (indexers) => withBadges(indexers ?? []),
  viteFinal: async (vite) => {
    const { default: tailwindcss } = await import('@tailwindcss/vite')
    return { ...vite, plugins: [...(vite.plugins ?? []), tailwindcss()] }
  },
}

export default config
