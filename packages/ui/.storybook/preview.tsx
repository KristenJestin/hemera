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
 */
const withTheme: Decorator = (Story, context) => {
  const dark = context.globals.theme === 'dark'
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
  }, [dark])
  return <Story />
}

/**
 * The design system answers the reduced-motion preference itself, in `src/motion.ts`: motion's
 * own handling drops a transform animation instead of finishing it, which leaves a panel that
 * should have arrived sitting where it started. `never` tells motion to keep out of it.
 */
const withMotion: Decorator = (Story) => (
  <MotionConfig reducedMotion="never">
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
