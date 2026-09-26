import { type ReactNode, useId } from 'react'

import { Button } from '../components/button/button.tsx'

/**
 * The quiet bar a Session reading a draft shows at the top of its panel (lot 19, brief screen 6;
 * D7-11).
 *
 * One Session writes a draft, and every other one reads it live. This says which one writes,
 * and offers the one human action that changes it: taking the write right over, at once. What is
 * refused is the agent of a reading Session writing.
 *
 * While the writer is running a turn the right is not taken from under it (Decided 14): the
 * button is disabled and the bar says why, which the button is described by.
 */

const BAR =
  'flex items-center gap-2 border-b border-border bg-accent px-5 py-1.5 text-xs text-muted-foreground'

export interface ReaderBarProps {
  /** The Session that holds the write right. */
  writer: string
  /** Why `Take over` is refused now, or `null` when it can be pressed. */
  takeOverRefused: string | null
  onTakeOver: () => void
}

export function ReaderBar({ writer, takeOverRefused, onTakeOver }: ReaderBarProps): ReactNode {
  const reason = useId()
  return (
    <div role="group" aria-label="Write right" className={BAR}>
      <p className="min-w-0 truncate">
        Written by Session <span className="font-medium text-foreground">{`« ${writer} »`}</span> ·
        you read
      </p>
      <span className="ml-auto flex min-w-0 items-center gap-2">
        {takeOverRefused !== null && (
          <p id={reason} className="min-w-0 truncate">
            {takeOverRefused}
          </p>
        )}
        <Button
          size="sm"
          disabled={takeOverRefused !== null}
          aria-describedby={takeOverRefused === null ? undefined : reason}
          onClick={onTakeOver}
        >
          Take over
        </Button>
      </span>
    </div>
  )
}
