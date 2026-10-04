import type { ReactNode } from 'react'

import { Button } from '../components/button/button.tsx'
import { Empty } from '../components/empty/empty.tsx'
import { Face } from '../components/face/face.tsx'

/**
 * The engine's state, drawn over the page while the window cannot show one.
 *
 * - `starting` · the engine is coming up: Hemera's face, as large as it is drawn, thinking, and
 *   the word under it. Not its loading pose: that is three dots standing in for a face, and what
 *   starts here is Hemera itself.
 * - `late` · the engine did not start within its maximum delay: the empty shape worn as an error,
 *   the face in its error state, the delay named, and what to do: try again, or read the log.
 * - `stopped` · the engine stopped, or the link to it broke: the same shape, the reason the
 *   engine gave, and Restart Hemera.
 *
 * The veil is the page's own surface, not a dimming: there is nothing under it to dim yet, or
 * nothing left to show. It covers the sheet and leaves the chrome alone, so the sidebar's places
 * stay where they are; what they lead to waits behind the veil.
 */
export type EngineState = 'starting' | 'late' | 'stopped'

const VEIL = 'absolute inset-0 flex flex-col items-center justify-center bg-surface-content'

const STARTING = 'flex flex-col items-center gap-6'

export interface EngineVeilProps {
  state: EngineState
  /** The maximum delay the engine is given, in seconds; named when it was passed. */
  maxDelay: number
  /** What stopped it, in words, when the engine said. */
  reason?: string | undefined
  onRestart: () => void
  onShowLog: () => void
}

export function EngineVeil({
  state,
  maxDelay,
  reason,
  onRestart,
  onShowLog,
}: EngineVeilProps): ReactNode {
  if (state === 'starting') {
    return (
      <div className={VEIL} data-engine="starting">
        <div role="status" aria-label="Starting Hemera" className={STARTING}>
          <Face state="thinking" size="hero" label="Starting Hemera" />
          <p className="text-sm text-muted-foreground">Starting Hemera</p>
        </div>
      </div>
    )
  }
  return (
    <div role="alert" className={VEIL} data-engine={state}>
      <Empty
        face="error"
        title={state === 'late' ? 'Hemera did not start' : 'Hemera stopped'}
        description={
          state === 'late'
            ? `The engine gave no sign within ${String(maxDelay)} seconds.`
            : (reason ?? 'The engine stopped without saying why.')
        }
        action={
          <>
            <Button variant="primary" onClick={onRestart}>
              {state === 'late' ? 'Try again' : 'Restart Hemera'}
            </Button>
            <Button variant="ghost" onClick={onShowLog}>
              Show the log
            </Button>
          </>
        }
      />
    </div>
  )
}
