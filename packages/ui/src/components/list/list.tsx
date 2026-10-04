import { cn } from 'cn'
import type { ReactNode } from 'react'

import { Skeleton } from '../loading/loading.tsx'

/**
 * The list: rows with a square of icon, a title, a line under it, and something at the end.
 *
 * The repositories of a Project, the archived Projects, the files a menu offers — every list of
 * things that have a name reads the same way, and this is where that is decided once. Rows are told apart by a rule between them and never by a box around each: a list of
 * boxes is a list the eye reads one card at a time.
 *
 * A row is a button when choosing it goes somewhere, and a plain row when what it holds is
 * its own control — a `Restore` at the end of an archived Project is the thing to press, not
 * the row.
 *
 * While the rows are on their way, the list shows the rows themselves in their loading mode, not a
 * spinner and not a generic block: the same square, the same lines at the length of what they will
 * say, the same thing at the end, in the skeleton's fill. The page does not move when the rows
 * arrive, because every part of them arrives where its skeleton already was.
 */
const ROW = 'flex w-full items-center gap-3 px-4 py-3 text-left'

/** Rows that go somewhere answer the hand the way every control does. */
const PRESSABLE = 'hover:bg-muted focus-ring hover-motion'

const RULE = 'border-b border-border last:border-b-0'

/** The square of icon at the start of a row: the page's quieter surface, one step rounder. */
const SQUARE =
  'flex size-control-md shrink-0 items-center justify-center rounded-md bg-accent text-muted-foreground'

/** The same square on its way: the skeleton's fill, breathing, and its icon not shown. */
const SQUARE_LOADING =
  'flex size-control-md shrink-0 items-center justify-center rounded-md bg-skeleton text-transparent motion-safe:animate-breathe'

const TITLE = 'truncate text-base font-semibold'
const DESCRIPTION = 'truncate text-sm text-muted-foreground'
const TRAILING = 'flex shrink-0 items-center gap-2 text-sm text-muted-foreground'

export interface ListProps {
  /** What the list is called to a screen reader. */
  label: string
  /** Whether its rows are on their way: it then holds skeletons, and says so once. */
  busy?: boolean | undefined
  className?: string | undefined
  children: ReactNode
}

export function List({ label, busy = false, className, children }: ListProps): ReactNode {
  return (
    <ul aria-label={label} aria-busy={busy} className={cn('flex flex-col', className)}>
      {children}
    </ul>
  )
}

export interface ListItemProps {
  icon?: ReactNode
  title: string
  /** The line under the title. */
  description?: string | undefined
  /** What sits at the end of the row: a time, a control. */
  trailing?: ReactNode
  /** Where choosing the row goes; a row with none is a row whose control is at its end. */
  onSelect?: (() => void) | undefined
  /**
   * Whether the row is on its way: it is then drawn in its loading mode, each part a skeleton of
   * itself — give it the text it will most likely hold, so its lines have that length. Hidden from
   * a screen reader and not pressable; the list says it is busy.
   */
  loading?: boolean | undefined
}

export function ListItem({
  icon,
  title,
  description,
  trailing,
  onSelect,
  loading = false,
}: ListItemProps): ReactNode {
  /** A part as it is, or as its skeleton while the row is on its way. */
  const held = (part: ReactNode, shape: 'text' | 'block' = 'text'): ReactNode =>
    loading ? <Skeleton shape={shape}>{part}</Skeleton> : part
  const inside = (
    <>
      {icon !== undefined && (
        <span className={loading ? SQUARE_LOADING : SQUARE} data-part="icon">
          {icon}
        </span>
      )}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={TITLE} data-part="title">
          {held(title)}
        </span>
        {description !== undefined && (
          <span className={DESCRIPTION} data-part="description">
            {held(description)}
          </span>
        )}
      </span>
      {trailing !== undefined && (
        <span className={TRAILING} data-part="trailing">
          {held(trailing, typeof trailing === 'string' ? 'text' : 'block')}
        </span>
      )}
    </>
  )
  if (loading) {
    return (
      <li aria-hidden="true" className={RULE} data-loading="">
        <div className={ROW}>{inside}</div>
      </li>
    )
  }
  return (
    <li className={RULE}>
      {onSelect === undefined ? (
        <div className={ROW}>{inside}</div>
      ) : (
        <button type="button" className={cn(ROW, PRESSABLE)} onClick={onSelect}>
          {inside}
        </button>
      )}
    </li>
  )
}
