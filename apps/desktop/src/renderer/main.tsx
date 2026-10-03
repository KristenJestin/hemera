import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

// oxlint-disable-next-line import/no-unassigned-import
import './shell.css'
import { Shell } from './shell.tsx'

const root = document.querySelector('#root')
if (root === null) throw new Error('the page has no root to mount on')

createRoot(root).render(
  <StrictMode>
    <Shell />
  </StrictMode>,
)
