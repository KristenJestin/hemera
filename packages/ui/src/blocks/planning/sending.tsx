import { type ReactNode, useRef, useState } from 'react'

export interface Sending {
  /** Whether what was sent waits for the engine's answer. */
  busy: boolean
  /** Why the engine refused what was last sent; cleared by the next send. */
  refusal: string | undefined
  /** Sends once at a time; `taken` runs only once the engine has taken it. */
  send: (sending: () => Promise<void>, taken?: () => void) => void
}

/**
 * What a control sends to the engine: one send at a time, busy while it waits, and the engine's
 * refusal kept for the control to say. What the user wrote is let go only once it is taken.
 */
export function useSending(): Sending {
  // A ref, not the state: a second press can come before the busy state is drawn.
  const flying = useRef(false)
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState<string | undefined>(undefined)
  const send = (sending: () => Promise<void>, taken?: () => void): void => {
    if (flying.current) return
    flying.current = true
    setBusy(true)
    setRefusal(undefined)
    sending().then(
      () => {
        flying.current = false
        setBusy(false)
        taken?.()
      },
      (failure: Error) => {
        flying.current = false
        setBusy(false)
        setRefusal(failure.message)
      },
    )
  }
  return { busy, refusal, send }
}

/** The engine's refusal, said under the field that sent it. */
export function NotSent({ refusal }: { refusal: string | undefined }): ReactNode {
  if (refusal === undefined) return null
  return (
    <p role="alert" className="text-xs break-words text-destructive-muted-foreground">
      Not sent: {refusal}
    </p>
  )
}
