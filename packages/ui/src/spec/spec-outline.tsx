import { cn } from 'cn'
import { type KeyboardEvent, type ReactNode, useRef } from 'react'

import type { Mark, StageItem } from './model.ts'

/**
 * The outline of a Spec: every piece of it, quiet, one row each (lot 19, brief "Body").
 *
 * The panel shows one thing at a time, and this is how the reader gets to the others: the
 * sections of the type's contract in order, a line, then the three lists with their counts. A
 * row says nothing but its name and a mark — whether it is written, by whom, and whether it
 * needs the reader — so the column reads at a glance and never competes with the stage.
 *
 * It is one stop of the tab order and the arrows walk it, as a list of places is walked
 * everywhere else: up and down move, Home and End jump, Enter opens (the row is a button, and
 * Enter is what a button answers). The row on the stage is the one the tab lands back on.
 */

/** One row of the outline: where it leads, what it is called, its mark and its count. */
export interface OutlineRow {
  item: StageItem
  label: string
  mark: Mark
  /** The count after a list's name: stories, tasks, open questions. */
  count?: number | undefined
  /** A line is drawn above it: the sections end, the lists begin. */
  separated?: boolean | undefined
}

/** What each mark says to whoever cannot see it. */
export const MARK_WORDS: Record<Mark, string> = {
  empty: 'not written',
  agent: 'written by the agent',
  human: 'edited by you',
  stale: 'stale after the rework',
  conflict: 'in conflict with your text',
  writing: 'being written',
}

/**
 * The mark itself: an empty ring, a filled dot, the dot with the blue edge of a human hand, an
 * amber ring, a red dot, or the thin pulse of a text being written — the only one that moves,
 * on the breath of every running thing in the window, and not at all under reduced motion.
 */
const MARKS: Record<Mark, string> = {
  empty: 'size-2 rounded-full border border-input',
  agent: 'size-2 rounded-full bg-muted-foreground',
  human: 'size-2 rounded-full bg-muted-foreground outline outline-offset-1 outline-info',
  stale: 'size-2 rounded-full border-2 border-warning bg-warning-muted',
  conflict: 'size-2 rounded-full bg-destructive',
  writing: 'h-3 w-0.5 rounded-full bg-primary motion-safe:animate-breathe',
}

/** The box every mark sits in, so the names line up whatever mark is before them. */
const MARK_BOX = 'flex size-3 shrink-0 items-center justify-center'

export function StateMark({ mark }: { mark: Mark }): ReactNode {
  return (
    <span className={MARK_BOX} aria-hidden="true">
      <span className={MARKS[mark]} />
    </span>
  )
}

const LIST = 'flex flex-col gap-0.5'

/**
 * A row: the small capitals of a label, the mark before it, the count after it. The row on the
 * stage is filled with the one accent and wears an edge of it on its left.
 */
const ROW =
  'relative flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs font-medium tracking-wide uppercase outline-none focus-ring hover:bg-accent hover:text-foreground'

const ROW_TONE: Record<Mark, string> = {
  empty: 'text-muted-foreground',
  agent: 'text-muted-foreground',
  human: 'text-muted-foreground',
  writing: 'text-muted-foreground',
  stale: 'text-warning-muted-foreground',
  conflict: 'text-destructive-muted-foreground',
}

const ROW_ON =
  'bg-primary-muted text-primary-muted-foreground hover:bg-primary-muted hover:text-primary-muted-foreground before:absolute before:inset-y-1 before:left-0 before:w-0.5 before:rounded-full before:bg-primary'

const COUNT = 'ml-auto font-mono tracking-normal'

const RULE = 'mx-2 my-2 border-t border-border'

export interface SpecOutlineProps {
  /** What the outline is called: `Outline of ATL-7`. */
  label: string
  rows: OutlineRow[]
  /** The row on the stage. */
  current: StageItem
  /** Puts a row on the stage. */
  onSelect: (item: StageItem) => void
}

export function SpecOutline({ label, rows, current, onSelect }: SpecOutlineProps): ReactNode {
  const list = useRef<HTMLUListElement>(null)

  /** Moves the keyboard to another row, without putting it on the stage: Enter does that. */
  function walk(event: KeyboardEvent<HTMLUListElement>): void {
    const buttons = [...(list.current?.querySelectorAll('button') ?? [])]
    const at = buttons.findIndex((button) => button === document.activeElement)
    const last = buttons.length - 1
    const moves = new Map([
      ['ArrowDown', Math.min(at + 1, last)],
      ['ArrowUp', Math.max(at - 1, 0)],
      ['Home', 0],
      ['End', last],
    ])
    const next = moves.get(event.key)
    if (next === undefined) return
    event.preventDefault()
    buttons[next]?.focus()
  }

  return (
    <nav aria-label={label}>
      <ul ref={list} className={LIST} onKeyDown={walk}>
        {rows.map((row) => {
          const on = row.item === current
          return (
            <li key={row.item} className={row.separated === true ? RULE_ABOVE : undefined}>
              {row.separated === true && <div className={RULE} aria-hidden="true" />}
              <button
                type="button"
                // One stop of the tab order: the row on the stage. The arrows do the rest.
                tabIndex={on ? 0 : -1}
                aria-current={on ? 'true' : undefined}
                aria-label={
                  row.count === undefined
                    ? `${row.label}, ${MARK_WORDS[row.mark]}`
                    : `${row.label}, ${row.count}, ${MARK_WORDS[row.mark]}`
                }
                className={cn(ROW, on ? ROW_ON : ROW_TONE[row.mark])}
                onClick={() => onSelect(row.item)}
              >
                <StateMark mark={row.mark} />
                <span className="truncate">{row.label}</span>
                {row.count !== undefined && <span className={COUNT}>{row.count}</span>}
              </button>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

/** The row after the line keeps the line inside its own item, so the list stays a list. */
const RULE_ABOVE = 'flex flex-col'
