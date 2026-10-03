import { useEffect, useState } from 'react'

import { watchEngine, type EngineState } from './engine-start.ts'
import type { Link } from './link.ts'

/** Where the engine stands, for as long as the component that asks is mounted. */
export function useEngine(link: Link): EngineState {
  const [state, setState] = useState<EngineState>({ kind: 'starting' })
  useEffect(() => watchEngine(link, setState), [link])
  return state
}
