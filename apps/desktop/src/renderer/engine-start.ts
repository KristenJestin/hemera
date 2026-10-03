/**
 * How the window waits for the engine: for its first answer, as long as it takes, and with a
 * sentence once that has taken too long. The limit cancels nothing; an answer that comes later
 * still makes the window ready.
 */

import type { EngineStatus } from '@hemera/ipc'

import type { Link } from './link.ts'

/** How long the window waits for the engine's first answer before it says so, in milliseconds. */
export const ENGINE_START_LIMIT = 30_000

export type EngineState =
  | { readonly kind: 'starting' }
  | { readonly kind: 'ready'; readonly status: EngineStatus }
  /** No answer yet after the limit; where its diagnostic is, when main could say. */
  | { readonly kind: 'late'; readonly dataFolder: string | null }
  | { readonly kind: 'stopped' }

/** Follows the engine for as long as the window shows it; the answer stops following it. */
export function watchEngine(
  link: Link,
  onState: (state: EngineState) => void,
  limit: number = ENGINE_START_LIMIT,
): () => void {
  let answered = false
  let stopped = false
  const settle = (state: EngineState): void => {
    if (!stopped) onState(state)
  }

  const late = setTimeout(() => {
    if (answered) return
    settle({ kind: 'late', dataFolder: null })
    link.environmentReport().then(
      (report) => {
        if (!answered) settle({ kind: 'late', dataFolder: report.dataFolder })
      },
      () => undefined,
    )
  }, limit)

  const ready = (status: EngineStatus): void => {
    answered = true
    clearTimeout(late)
    settle({ kind: 'ready', status })
  }
  const gone = (): void => {
    answered = true
    clearTimeout(late)
    settle({ kind: 'stopped' })
  }

  settle({ kind: 'starting' })
  link.engineStatus().then(ready, gone)
  const unsubscribe = link.onEngineStatus(ready, gone)

  return () => {
    stopped = true
    clearTimeout(late)
    unsubscribe()
  }
}
