import { cn } from 'cn'
import type { ReactNode } from 'react'

/**
 * The list: rows with a square of icon, a title, a line under it, and something at the end
 * (design D4-07).
 *
 * The Sessions of a Project, the archived Projects of the settings, the files a menu offers —
 * every list of things that have a name reads the same way, and this is where that is decided
 * once. Rows are told apart by a rule between them and never by a box around each: a list of
 * boxes is a list the eye reads one card at a time.
 *
 * A row is a button when choosing it goes somewhere, and a plain row when what it holds is
 * its own control — a `Restore` at the end of an archived Project is the thing to press, not
 * the row.
 */
const ROW = 'flex w-full items-center gap-3 px-4 py-3 text-left'

/** Rows that go somewhere answer the hand the way every control does. */
const PRESSABLE = 'hover:bg-muted focus-ring'

const RULE = 'border-b border-border last:border-b-0'

/** The square of icon at the start of a row: the page's quieter surface, one step rounder. */
const SQUARE =
  'flex size-control-md shrink-0 items-center justify-center rounded-md bg-accent text-muted-foreground'

export interface ListProps {
  /** What the list is called to a screen reader. */
  label: string
  className?: string | undefined
  children: ReactNode
}

export function List({ label, className, children }: ListProps): ReactNode {
  return (
    <ul aria-label={label} className={cn('flex flex-col', className)}>
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
