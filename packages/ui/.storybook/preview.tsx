import type { Decorator, Preview } from '@storybook/react-vite'
import { MotionConfig } from 'motion/react'
import { useEffect } from 'react'
import { configure } from 'storybook/test'

import { TooltipProvider } from '../src/components/tooltip/tooltip.tsx'
// A stylesheet is imported for its effect and has nothing to assign; this is how the catalogue
// gets the theme, exactly as the window does.
// oxlint-disable-next-line import/no-unassigned-import
import '../src/theme.css'

/**
 * The theme is a class on the document, the way the application wears it, so a story sees exactly
 * what the window sees. It is a global rather than a story argument: the toolbar swaps it live.
 *
 * A third value shows both at once, for the eye only: the second copy wears `.dark` on a wrapper
 * rather than on the document, which is enough for what is drawn inside the story and not for a
 * portal, a scrollbar or a native control. The tests never see it: each run pins one theme.
 */
const withTheme: Decorator = (Story, context) => {
  const chosen = context.globals['theme']
  const dark = chosen === 'dark'
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
  }, [dark])
  // The canvas is the content surface, because that is what everything is drawn on in the window.
  useEffect(() => {
    document.body.classList.add('bg-surface-content')
  }, [])
  if (chosen !== 'both') return <Story />
  return (
    <div className="flex flex-col gap-6">
      <Story />
      <div className="dark bg-surface-content p-4 text-foreground">
        <Story />
      </div>
    </div>
  )
}

/**
 * The design system answers the reduced-motion preference itself, in `src/motion.ts`. `user`
 * keeps motion's own answer underneath as a net for an element that forgets the hook.
 */
const withMotion: Decorator = (Story) => (
  <MotionConfig reducedMotion="user">
    <Story />
  </MotionConfig>
)

/** One delay for every tooltip, as the window's shell gives it. */
const withTooltips: Decorator = (Story) => (
  <TooltipProvider>
    <Story />
  </TooltipProvider>
)

/**
 * What the accessibility check reports node by node: everything in the catalogue, where the panel
 * shows it, and only what it refuses when the runner plays the stories — the passes of a run of
 * both themes weigh a hundred megabytes, read on the runner's one thread.
 */
const RESULT_TYPES =
  '__vitest_browser__' in globalThis
    ? ['violations']
    : ['violations', 'incomplete', 'passes', 'inapplicable']

const preview: Preview = {
  decorators: [withTooltips, withMotion, withTheme],
  /**
   * How long a play waits for the state it asked for: a loaded CI machine takes seconds to paint
   * what a developer machine paints in frames.
   */
  beforeEach: () => {
    configure({ asyncUtilTimeout: 10_000 })
  },
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
    /** The two sizes every screen is designed at; a story of a screen opens at the laptop's. */
    viewport: {
      options: {
        desktop: {
          name: 'Desktop 1920×1080',
          styles: { width: '1920px', height: '1080px' },
          type: 'desktop',
        },
        laptop: {
          name: 'Laptop 1366×768',
          styles: { width: '1366px', height: '768px' },
          type: 'desktop',
        },
      },
    },
    a11y: {
      test: 'error',
      // Base UI's focus guards (`aria-hidden` with `tabindex="0"`, by construction) trip
      // `aria-hidden-focus` while a popup is open: they are the trap's mechanism, not content.
      context: { include: [['body']], exclude: [['[data-base-ui-focus-guard]']] },
      options: { resultTypes: RESULT_TYPES },
    },
    /**
     * The roots in the order `AGENTS.md` gives them, and the alphabetical order inside them, which
     * `method: 'alphabetical'` asks for: without it Storybook keeps the order the index was built
     * in for every name this list does not mention.
     */
    options: {
      storySort: {
        includeNames: true,
        method: 'alphabetical',
        order: ['Foundations', 'Components', 'Blocks', 'Surfaces', 'Shell', 'Explorations'],
      },
    },
  },
}

export default preview
