import { Dialog as BaseDialog } from '@base-ui/react/dialog'
import { cn } from 'cn'
import { type ReactNode, useEffect, useId, useRef, useState } from 'react'

import { Kbd } from '../components/kbd/kbd.tsx'
import { IconCommand } from '../icons.ts'
import { useOverlayContainer } from '../overlay.ts'
import type { ProjectTone } from './model.ts'

/**
 * The command palette: one keystroke, every place and every action (design D4-07).
 *
 * It is a Base UI dialog and a list, and not a menu: a menu is a short set of things to do to
 * one element, where this is a search across the whole application. Base UI gives it what a
 * dialog gives — the focus trapped while it is open, given back to whatever had it on close,
 * Escape and a click outside both closing it — and the list is written here because what it
 * needs is a filter, a selection that moves with the arrows, and sections that stay readable
 * while it narrows.
 *
 * What it offers is scoped to the active Project, which is what the caller hands as `groups`.
 * A query that starts with `>` widens it to every Project — `everywhere` — and the header says
 * which of the two is being read, so the eye never has to infer it from the results.
 */
const BACKDROP =
  'fixed inset-0 bg-overlay backdrop-blur-xs backdrop-motion data-starting-style:opacity-0 data-starting-style:backdrop-blur-none data-ending-style:opacity-0 data-ending-style:backdrop-blur-none'

/**
 * Near the top rather than dead centre: a list that grows downwards from the middle of the
 * window moves its own first result under the hand as it fills.
 */
const POPUP =
  'fixed inset-x-0 top-24 mx-auto flex h-fit w-full max-w-xl flex-col overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-lg outline-none translate-y-0 scale-100 popup-motion data-starting-style:-translate-y-4 data-starting-style:scale-95 data-starting-style:opacity-0 data-ending-style:-translate-y-4 data-ending-style:scale-95 data-ending-style:opacity-0'

const HEAD = 'flex items-center gap-2 border-b border-border px-4 py-3'

const SCOPE = 'shrink-0 rounded-md bg-accent px-2 py-0.5 text-xs text-accent-foreground'

/** The input is the dialog's one field: it carries no border of its own, the header has it. */
const QUERY = 'min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground'

const BODY = 'scroll-quiet flex max-h-96 flex-col gap-1 overflow-y-auto p-2'

const GROUP = 'px-2 pt-2 pb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase'

const ITEM = 'flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm'

const ITEM_ACTIVE = 'bg-accent text-accent-foreground'

const FOOT =
  'flex flex-wrap items-center gap-3 border-t border-border px-4 py-2 text-xs text-muted-foreground'

/** The dot a Project entry is told apart by: a tone of the theme, never a colour. */
const TONE: Record<ProjectTone, string> = {
  primary: 'bg-primary',
  info: 'bg-info',
  success: 'bg-success',
  warning: 'bg-warning',
  neutral: 'bg-mission-free',
}

/** What typing it asks for: every Project rather than the active one. */
export const EVERYWHERE_PREFIX = '>'

export interface CommandEntry {
  id: string
  label: string
  /** A word of context beside the label: which Project it belongs to, what it will open. */
  hint?: string | undefined
  /** The keystroke that does the same thing, already written for the platform. */
  keys?: string | undefined
  icon?: ReactNode
  /** The tone of the Project an entry names, when it names one. */
  tone?: ProjectTone | undefined
  onSelect: () => void
}

export interface CommandGroup {
  label: string
  entries: CommandEntry[]
}

export interface CommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The name of the active Project, and null on a window that has none yet. */
  scope: string | null
  /** What the active Project offers. */
  groups: CommandGroup[]
  /** What every Project offers, reached by typing `>`. */
  everywhere: CommandGroup[]
}

/** The groups that still have something in them once the query has been applied. */
function matching(groups: CommandGroup[], term: string): CommandGroup[] {
  if (term === '') return groups.filter((group) => group.entries.length > 0)
  const wanted = term.toLowerCase()
  return groups
    .map((group) => ({
      label: group.label,
      entries: group.entries.filter((entry) =>
        `${entry.label} ${entry.hint ?? ''}`.toLowerCase().includes(wanted),
      ),
    }))
    .filter((group) => group.entries.length > 0)
}

export function CommandPalette({
  open,
  onOpenChange,
  scope,
  groups,
  everywhere,
}: CommandPaletteProps): ReactNode {
  const container = useOverlayContainer()
  const list = useId()
  const field = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)

  const widened = query.startsWith(EVERYWHERE_PREFIX)
  const term = (widened ? query.slice(EVERYWHERE_PREFIX.length) : query).trim()
  const shown = matching(widened ? everywhere : groups, term)
  const entries = shown.flatMap((group) => group.entries)
  // The selection lands back on the first result whenever the list underneath it changes: an
  // index kept across a narrowing query is a highlight on whatever happens to be in that place.
  const selected = Math.min(active, Math.max(entries.length - 1, 0))

  useEffect(() => {
    setActive(0)
  }, [query])

  const close = () => {
    setQuery('')
    setActive(0)
    onOpenChange(false)
  }

  const run = (entry: CommandEntry) => {
    close()
    entry.onSelect()
  }

  return (
    <BaseDialog.Root
      open={open}
      onOpenChange={(next) => {
        if (next) onOpenChange(true)
        else close()
      }}
    >
      <BaseDialog.Portal container={container}>
        <BaseDialog.Backdrop className={BACKDROP} />
        <BaseDialog.Popup className={POPUP} aria-label="Command palette" initialFocus={field}>
          <div className={HEAD}>
            <IconCommand size="md" />
            <span className={SCOPE}>{widened ? 'Every Project' : (scope ?? 'Hemera')}</span>
            {/* The palette is opened by a keystroke, so the field it opens on is the one
                thing the hand is already aiming at. Base UI is told which element that is,
                rather than the field taking the focus itself: what gives it back on close is
                the same dialog, and a field that grabs it first is a focus nobody returns. */}
            <input
              ref={field}
              className={QUERY}
              type="text"
              role="combobox"
              aria-expanded="true"
              aria-controls={list}
              aria-activedescendant={
                entries[selected] === undefined ? undefined : `${list}-${entries[selected].id}`
              }
              aria-label="Type a command"
              placeholder="Type a command, a place, a Project…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown') {
                  event.preventDefault()
                  setActive(entries.length === 0 ? 0 : (selected + 1) % entries.length)
                }
                if (event.key === 'ArrowUp') {
                  event.preventDefault()
                  setActive(
                    entries.length === 0 ? 0 : (selected - 1 + entries.length) % entries.length,
                  )
                }
                if (event.key === 'Enter') {
                  event.preventDefault()
                  const entry = entries[selected]
                  if (entry !== undefined) run(entry)
                }
              }}
            />
          </div>

          {entries.length === 0 ? (
            <div className={BODY} id={list}>
              <p className="px-2 py-6 text-center text-sm text-muted-foreground">
                Nothing matches “{term}”.
              </p>
            </div>
          ) : (
            <div className={BODY} id={list} role="listbox" aria-label="Commands">
              {shown.map((group) => (
                <div
                  key={group.label}
                  role="group"
                  aria-label={group.label}
                  className="flex flex-col"
                >
                  <p aria-hidden="true" className={GROUP}>
                    {group.label}
                  </p>
                  {group.entries.map((entry) => (
                    <button
                      key={entry.id}
                      type="button"
                      id={`${list}-${entry.id}`}
                      role="option"
                      aria-selected={entry === entries[selected]}
                      className={cn(ITEM, entry === entries[selected] && ITEM_ACTIVE)}
                      // The pointer says what the keyboard would have said, so the two never
                      // disagree about which entry Enter is about to run.
                      onMouseMove={() => setActive(entries.indexOf(entry))}
                      onClick={() => run(entry)}
                    >
                      {entry.tone === undefined ? (
                        <span className="flex shrink-0">{entry.icon}</span>
                      ) : (
                        <span className={cn('size-2 shrink-0 rounded-full', TONE[entry.tone])} />
                      )}
                      <span className="truncate">{entry.label}</span>
                      {entry.hint !== undefined && (
                        <span className="truncate text-xs text-muted-foreground">{entry.hint}</span>
                      )}
                      {entry.keys !== undefined && (
                        <span className="ml-auto shrink-0">
                          <Kbd keys={entry.keys} />
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}

          <div className={FOOT}>
            <span className="flex items-center gap-1">
              <Kbd keys="↑ ↓" /> move
            </span>
            <span className="flex items-center gap-1">
              <Kbd keys="Enter" /> run
            </span>
            <span className="flex items-center gap-1">
              <Kbd keys="Esc" /> close
            </span>
            {scope !== null && (
              <span className="ml-auto flex items-center gap-1">
                Scoped to {scope}; type <Kbd keys={EVERYWHERE_PREFIX} /> for every Project
              </span>
            )}
          </div>
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  )
}
