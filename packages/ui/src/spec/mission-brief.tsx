import type { ReactNode } from 'react'

import { Disclosure } from '../activity/disclosure.tsx'
import { IconFileText } from '../icons.ts'
import { AgentText } from '../message/agent-text.tsx'

/**
 * What Hemera handed the agent at the start of a turn, as a line of the thread (lot 19, brief
 * screen 1; D7-09).
 *
 * The mission's instructions, the brief of the focused phase, the Spec and your edits since the
 * last turn ride the turn's prompt, and the thread says so — as a thin folded line, a system
 * note, never a card and never a message of yours. It opens onto what was handed over, for
 * whoever wants to read what the agent was told. Its glyph is a document, muted like the glyph of
 * every other row of the thread: Hemera's mark in the accent colour stood out of a column where
 * nothing else does (issue #130).
 */

const LINE = 'flex min-w-0 flex-1 items-center gap-2 text-xs text-muted-foreground'

const RULE = 'flex-1 border-t border-border'

export interface MissionBriefProps {
  /** What the line says: `What the agent was told · Plan`, `ATL-7 marked ready`. */
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
          <span className="flex shrink-0 text-muted-foreground">
            <IconFileText size="sm" aria-hidden="true" />
          </span>
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
