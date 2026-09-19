import { DEFAULT_DISPLAY_PREFERENCES } from '@hemera/ipc'
import { MotionConfig } from 'motion/react'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

// The theme is the page's whole stylesheet: the tokens, the scales and Tailwind's own layers.
// oxlint-disable-next-line import/no-unassigned-import
import '@hemera/ui/theme.css'
import { Application } from './application.tsx'
import { startShell } from './shell-store.ts'
import { startTheme } from './theme.ts'

const root = document.querySelector('#root')
if (root === null) throw new Error('the page has no root to mount on')

/**
 * What the profile holds, asked for before anything is mounted (design D3-08).
 *
 * The shell is mounted once, on the values the user chose, rather than mounted on defaults and
 * corrected a frame later — a sidebar that appears open and folds itself is the flash this lot
 * exists to remove. The window is already on screen and already painted while this is asked
 * for, so the wait costs a frame or two and shows nothing.
 *
 * If the profile cannot answer, the page comes up on the declared defaults: a cockpit that
 * refuses to draw because a sidebar width could not be read would be worse than a wide sidebar.
 */
const held = await window.hemera
  .invoke('preferences.read', {})
  .catch(() => DEFAULT_DISPLAY_PREFERENCES)

startTheme(held.theme)
startShell(held)

createRoot(root).render(
  // Around the application and not inside it: the design system answers the reduced-motion
  // preference in its own preset, and `user` keeps motion's own answer underneath as the net
  // for any element that would forget the hook. A hook reads the context it is rendered
  // under, so the application cannot be the one to declare it.
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <Application />
    </MotionConfig>
  </StrictMode>,
)
