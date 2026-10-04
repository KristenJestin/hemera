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
 * While the rows are on their way, the list shows their shape and not a spinner: the same square,
 * the same two lines, the same rule, in the skeleton's fill (`ListItemSkeleton`). The page does not
 * move when the rows arrive, because they arrive where their shape already was.
 */
const ROW = 'flex w-full items-center gap-3 px-4 py-3 text-left'

/** Rows that go somewhere answer the hand the way every control does. */
const PRESSABLE = 'hover:bg-muted focus-ring hover-motion'

const RULE = 'border-b border-border last:border-b-0'

/** The square of icon at the start of a row: the page's quieter surface, one step rounder. */
const SQUARE =
  'flex size-control-md shrink-0 items-center justify-center rounded-md bg-accent text-muted-foreground'

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
}

export function ListItem({
  icon,
  title,
  description,
  trailing,
  onSelect,
}: ListItemProps): ReactNode {
  const inside = (
    <>
      {icon !== undefined && <span className={SQUARE}>{icon}</span>}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-base font-semibold">{title}</span>
        {description !== undefined && (
          <span className="truncate text-sm text-muted-foreground">{description}</span>
        )}
      </span>
      {trailing !== undefined && (
        <span className="flex shrink-0 items-center gap-2 text-sm text-muted-foreground">
          {trailing}
        </span>
      )}
    </>
  )
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

export interface ListItemSkeletonProps {
  /** Whether the rows it stands for have a square of icon. */
  icon?: boolean | undefined
  /** Whether the rows it stands for have a line under their title. */
  description?: boolean | undefined
}

/**
 * A row whose shape is known and whose content is not there yet: the row's own box, rule and
 * height, with its square and its lines drawn as skeletons. Hidden from a screen reader: the list
 * that holds it says it is busy, once.
 */
export function ListItemSkeleton({
  icon = true,
  description = true,
}: ListItemSkeletonProps): ReactNode {
  return (
    <li aria-hidden="true" className={RULE} data-skeleton="">
      <div className={ROW}>
        {icon && <Skeleton shape="square" />}
        <span className="flex min-w-0 flex-1 flex-col">
          <Skeleton shape="title" />
          {description && <Skeleton shape="line" />}
        </span>
      </div>
    </li>
  )
}
