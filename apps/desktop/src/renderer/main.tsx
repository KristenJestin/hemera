import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { Application } from './application.tsx'

const root = document.querySelector('#root')
if (root === null) throw new Error('the page has no root to mount on')

createRoot(root).render(
  <StrictMode>
    <Application />
  </StrictMode>,
)
