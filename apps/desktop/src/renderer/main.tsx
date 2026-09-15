import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { WINDOW_BACKGROUND, WINDOW_FOREGROUND } from '../window-colors.ts'
import { Application } from './application.tsx'

// The page and the frame are painted the same colour by the same two values: read here, and
// read by the main process when it creates the window.
const page = document.documentElement
page.style.setProperty('--window-background', WINDOW_BACKGROUND)
page.style.setProperty('--window-foreground', WINDOW_FOREGROUND)

const root = document.querySelector('#root')
if (root === null) throw new Error('the page has no root to mount on')

createRoot(root).render(
  <StrictMode>
    <Application />
  </StrictMode>,
)
