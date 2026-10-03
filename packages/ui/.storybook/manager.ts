import { GLOBALS_UPDATED } from 'storybook/internal/core-events'
import { addons } from 'storybook/manager-api'
import { themes } from 'storybook/theming'
import type { TagBadgeParameters } from 'storybook-addon-tag-badges/manager-helpers'

/**
 * The two badges of the sidebar, and the whole of what the catalogue shows beside an entry.
 *
 * A branch's stories are found by looking, not by reading a diff: the story file it created wears
 * `new`, the one whose file or component it changed wears `updated`. Git decides, when Storybook
 * indexes the stories (`badges.ts`), so what a badge says is always about what is being reviewed
 * and no story file writes one.
 *
 * The addon ships a wider default set (alpha, deprecated, version…): none of it is kept, because
 * a badge nobody asked for is a badge nobody reads. It also picks the first badge an entry
 * matches, so the order below is the priority.
 */
const BADGES: TagBadgeParameters = [
  {
    tags: 'new',
    badge: { text: 'New', style: 'green', tooltip: 'Created by the branch being reviewed' },
  },
  {
    tags: 'updated',
    badge: { text: 'Updated', style: 'blue', tooltip: 'Changed by the branch being reviewed' },
  },
]

addons.setConfig({ tagBadges: BADGES })

/**
 * Storybook's own chrome follows the theme the toolbar is on.
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
