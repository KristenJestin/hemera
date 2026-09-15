import { MotionConfig } from 'motion/react'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

// The theme is the page's whole stylesheet: the tokens, the scales and Tailwind's own layers.
// oxlint-disable-next-line import/no-unassigned-import
import '@hemera/ui/theme.css'
import { Application } from './application.tsx'
import { syncTheme } from './theme.ts'

const root = document.querySelector('#root')
if (root === null) throw new Error('the page has no root to mount on')

// The page is what decides the theme, so it says so before anything is drawn: the frame is
// outside the page and would otherwise keep whatever the previous page left it wearing.
syncTheme()

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
