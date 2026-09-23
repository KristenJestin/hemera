import type { ReactNode } from 'react'

import { Button } from '../components/button/button.tsx'

/**
 * The quiet bar a Session reading a draft shows at the top of its panel (lot 19, brief screen 6;
 * D7-11).
 *
 * One Session writes a draft, and every other one reads it live. This says which one writes,
 * and offers the one human action that changes it: taking the write right over, at once. You
 * can still edit the text in place from here — your edits carry this Session as their origin —
 * what is refused is the agent of a reading Session writing.
 */

const BAR =
  'flex items-center gap-2 border-b border-border bg-accent px-5 py-1.5 text-xs text-muted-foreground'

export interface ReaderBarProps {
  /** The Session that holds the write right. */
  writer: string
  onTakeOver: () => void
}

export function ReaderBar({ writer, onTakeOver }: ReaderBarProps): ReactNode {
  return (
    <div role="group" aria-label="Write right" className={BAR}>
      <p className="min-w-0 truncate">
        Written by Session <span className="font-medium text-foreground">{`« ${writer} »`}</span> ·
        you read
      </p>
      <span className="ml-auto flex">
        <Button size="sm" onClick={onTakeOver}>
          Take over
        </Button>
      </span>
    </div>
  )
}
