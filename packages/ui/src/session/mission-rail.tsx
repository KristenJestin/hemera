import { cn } from 'cn'
import {
  type FunctionComponent,
  type KeyboardEvent,
  type ReactNode,
  useId,
  useRef,
  useState,
} from 'react'

import { Tooltip } from '../components/tooltip/tooltip.tsx'
import type { IconProps } from '../icons.ts'

/**
 * The rail of a mission panel: what the mission is made of, one quiet row each, grouped under
 * headers, and at its foot whatever the mission says of the whole (lot 19; the Spec's rail is
 * the first to use it, a `build` rail of tasks and workers the next).
 *
 * The rail knows nothing of a Spec. It is handed groups of items, each with its glyph, its name,
 * a count, and the one thing that needs attention about it, if anything does; and it draws them
 * the way the maintainer decided for the Spec (lot 19, the rail's states): a row says only what
 * needs attention, and says it with the row itself. An item with nothing to say carries nothing.
 * An empty one has its name in a fainter text. The one the agent is working on is tinted in the
 * primary, the tint breathing; one to review is tinted in the warning colour, one in conflict in
 * the destructive one. One edited by the reader wears an edge of the info colour on its left,
 * which goes with a tint rather than replacing it. Each says its state in a sentence, in its
 * tooltip and as its accessible description.
 *
 * What is on the stage says so with a thin rule of the one accent and nothing else. A group opens
 * on its header, which reads as the header of a section and not as one more row: its name in the
 * small type of a label, a hairline above every group but the first, the rows set in under it. It
 * wears no state of its own but the warning tint when the group as a whole is to review. Pressed,
 * it puts the whole group on the stage, and the rule runs on the header and on every row under
 * it. `Show all` shows at its end under the hand and the keyboard, and only then.
 *
 * One stop of the tab order, and the arrows walk it: up and down, Home and End, Enter opens.
 *
 * Folded, the rail is the band the panel folds to beside the chat, and it keeps the hierarchy:
 * each group a block, its glyph in a tinted square, the smaller glyphs of its items right under
 * it and set in, and a gap and a hairline before the next group. The tints of the rows land on
 * the squares of the items; the names leave the eye and stay the accessible name and the
 * tooltip, beside the state.
 */

/** What needs attention about an item, which the row says with a tint, an edge or a fainter name. */
export type RailAttention = 'writing' | 'review' | 'conflict' | 'edited' | 'empty' | 'none'

/** A glyph of the catalogue, at the rail's size. */
export type RailIcon = FunctionComponent<IconProps>

/** One row of the rail. */
export interface MissionRailItem {
  /** What the row leads to, unique in the rail. */
  id: string
  icon: RailIcon
  label: string
  count?: number | undefined
  attention: RailAttention
  /**
   * An edit of the reader's the agent has not read yet, when the item also needs another kind of
   * attention: the edge goes with the tint. `edited` as the attention says it alone.
   */
  edited?: boolean | undefined
  /** The state in a sentence, for the tooltip and the accessible description. */
  description?: string | undefined
}

/** A group of rows under its header. */
export interface MissionRailGroup {
  /** What the header puts on the stage, unique among the groups. */
  id: string
  icon: RailIcon
  label: string
  /** The header's accessible name, when it says more than its label. */
  name?: string | undefined
  /** What the header's tooltip says: its label and what pressing it does. */
  tooltip?: string | undefined
  /** `review` when the group as a whole is to review, which its header then says too. */
  attention?: 'review' | 'none' | undefined
  /** The header's state in a sentence, as its accessible description. */
  description?: string | undefined
  items: MissionRailItem[]
}

/** What the stage shows: one item, or every item of one group. */
export type RailChoice = { item: string } | { group: string }

/**
 * The tint behind a row that needs attention: a layer under its content, so that the one being
 * written breathes without its text breathing with it. A soft step of the colour, light enough
 * that the text on it keeps its contrast in both themes.
 */
const TINT = 'pointer-events-none absolute inset-0 -z-10 rounded-sm'

const TINT_FOLDED = 'pointer-events-none absolute inset-0 -z-10 rounded-md'

const TINTS: Partial<Record<RailAttention, string>> = {
  writing: 'bg-primary/10 motion-safe:animate-breathe',
  review: 'bg-warning/15',
  conflict: 'bg-destructive/15',
}

/** The edge of an item the reader edited, which the agent reads next: beside a tint, not instead. */
const EDITED = 'rounded-l-none border-l-2 border-info'

/**
 * The name of an empty item, fainter than the others: as faint as small text goes on the panel
 * and still reads. A step further and the light theme falls under the contrast it needs.
 */
const EMPTY = 'text-muted-foreground/90'

/** A glyph of the rail, named by `data-icon` so a play can tell one from another. */
function Glyph({ icon: Icon, size = 'sm' }: { icon: RailIcon; size?: 'sm' | 'md' }): ReactNode {
  return (
    <span aria-hidden="true" data-icon={Icon.displayName} className="flex shrink-0">
      <Icon size={size} />
    </span>
  )
}

/** The tint layer of a row or a header, when its attention has one. */
function Tint({ attention, folded }: { attention: RailAttention; folded: boolean }): ReactNode {
  const tint = TINTS[attention]
  if (tint === undefined) return null
  return (
    <span
      aria-hidden="true"
      data-tint={attention}
      className={cn(folded ? TINT_FOLDED : TINT, tint)}
    />
  )
}

const RAIL = 'flex w-rail shrink-0 flex-col border-r border-border'

const RAIL_FOLDED = 'flex min-h-0 flex-1 flex-col'

const LIST = 'flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-2 py-3'

/** A group unfolded: a hairline above it but the first, more room above its header than under. */
const GROUP = 'flex flex-col gap-0.5 border-t border-border pt-3 first:border-t-0 first:pt-0'

/** The rows of a group, set in under its header. */
const ROWS = 'flex flex-col pl-3'

const LIST_FOLDED = 'flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-1 py-2'

/** A group folded: a block, a hairline and a gap above it but the first. */
const GROUP_FOLDED =
  'flex flex-col items-start gap-0.5 border-t border-border pt-3 first:border-t-0 first:pt-0'

/** The items of a group folded: stacked tight, and set in under the group's square. */
const ROWS_FOLDED = 'flex flex-col gap-0.5 pl-2'

/**
 * A row: its glyph and its words, and no surface but the tint of what needs attention. The row
 * on the stage is the foreground text and a 2-pixel rule of the accent on its left; every other
 * row is the muted text, brightening under the hand. Folded, the glyph stands alone in a small
 * square, which is what the tint fills.
 */
const ROW =
  'relative isolate flex h-control-sm w-full items-center gap-2 rounded-sm px-2 text-left text-sm outline-none focus-ring hover:text-foreground'

const ROW_FOLDED =
  'relative isolate flex size-6 items-center justify-center rounded-md outline-none focus-ring hover:text-foreground'

/**
 * A group's header: its glyph and name in the small type of a label — smaller, heavier, a little
 * spaced, and muted even on the stage, where only the rule says so — and never cut.
 */
const HEADING =
  'group/head relative isolate flex h-6 w-full items-center gap-1.5 rounded-sm px-2 text-left text-xs font-medium tracking-wide whitespace-nowrap text-muted-foreground outline-none focus-ring'

/** A group folded: its glyph in a tinted square, a step larger than the glyphs of its items. */
const HEADING_FOLDED =
  'relative isolate flex size-control-sm items-center justify-center rounded-md bg-muted-foreground/15 text-muted-foreground outline-none focus-ring hover:text-foreground'

/** The same square when the group is to review: the warning tint instead. */
const HEADING_FOLDED_REVIEW =
  'relative isolate flex size-control-sm items-center justify-center rounded-md text-muted-foreground outline-none focus-ring hover:text-foreground'

const ROW_OFF = 'text-muted-foreground'

const ROW_CURRENT = 'text-foreground'

/** The rule of what is on the stage: a row, a header, or every row of a group on the stage. */
const RULE =
  'before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-full before:bg-primary'

/** The same rule on a header, whose line is shorter. */
const HEADING_RULE =
  'before:absolute before:inset-y-1 before:left-0 before:w-0.5 before:rounded-full before:bg-primary'

/** Folded, the rule stands in the room left of the square rather than over its edge. */
const RULE_FOLDED =
  'before:absolute before:inset-y-1 before:-left-1 before:w-0.5 before:rounded-full before:bg-primary'

const HEADING_LABEL = 'flex-1'

/**
 * What pressing a header does, at its end: hidden until the hand or the keyboard is on it. The
 * hand is followed in state rather than by `:hover`, so that a play can drive it.
 */
const HINT = 'font-normal tracking-normal opacity-0 group-focus/head:opacity-100'

const HINT_SHOWN = 'font-normal tracking-normal opacity-100'

const LABEL = 'min-w-0 flex-1 truncate'

const COUNT = 'text-xs text-muted-foreground tabular-nums'

export interface MissionRailProps {
  /** What the rail is called: `Parts of ATL-7`. */
  label: string
  groups: MissionRailGroup[]
  /** What is on the stage: an item, or a group. */
  current: RailChoice
  /** Puts an item on the stage. */
  onSelect: (item: string) => void
  /** Puts every item of a group on the stage. */
  onSelectGroup: (group: string) => void
  /** What stands at the rail's foot, unfolded. */
  foot?: ReactNode
  /** What stands at the band's foot, folded. */
  foldedFoot?: ReactNode
  /** The band of glyphs the panel folds to, rather than the rail of words. */
  folded?: boolean | undefined
}

export function MissionRail({
  label,
  groups,
  current,
  onSelect,
  onSelectGroup,
  foot,
  foldedFoot,
  folded = false,
}: MissionRailProps): ReactNode {
  const list = useRef<HTMLDivElement>(null)
  const said = useId()
  // The header under the hand, whose hint shows.
  const [pointed, setPointed] = useState<string | null>(null)
  // The band stands at the window's right edge: what names a glyph opens away from it.
  const side = folded ? 'left' : 'right'

  /** Moves the keyboard to another row, without opening it: Enter does that. */
  function walk(event: KeyboardEvent<HTMLDivElement>): void {
    const buttons = [...(list.current?.querySelectorAll<HTMLButtonElement>('[data-row]') ?? [])]
    const at = buttons.findIndex((button) => button === document.activeElement)
    if (at === -1) return
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
    <nav aria-label={label} className={folded ? RAIL_FOLDED : RAIL}>
      <div ref={list} className={folded ? LIST_FOLDED : LIST} onKeyDown={walk}>
        {groups.map((group) => {
          const whole = 'group' in current && current.group === group.id
          const review = group.attention === 'review'
          const headingSaid = `${said}-group-${group.id}`
          return (
            <div
              key={group.id}
              role="group"
              aria-label={group.label}
              className={folded ? GROUP_FOLDED : GROUP}
            >
              <Tooltip label={group.tooltip ?? group.label} side={side}>
                <button
                  type="button"
                  data-row
                  data-heading
                  // One stop of the tab order: what is on the stage. The arrows do the rest.
                  tabIndex={whole ? 0 : -1}
                  aria-current={whole ? 'true' : undefined}
                  aria-label={group.name ?? group.label}
                  aria-describedby={group.description === undefined ? undefined : headingSaid}
                  className={cn(
                    folded ? (review ? HEADING_FOLDED_REVIEW : HEADING_FOLDED) : HEADING,
                    whole && (folded ? RULE_FOLDED : HEADING_RULE),
                  )}
                  onClick={() => onSelectGroup(group.id)}
                  onPointerEnter={() => setPointed(group.id)}
                  onPointerLeave={() => setPointed(null)}
                >
                  {review && <Tint attention="review" folded={folded} />}
                  <Glyph icon={group.icon} size={folded ? 'md' : 'sm'} />
                  {!folded && (
                    <>
                      <span className={HEADING_LABEL}>{group.label}</span>
                      <span
                        aria-hidden="true"
                        data-hint
                        className={pointed === group.id ? HINT_SHOWN : HINT}
                      >
                        Show all
                      </span>
                    </>
                  )}
                </button>
              </Tooltip>
              {group.description !== undefined && (
                <span id={headingSaid} hidden>
                  {group.description}
                </span>
              )}
              <ul className={folded ? ROWS_FOLDED : ROWS}>
                {group.items.map((item) => {
                  const on = 'item' in current && current.item === item.id
                  const rowSaid = `${said}-item-${item.id}`
                  const name =
                    item.count === undefined ? item.label : `${item.label}, ${item.count}`
                  const tip =
                    item.description === undefined
                      ? item.label
                      : folded
                        ? `${item.label} · ${item.description}`
                        : item.description
                  return (
                    <li key={item.id} className="flex">
                      <Tooltip label={tip} side={side}>
                        <button
                          type="button"
                          data-row
                          data-attention={item.attention}
                          tabIndex={on ? 0 : -1}
                          aria-current={on ? 'true' : undefined}
                          aria-label={name}
                          aria-describedby={item.description === undefined ? undefined : rowSaid}
                          className={cn(
                            folded ? ROW_FOLDED : ROW,
                            on ? ROW_CURRENT : item.attention === 'empty' ? EMPTY : ROW_OFF,
                            (on || whole) && (folded ? RULE_FOLDED : RULE),
                            (item.attention === 'edited' || item.edited === true) && EDITED,
                          )}
                          onClick={() => onSelect(item.id)}
                        >
                          <Tint attention={item.attention} folded={folded} />
                          <Glyph icon={item.icon} />
                          {!folded && (
                            <>
                              <span className={LABEL}>{item.label}</span>
                              {item.count !== undefined && (
                                <span className={COUNT}>{item.count}</span>
                              )}
                            </>
                          )}
                        </button>
                      </Tooltip>
                      {item.description !== undefined && (
                        <span id={rowSaid} hidden>
                          {item.description}
                        </span>
                      )}
                    </li>
                  )
                })}
              </ul>
            </div>
          )
        })}
      </div>
      {folded ? foldedFoot : foot}
    </nav>
  )
}
