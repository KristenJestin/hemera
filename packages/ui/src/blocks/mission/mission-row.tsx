import { cn } from 'cn'
import type { ReactNode } from 'react'

import { LetterAvatar } from '../../components/letter-avatar/letter-avatar.tsx'
import { Skeleton } from '../../components/loading/loading.tsx'
import { type Ball, BallMark } from '../ball/ball-mark.tsx'
import { MissionMarks } from './mission-marks.tsx'
import type { MissionMarkView } from './vocabulary.ts'

/**
 * A mission named in a list: on Home, on a Project page, wherever missions are rows.
 *
 * The Project's letter when the list crosses Projects, the key in the mono face, the title, when
 * it last moved, and who has the ball at the end. One row for every list, so a mission reads the
 * same wherever it is met; and the same row, `loading`, is its own skeleton — the letter, the
 * key, the title and the time drawn as shapes in their own places, so a row arriving takes
 * exactly the room its shape held. With `event`, the row has a second line: the last thing that
 * happened to the mission, in words.
 */
const ROW =
  'flex min-h-control-md w-full min-w-0 items-center gap-3 px-4 text-left text-sm outline-none hover:bg-muted focus-ring hover-motion'

const STILL = 'flex min-h-control-md w-full min-w-0 items-center gap-3 px-4 text-sm'

const KEY = 'shrink-0 font-mono text-xs text-muted-foreground'

const TITLE = 'min-w-0 flex-1 truncate font-medium'

const TITLE_TEXT = 'min-w-0 truncate font-medium'

const WHEN = 'shrink-0 text-xs text-muted-foreground tabular-nums'

/** The room the ball takes whether a mark is drawn in it or not, so the times line up. */
const BALL = 'flex size-icon-md shrink-0 items-center justify-center'

const TWO_LINES = 'py-1.5'

const EVENT = 'block truncate text-xs text-muted-foreground'

const PERCENT = 'shrink-0 text-xs text-muted-foreground tabular-nums'

const RULE = 'border-b border-border last:border-b-0'

/** What a row most likely holds, so its skeleton has the length of a row. */
const LIKELY = {
  key: 'ACME-12',
  title: 'Export invoices as CSV from the billing page',
  when: '08:56',
  event: 'Checks green after the second round',
}

export interface MissionRowProps {
  /** The Project the mission belongs to; drawn when the list crosses Projects. */
  project?: string | undefined
  missionKey: string
  title: string
  /** When it last moved, as the row says it: `08:56`, `yesterday`. */
  when: string
  ball: Ball
  /** Second line: the last event in words. Absent: the one-line row of today. */
  event?: string | undefined
  marks?: readonly MissionMarkView[] | undefined
  /** Building's percentage, after the title. */
  percent?: number | undefined
  onOpen: () => void
}

export function MissionRow({
  project,
  missionKey,
  title,
  when,
  ball,
  event,
  marks,
  percent,
  onOpen,
}: MissionRowProps) {
  const hasMarks = marks !== undefined && marks.length > 0
  return (
    <li className={RULE}>
      <button type="button" className={cn(ROW, event !== undefined && TWO_LINES)} onClick={onOpen}>
        {project !== undefined && <LetterAvatar name={project} />}
        <span className={KEY}>{missionKey}</span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-center gap-2">
            <span className={TITLE_TEXT}>{title}</span>
            {percent !== undefined && <span className={PERCENT}>{`${String(percent)}%`}</span>}
            {hasMarks && <MissionMarks marks={marks} />}
          </span>
          {event !== undefined && (
            <span className={EVENT} data-row-event="">
              {event}
            </span>
          )}
        </span>
        <span className={WHEN}>{when}</span>
        <span className={BALL}>
          <BallMark ball={ball} legend />
        </span>
      </button>
    </li>
  )
}

export interface MissionRowSkeletonProps {
  /** Whether the rows it stands for carry the Project's letter. */
  project?: boolean | undefined
  /** Whether the rows it stands for have a second line. */
  twoLines?: boolean | undefined
}

/**
 * The row's own shape while the row is on its way: the same layout, each part a skeleton of the
 * text it will most likely hold, so the row that arrives takes exactly this room.
 */
export function MissionRowSkeleton({
  project = false,
  twoLines = false,
}: MissionRowSkeletonProps): ReactNode {
  return (
    <li aria-hidden="true" className={RULE} data-row-skeleton="">
      <span className={cn(STILL, twoLines && TWO_LINES)}>
        {project && (
          <Skeleton shape="block">
            <LetterAvatar name="A" />
          </Skeleton>
        )}
        <span className={KEY}>
          <Skeleton>{LIKELY.key}</Skeleton>
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className={cn(TITLE, 'font-medium')}>
            <Skeleton>{LIKELY.title}</Skeleton>
          </span>
          {twoLines && (
            <span className={EVENT} data-row-event="">
              <Skeleton>{LIKELY.event}</Skeleton>
            </span>
          )}
        </span>
        <span className={WHEN}>
          <Skeleton>{LIKELY.when}</Skeleton>
        </span>
        <span className={BALL} />
      </span>
    </li>
  )
}
