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
    a11y: { test: 'error' },
  },
}

export default preview
