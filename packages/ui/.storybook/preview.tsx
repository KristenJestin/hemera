import type { Decorator, Preview } from '@storybook/react-vite'
import { MotionConfig } from 'motion/react'
import { useEffect } from 'react'

// A stylesheet is imported for its effect and has nothing to assign; this is how the
// catalogue gets the theme, exactly as the window does.
// oxlint-disable-next-line import/no-unassigned-import
import '../src/theme.css'

/**
 * The theme is a class on the document, the same way the application wears it, so a story sees
 * exactly what the window sees. It is a global rather than a story argument: the toolbar swaps
 * it live, and a story that belongs to one theme pins it for itself.
 *
 * A third value shows both at once, and it is for the eye only: the second copy wears `.dark`
 * on a wrapper rather than on the document, which is enough for what is drawn inside the story
 * and not enough for a portal, a scrollbar or a native control — all of which read the theme
 * off the document. The tests never see it: each run pins one theme on the document itself.
 */
const withTheme: Decorator = (Story, context) => {
  const chosen = context.globals.theme
  const dark = chosen === 'dark'
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
  }, [dark])
  // The canvas is the content surface, because that is the surface all of this is drawn on in
  // the window: the page belongs to the chrome, and a story judged on it is judged on a surface
  // it never sits on. The shell stories cover the canvas with their own root and see nothing.
  useEffect(() => {
    document.body.classList.add('bg-surface-content')
  }, [])
  if (chosen !== 'both') return <Story />
  return (
    <div className="flex flex-col gap-6">
      <Story />
      <div className="dark bg-background p-4 text-foreground">
        <Story />
      </div>
    </div>
  )
}

/**
 * The design system answers the reduced-motion preference itself, in `src/motion.ts`, with the
 * end state for every property. `user` keeps motion's own answer underneath as a net: a motion
 * element that forgets the hook still stops moving when the system asks.
 */
const withMotion: Decorator = (Story) => (
  <MotionConfig reducedMotion="user">
    <Story />
  </MotionConfig>
)

const preview: Preview = {
  decorators: [withMotion, withTheme],
  initialGlobals: { theme: 'light' },
  globalTypes: {
    theme: {
      description: 'The theme the story is drawn in',
      toolbar: {
        title: 'Theme',
        items: [
          { value: 'light', title: 'Light' },
          { value: 'dark', title: 'Dark' },
          { value: 'both', title: 'Both' },
        ],
      },
    },
  },
  parameters: {
    layout: 'centered',
    a11y: {
      test: 'error',
      // Base UI's focus guards (`aria-hidden` with `tabindex="0"`, by construction, as Radix's)
      // trip `aria-hidden-focus` while a popup is open: they are the trap's mechanism, not
      // content, so the check leaves them out rather than the rule being turned off.
      context: { include: [['body']], exclude: [['[data-base-ui-focus-guard]']] },
    },
    /**
     * The sidebar is five roots and nothing else (`AGENTS.md`, "Storybook sidebar, five roots"):
     * the roots in the order written here, and the alphabetical order inside them, which
     * `method: 'alphabetical'` is what asks for — without it Storybook keeps whatever order the
     * index was built in for every name this list does not mention.
     *
     * An array is the order of what precedes it, so `['Session', ['Complete']]` sits right after
     * `Surfaces` and names two things: the `Surfaces/Session` entry first among the surfaces, and
     * `Complete` first among its stories, because that is the one the UI gate opens and the
     * alphabet would bury it.
     */
    options: {
      storySort: {
        includeNames: true,
        method: 'alphabetical',
        order: [
          'Foundations',
          'Components',
          'Blocks',
          'Surfaces',
          ['Session', ['Complete']],
          'Shell',
        ],
      },
    },
  },
}

export default preview
