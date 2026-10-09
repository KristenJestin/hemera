import type { ReactNode } from 'react'

import { Legend } from '../../components/tooltip/legend.tsx'
import {
  IconBug,
  IconClockPause,
  IconExternalLink,
  IconGitCompare,
  IconHandStop,
  IconListCheck,
  IconLock,
  IconRefresh,
} from '../../icons.ts'
import { type MissionMarkView, SPELLED_MARKS, markWords } from './vocabulary.ts'

const MARK_TONE: Record<MissionMarkView['kind'], string> = {
  blocked: 'flex text-destructive',
  waiting: 'flex text-muted-foreground',
  needsYou: 'flex text-warning',
  outdated: 'flex text-warning',
  outside: 'flex text-info',
  fixing: 'flex text-build',
}

function markIcon(mark: MissionMarkView): ReactNode {
  switch (mark.kind) {
    case 'blocked':
      return <IconHandStop size="sm" />
    case 'waiting':
      return <IconClockPause size="sm" />
    case 'needsYou':
      return <IconListCheck size="sm" />
    case 'outdated':
      return <IconRefresh size="sm" />
    case 'outside':
      return <IconGitCompare size="sm" />
    case 'fixing':
      return <IconBug size="sm" />
  }
}

const SPELLED = 'flex min-w-0 items-center gap-1 text-xs'

/**
 * One mark: its glyph with its legend in a tooltip, or — `spelled` — its glyph followed by its
 * words, for a mark whose cause the user must read without pointing at it.
 */
export function MarkGlyph({
  mark,
  spelled = false,
}: {
  mark: MissionMarkView
  spelled?: boolean
}): ReactNode {
  const words = markWords(mark)
  if (spelled) {
    return (
      <span className={SPELLED} data-mark={mark.kind}>
        <span aria-hidden="true" className={MARK_TONE[mark.kind]}>
          {markIcon(mark)}
        </span>
        <span className="truncate">{words}</span>
      </span>
    )
  }
  return (
    <Legend label={words}>
      <span aria-hidden="true" className={MARK_TONE[mark.kind]} data-mark={mark.kind}>
        {markIcon(mark)}
      </span>
    </Legend>
  )
}

/** A mission's marks in a row: each spelled or a glyph by `SPELLED_MARKS`. */
export function MissionMarks({ marks }: { marks: readonly MissionMarkView[] }): ReactNode {
  return (
    <span className="flex min-w-0 items-center gap-2">
      {marks.map((mark) => (
        <MarkGlyph key={markWords(mark)} mark={mark} spelled={SPELLED_MARKS.has(mark.kind)} />
      ))}
    </span>
  )
}

/** The frozen Spec, said once, inside the stage chip. */
export function FrozenGlyph(): ReactNode {
  return (
    <Legend label="Spec frozen">
      <span aria-hidden="true" className="flex text-muted-foreground">
        <IconLock size="sm" />
      </span>
    </Legend>
  )
}

/** The ticket a mission comes from: `acme/shop#41 ↗`. A button, for the window opens it its way. */
export function TicketLink({
  ticket,
  onOpen,
}: {
  ticket: string
  onOpen?: (() => void) | undefined
}): ReactNode {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex min-w-0 items-center gap-1 rounded-sm font-mono outline-none hover:text-foreground focus-ring"
    >
      <IconExternalLink size="sm" />
      <span className="truncate">{ticket}</span>
    </button>
  )
}
