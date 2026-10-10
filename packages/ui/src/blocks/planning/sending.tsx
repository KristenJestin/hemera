import { type ReactNode, useEffect, useRef, useState } from 'react'
import { Button, type ButtonProps } from '../../components/button/button.tsx'

export interface Sending {
  /** Whether what was sent waits for the engine's answer. */
  busy: boolean
  /** Why the engine refused what was last sent; cleared by the next send. */
  refusal: string | undefined
  /** Sends once at a time; `taken` runs only once the engine has taken it. */
  send: (sending: () => Promise<void>, taken?: () => void) => void
}

/**
 * How long a send waits before its control says it works: an answer that comes at once leaves
 * the control as it was, rather than flashing it, and a quiet one gone before its fade back.
 */
const SHOWN_AFTER = 120

/**
 * What a control sends to the engine: one send at a time, busy while it waits, and the engine's
 * refusal kept for the control to say. What the user wrote is let go only once it is taken.
 */
export function useSending(): Sending {
  // A ref, not the state: a second press can come before the busy state is drawn.
  const flying = useRef(false)
  const showing = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState<string | undefined>(undefined)
  useEffect(() => () => clearTimeout(showing.current), [])
  const landed = (): void => {
    flying.current = false
    clearTimeout(showing.current)
    setBusy(false)
  }
  const send = (sending: () => Promise<void>, taken?: () => void): void => {
    if (flying.current) return
    flying.current = true
    setRefusal(undefined)
    showing.current = setTimeout(() => setBusy(true), SHOWN_AFTER)
    sending().then(
      () => {
        landed()
        taken?.()
      },
      (failure: Error) => {
        landed()
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

/** A button that sends to the engine: pressed again on its way, it sends nothing; it works meanwhile. */
export function SendButton({
  onSend,
  ...props
}: Omit<ButtonProps, 'onClick' | 'state'> & { onSend: () => Promise<void> }): ReactNode {
  const sending = useSending()
  return (
    <Button
      {...props}
      state={sending.busy ? 'loading' : 'idle'}
      onClick={() => sending.send(onSend)}
    />
  )
}
