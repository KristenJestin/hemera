import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

// oxlint-disable-next-line import/no-unassigned-import
import './shell.css'
import { connect } from './link.ts'
import { Shell } from './shell.tsx'
import { useEngine } from './use-engine.ts'

const root = document.querySelector('#root')
if (root === null) throw new Error('the page has no root to mount on')

/** One link per page: a page that reloads opens a new one. */
const link = connect()

function Application() {
  const engine = useEngine(link)
  return <Shell engine={engine} onRelaunch={() => void link.relaunch()} />
}

createRoot(root).render(
  <StrictMode>
    <Application />
  </StrictMode>,
)
