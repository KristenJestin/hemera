import type { StorybookConfig } from '@storybook/react-vite'

/**
 * Storybook is where this lot is validated and where its tests run (design D1-06).
 *
 * The stories sit beside the component they show, so a component and everything said about it
 * move together. Tailwind is added here because the design system has no application to
 * borrow a build from: the theme is compiled for the catalogue exactly as it is for the window.
 */
const config: StorybookConfig = {
  stories: ['../src/**/*.stories.tsx'],
  addons: [
    '@storybook/addon-a11y',
    '@storybook/addon-vitest',
    '@storybook/addon-mcp',
    'storybook-addon-tag-badges',
  ],
  framework: { name: '@storybook/react-vite', options: {} },
  viteFinal: async (vite) => {
    const { default: tailwindcss } = await import('@tailwindcss/vite')
    return { ...vite, plugins: [...(vite.plugins ?? []), tailwindcss()] }
  },
}

export default config
