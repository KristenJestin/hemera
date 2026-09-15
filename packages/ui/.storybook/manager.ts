import { GLOBALS_UPDATED } from 'storybook/internal/core-events'
import { addons } from 'storybook/manager-api'
import { themes } from 'storybook/theming'

/**
 * Storybook's own chrome follows the theme the toolbar is on (design D1-06).
 *
 * The toolbar swaps the theme of the story; the sidebar, the toolbar and the panels around it
 * are a separate application with a theme of its own, and a dark story framed in a white
 * manager is a contrast nobody can judge. The manager listens to the same global the preview
 * reads, so there is one switch and not two.
 */
addons.register('hemera/theme', (api) => {
  api.on(GLOBALS_UPDATED, ({ globals }: { globals: { theme?: string } }) => {
    api.setOptions({ theme: globals.theme === 'dark' ? themes.dark : themes.light })
  })
})
