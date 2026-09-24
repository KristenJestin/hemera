import type { ReactNode } from 'react'

import { Disclosure } from '../activity/disclosure.tsx'
import { AgentText } from '../message/agent-text.tsx'
import { HemeraMark } from '../shell/mark.tsx'

/**
 * What Hemera handed the agent at the start of a turn, as a line of the thread (lot 19, brief
 * screen 1; D7-09).
 *
 * The mission's instructions, the brief of the focused phase, the Spec and your edits since the
 * last turn ride the turn's prompt, and the thread says so — as a thin folded line, a system
 * note in Hemera's own mark, never a card and never a message of yours. It opens onto what was
 * handed over, for whoever wants to read what the agent was told.
 */

const LINE = 'flex min-w-0 flex-1 items-center gap-2 text-xs text-muted-foreground'

const RULE = 'flex-1 border-t border-border'

export interface MissionBriefProps {
  /** What the line says: `Mission brief · plan`, `ATL-7 marked ready`. */
  title: string
  /** When, or why, already written: `10:44`. */
  detail: string
  /** What was handed over, in Markdown; left out, the line is a note with nothing to open. */
  brief?: string | undefined
}

export function MissionBrief({ title, detail, brief }: MissionBriefProps): ReactNode {
  return (
    <Disclosure
      summary={
        <span className={LINE}>
          <HemeraMark />
          <span className="font-medium text-foreground">{title}</span>
          <span className="truncate">{detail}</span>
          <span aria-hidden="true" className={RULE} />
        </span>
      }
    >
      {brief === undefined ? undefined : <AgentText text={brief} />}
    </Disclosure>
  )
}
