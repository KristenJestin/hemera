import { cn } from 'cn'
import type { ReactElement, ReactNode } from 'react'

import { Badge } from '../components/badge/badge.tsx'
import { Popover } from '../components/popover/popover.tsx'
import { IconAt, IconFileText } from '../icons.ts'

/**
 * The files of the Project, offered while `@` is being typed (design D4-07, D4-09).
 *
 * It is a popover anchored to the `@` control and it does not take the focus: what opened it is
 * a keystroke in the box beside it, and a menu that stole the caret would end the sentence it
 * was helping to write. The arrows and Enter are read by the box, which is why the list here
 * only says which entry they would land on.
 *
 * Paths are drawn in the mono face. The files are handed over already filtered and already
 * bounded — reading a folder is the main process's to do, and how far it reads is its rule,
 * not this component's.
 *
 * A path too long for the row is cut and nothing is offered to read the rest: the native
 * `title` that used to be here arrived a second late, in the desktop's own black box, in a
 * shape that belongs to no theme of ours. What the eye needs is already at the front of the
 * path, and what the hand needs is one more character typed.
 */
const PANEL = 'flex w-menu flex-col gap-1'

const HEAD = 'flex items-center gap-2 px-2 pb-1 text-xs text-muted-foreground'

const LIST = 'scroll-quiet flex max-h-64 flex-col gap-0.5 overflow-y-auto'

const ITEM =
  'flex items-center gap-2 rounded-md px-2 py-1.5 text-left font-mono text-xs hover:bg-accent'

/**
 * Where the keys are, which is the one entry Enter would take.
 *
 * The pointer moves it rather than lighting a second one: a list with a filled row under the
 * hand and another filled row somewhere else is a list saying two different things about what
 * Enter does.
 */
const ITEM_ACTIVE = 'bg-accent text-accent-foreground'

const EMPTY = 'px-2 py-3 text-xs text-muted-foreground'

export interface MentionMenuProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** What opens it: the composer's own `@` control. */
  trigger: ReactElement
  /** The paths on offer, relative to the folder of the Workspace, already filtered. */
  files: string[]
  /** Which one Enter would choose. */
  activeIndex: number
  /** Moved by the pointer as well as by the arrows, so the two never disagree. */
  onActiveIndexChange: (index: number) => void
  onChoose: (file: string) => void
  /** Said instead of a list when the folder holds more than the menu will read. */
  tooMany?: boolean | undefined
  /** What the band at the top says, since the same list is reached two ways. */
  hint?: string | undefined
}

export function MentionMenu({
  open,
  onOpenChange,
  trigger,
  files,
  activeIndex,
  onActiveIndexChange,
  onChoose,
  tooMany = false,
  hint = 'A file of the Project…',
}: MentionMenuProps): ReactNode {
  return (
    <Popover
      open={open}
      onOpenChange={onOpenChange}
      trigger={trigger}
      side="top"
      align="start"
      keepFocus
      label={hint}
    >
      <div className={PANEL}>
        <p className={HEAD}>
          <IconAt size="sm" />
          {hint}
        </p>
        {tooMany ? (
          <p className={EMPTY}>Too many files here; type more of the name.</p>
        ) : files.length === 0 ? (
          <p className={EMPTY}>No file of the Project matches.</p>
        ) : (
          <div className={LIST} role="listbox" aria-label="Files of the Project">
            {files.map((file, index) => (
              <button
                key={file}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                className={cn(ITEM, index === activeIndex && ITEM_ACTIVE)}
                onPointerEnter={() => onActiveIndexChange(index)}
                onClick={() => onChoose(file)}
              >
                <IconFileText size="sm" />
                <span className="min-w-0 flex-1 truncate">{file}</span>
                <Badge tone="neutral">file</Badge>
              </button>
            ))}
          </div>
        )}
      </div>
    </Popover>
  )
}
