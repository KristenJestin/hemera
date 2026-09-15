import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

// The theme is the page's whole stylesheet: the tokens, the scales and Tailwind's own layers.
// oxlint-disable-next-line import/no-unassigned-import
import '@hemera/ui/theme.css'
import { Application } from './application.tsx'

const root = document.querySelector('#root')
if (root === null) throw new Error('the page has no root to mount on')

createRoot(root).render(
  <StrictMode>
    <Application />
  </StrictMode>,
)
