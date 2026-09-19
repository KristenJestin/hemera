import { cn } from 'cn'
import { type ReactNode, useState } from 'react'

import { Badge } from '../badge/badge.tsx'
import { Input, type InputProps } from '../field/field.tsx'
import { Popover } from '../popover/popover.tsx'

/**
 * A field that offers what is already there, and still accepts what is not (design D4-09).
 *
 * The one shape behind every "type it or pick it" of the application: a box, and under it a
 * list that narrows as it is typed into. What is chosen fills the box; what is typed stands on
 * its own — a path can be declared before anything is at it, and a list that refused to be
 * ignored would be a list that has decided what exists.
 *
 * The list does not take the focus. It opens under the caret and the keys are read by the box,
 * exactly as the composer's mention menu is, and for the same reason: a panel that stole the
 * caret would end the word it is helping to write.
 *
 * Nothing here reads a disk or a database. What is on offer is handed over, already found by
 * whoever can find it, and this decides only which of them match what has been typed.
 */
const PANEL = 'flex w-menu flex-col gap-0.5'

const ITEM = 'flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent'

const ITEM_ACTIVE = 'bg-accent text-accent-foreground'

const EMPTY = 'px-2 py-3 text-xs text-muted-foreground'

const PATH = 'min-w-0 flex-1 truncate font-mono'

/** One thing on offer: what it would put in the box, and what it is worth saying about it. */
export interface Suggestion {
  value: string
  /** A word beside it — a branch, a kind — or nothing. */
  hint?: string | undefined
}

export interface SuggestInputProps extends Omit<InputProps, 'action' | 'onBlur'> {
  /** Everything on offer, unfiltered: which of them match is decided here. */
  suggestions: readonly Suggestion[]
  /** Said instead of a list when nothing on offer matches. */
  emptyLabel?: string | undefined
  /** A control of the field, on the same line as its box. */
  action?: ReactNode
}

export function SuggestInput({
  suggestions,
  emptyLabel = 'Nothing there matches.',
  value = '',
  onValueChange,
  action,
  ...rest
}: SuggestInputProps): ReactNode {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)

  const asked = value.trim().toLowerCase()
  const matches = suggestions.filter(
    (one) => asked === '' || one.value.toLowerCase().includes(asked),
  )
  const shown = open && matches.length > 0

  const choose = (chosen: string) => {
    onValueChange?.(chosen)
    setOpen(false)
  }

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      side="bottom"
      align="start"
      keepFocus
      anchorOnly
      label="Folders of the Workspace"
      trigger={
        <span className="flex flex-1 flex-col">
          <Input
            {...rest}
            value={value}
            onValueChange={(next) => {
              onValueChange?.(next)
              setActive(0)
              setOpen(true)
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(event) => {
              if (!shown) return
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setActive((active + 1) % matches.length)
                return
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault()
                setActive((active - 1 + matches.length) % matches.length)
                return
              }
              if (event.key === 'Enter') {
                const one = matches[active]
                if (one !== undefined) {
                  event.preventDefault()
                  choose(one.value)
                }
                return
              }
              if (event.key === 'Escape') {
                event.preventDefault()
                setOpen(false)
              }
            }}
            action={action}
          />
        </span>
      }
    >
      <div className={PANEL}>
        {matches.length === 0 ? (
          <p className={EMPTY}>{emptyLabel}</p>
        ) : (
          <div
            role="listbox"
            aria-label="Folders of the Workspace"
            className="flex flex-col gap-0.5"
          >
            {matches.map((one, index) => (
              <button
                key={one.value}
                type="button"
                role="option"
                aria-selected={index === active}
                className={cn(ITEM, index === active && ITEM_ACTIVE)}
                onPointerEnter={() => setActive(index)}
                onClick={() => choose(one.value)}
              >
                <span className={PATH}>{one.value}</span>
                {one.hint !== undefined && <Badge tone="success">{one.hint}</Badge>}
              </button>
            ))}
          </div>
        )}
      </div>
    </Popover>
  )
}
