import { type ReactNode, useEffect, useRef } from 'react'

import { Badge } from '../components/badge/badge.tsx'
import { IconCommand } from '../icons.ts'
import { Disclosure } from './disclosure.tsx'

/**
 * A console the agent is running, as it writes (design D17-06).
 *
 * A command that takes a minute is a command the reader watches, and what they watch is the end
 * of its output. So the console is open while it runs, and it keeps its own bottom: every line
 * that arrives scrolls the box, which is the one place in the application where scroll is
 * driven by what arrives rather than by the hand. The box scrolls inside the thread and stops
 * there — a console that pulled the thread with it would move the page under a reader who is
 * reading further up.
 *
 * When the agent lets the console go it stays in the thread. That is the point of it: the job
 * leaves the agent, but what it printed is what explains the turn afterwards. What it loses is
 * the live mark and the open fold — a released console folds like the rest of the turn, and a
 * press brings its output back.
 */
export interface TerminalOutputProps {
  /** What the console is called: the agent's own id for it. */
  terminalId: string
  /** Everything it has written so far, exactly as it arrived. */
  output: string
  /** Whether the agent has let it go. A released console keeps its output and loses its mark. */
  released?: boolean | undefined
  /** Where the console sits; never how it looks. */
  className?: string | undefined
}

/** The line that is read: the id of the console, and whether it is still writing. */
const SUMMARY = 'flex min-w-0 items-center gap-2'

/** Where the output is written: a fixed box, its own scroll, no scrollbar over the thread. */
const BOX =
  'scroll-quiet max-h-64 overflow-auto rounded-md border border-border bg-muted px-2 py-1.5 font-mono text-xs whitespace-pre text-foreground outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring'

export function TerminalOutput({
  terminalId,
  output,
  released = false,
  className,
}: TerminalOutputProps): ReactNode {
  const box = useRef<HTMLPreElement>(null)
  // The newest line is where the reader is looking. Bound to the output rather than to the
  // mount so that it follows every line, and skipped once the console is released: a console
  // that is over is a log, and a log does not move under the eye.
  useEffect(() => {
    const node = box.current
    if (node === null || released) return
    node.scrollTop = node.scrollHeight
  }, [output, released])
  return (
    <Disclosure
      className={className}
      open={released ? undefined : true}
      summary={
        <span className={SUMMARY}>
          <span className="flex shrink-0 text-muted-foreground">
            <IconCommand size="sm" aria-hidden="true" />
          </span>
          <span className="truncate font-mono text-foreground">{terminalId}</span>
          <Badge tone={released ? 'neutral' : 'info'}>{released ? 'Released' : 'Running'}</Badge>
        </span>
      }
    >
      <pre
        ref={box}
        tabIndex={0}
        role="log"
        aria-label={`Output of ${terminalId}`}
        className={BOX}
      >
        {output}
      </pre>
    </Disclosure>
  )
}
