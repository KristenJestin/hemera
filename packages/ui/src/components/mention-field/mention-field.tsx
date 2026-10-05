import { cn } from 'cn'
import {
  type KeyboardEvent,
  type ReactNode,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import { IconFileText, IconListCheck, IconTerminal } from '../../icons.ts'
import { Popover } from '../popover/popover.tsx'
import { caretAnchor } from './caret.ts'
import { fuzzyScore } from './fuzzy.ts'

/**
 * The mention field: where a message is written — the Chat's composer, Discuss, an answer, a
 * Review remark, the first field of a mission.
 *
 * - It never changes height: its box is four lines, and a longer text scrolls inside it.
 * - `@` at the start of a word opens a menu hung at that `@`, and it stays there while the rest
 *   is typed. It lists the files of the main checkout, the missions and the commands, the recent
 *   ones first; what follows the `@` searches them, fuzzily.
 * - Up and Down walk the menu, Enter or Tab put the mention in the text, Escape puts the menu
 *   away. The caret never leaves the field: the menu is a list beside what is typed, not a place
 *   to go.
 * - Without a menu, Enter sends when the field has somewhere to send to, and Shift+Enter starts
 *   a new line.
 */

export type MentionKind = 'file' | 'mission' | 'command'

export interface Mentionable {
  kind: MentionKind
  id: string
  /** What the mention writes after its `@`: a path, a mission's key, a command's name. */
  label: string
  /** What it is, in a quiet line: a mission's title, a command's line. */
  detail?: string | undefined
  /** Its rank among the recent ones, 1 the latest; left out when it is not recent. */
  recent?: number | undefined
}

export interface MentionFieldProps {
  /** What the field is called. */
  label: string
  placeholder?: string | undefined
  value: string
  onValueChange: (value: string) => void
  mentionables: readonly Mentionable[]
  /** What Enter does without a menu open; left out, Enter starts a new line. */
  onSubmit?: (() => void) | undefined
  /** What sits inside the box, at its bottom end: the send button. */
  trailing?: ReactNode
  disabled?: boolean | undefined
}

const BOX =
  'flex h-composer w-full min-w-0 flex-col rounded-lg border border-input bg-input-fill focus-within:border-ring has-disabled:opacity-50'
const AREA =
  'min-h-0 w-full flex-1 resize-none overflow-y-auto bg-transparent px-3 pt-2.5 text-sm text-foreground outline-none placeholder:text-muted-foreground'
const LIST = 'flex max-h-mention-list w-mention flex-col gap-0.5 overflow-y-auto'
const OPTION =
  'flex min-h-control-md min-w-0 items-center gap-2 rounded-md px-2 text-sm select-none hover-motion data-[active=true]:tinted'
const QUIET = 'min-w-0 truncate text-xs text-muted-foreground'

/** How many entries the menu lists at most. */
const SHOWN = 50

const GLYPHS: Record<MentionKind, ReactNode> = {
  file: <IconFileText size="sm" />,
  mission: <IconListCheck size="sm" />,
  command: <IconTerminal size="sm" />,
}

/** The `@` being typed before the caret, and what follows it. */
function typing(text: string, caret: number): { start: number; query: string } | null {
  const found = /(?:^|\s)@([^\s@]*)$/.exec(text.slice(0, caret))
  if (found === null) return null
  const query = found[1] ?? ''
  return { start: caret - query.length - 1, query }
}

const baseName = (path: string): string => path.slice(path.lastIndexOf('/') + 1)

/** A search in a path counts most in its file name, then in the path, then in the detail. */
function scoreOf(item: Mentionable, query: string): number | null {
  const whole = fuzzyScore(item.label, query)
  const name = item.kind === 'file' ? fuzzyScore(baseName(item.label), query) : null
  const detail = item.detail === undefined ? null : fuzzyScore(item.detail, query)
  const found = [
    whole,
    name === null ? null : name + 5,
    detail === null ? null : detail - 5,
  ].filter((score) => score !== null)
  return found.length === 0 ? null : Math.max(...found)
}

const recency = (item: Mentionable): number => item.recent ?? Number.POSITIVE_INFINITY

export function mentionsFor(
  mentionables: readonly Mentionable[],
  query: string,
): readonly Mentionable[] {
  if (query === '') {
    return mentionables.toSorted((a, b) => recency(a) - recency(b)).slice(0, SHOWN)
  }
  return mentionables
    .map((item) => ({ item, score: scoreOf(item, query) }))
    .filter((one): one is { item: Mentionable; score: number } => one.score !== null)
    .toSorted(
      (a, b) =>
        b.score - a.score ||
        recency(a.item) - recency(b.item) ||
        a.item.label.length - b.item.label.length,
    )
    .map((one) => one.item)
    .slice(0, SHOWN)
}

function Entry({ item }: { item: Mentionable }): ReactNode {
  if (item.kind === 'file') {
    const slash = item.label.lastIndexOf('/')
    return (
      <>
        <span className="shrink-0">{baseName(item.label)}</span>
        {slash > 0 && <span className={QUIET}>{item.label.slice(0, slash)}</span>}
      </>
    )
  }
  return (
    <>
      <span className={cn('shrink-0', item.kind === 'command' && 'font-mono text-xs')}>
        {item.label}
      </span>
      {item.detail !== undefined && <span className={QUIET}>{item.detail}</span>}
    </>
  )
}

export function MentionField({
  label,
  placeholder,
  value,
  onValueChange,
  mentionables,
  onSubmit,
  trailing,
  disabled,
}: MentionFieldProps): ReactNode {
  const id = useId()
  const area = useRef<HTMLTextAreaElement>(null)
  const [caret, setCaret] = useState(value.length)
  const [active, setActive] = useState(0)
  /** The `@` whose menu was put away with Escape: it stays away until another one is typed. */
  const [dismissed, setDismissed] = useState<number | null>(null)
  /** Where the caret goes once a mention is written. */
  const placeCaret = useRef<number | null>(null)

  const mention = typing(value, caret)
  const open = mention !== null && mention.start !== dismissed && disabled !== true
  const found = useMemo(
    () => (mention === null ? [] : mentionsFor(mentionables, mention.query)),
    [mentionables, mention?.query],
  )
  const current = Math.min(active, Math.max(0, found.length - 1))
  const optionId = (at: number) => `${id}-mention-${String(at)}`

  // The entry walked to is kept in sight in a list that scrolls.
  useLayoutEffect(() => {
    if (!open) return
    document.getElementById(optionId(current))?.scrollIntoView({ block: 'nearest' })
  }, [open, current])

  useLayoutEffect(() => {
    if (placeCaret.current === null || area.current === null) return
    area.current.setSelectionRange(placeCaret.current, placeCaret.current)
    placeCaret.current = null
  })

  const follow = (node: HTMLTextAreaElement) => {
    setCaret(node.selectionStart)
  }

  const write = (item: Mentionable | undefined) => {
    if (item === undefined || mention === null) return
    const before = value.slice(0, mention.start)
    const written = `@${item.label} `
    placeCaret.current = before.length + written.length
    setCaret(placeCaret.current)
    setActive(0)
    onValueChange(before + written + value.slice(caret))
  }

  const key = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (open) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        const delta = event.key === 'ArrowDown' ? 1 : -1
        setActive(Math.min(Math.max(current + delta, 0), Math.max(0, found.length - 1)))
        return
      }
      if ((event.key === 'Enter' || event.key === 'Tab') && found.length > 0) {
        event.preventDefault()
        write(found[current])
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        setDismissed(mention.start)
        return
      }
    }
    if (event.key === 'Enter' && !event.shiftKey && onSubmit !== undefined) {
      event.preventDefault()
      onSubmit()
    }
  }

  const anchor = useMemo(() => caretAnchor(area, mention?.start ?? null), [mention?.start])

  return (
    <Popover
      label="Mentions"
      anchorOnly
      keepFocus
      side="top"
      align="start"
      at={anchor}
      open={open}
      onOpenChange={(next) => {
        if (!next && mention !== null) setDismissed(mention.start)
      }}
      className="w-full"
      trigger={
        <div className={BOX}>
          <textarea
            ref={area}
            aria-label={label}
            aria-controls={open ? `${id}-mentions` : undefined}
            aria-autocomplete="list"
            aria-activedescendant={open && found.length > 0 ? optionId(current) : undefined}
            placeholder={placeholder}
            disabled={disabled}
            className={AREA}
            value={value}
            onChange={(event) => {
              follow(event.target)
              setActive(0)
              onValueChange(event.target.value)
            }}
            onSelect={(event) => follow(event.currentTarget)}
            onKeyDown={key}
          />
          {trailing !== undefined && (
            <div className="flex shrink-0 items-center justify-end gap-1 px-2 pb-2">{trailing}</div>
          )}
        </div>
      }
    >
      {found.length === 0 ? (
        <p id={`${id}-mentions`} className="w-mention px-2 py-1.5 text-sm text-muted-foreground">
          Nothing matches “{mention?.query}”
        </p>
      ) : (
        <div
          id={`${id}-mentions`}
          role="listbox"
          aria-label="Mentions"
          // Walked from the field; a list that scrolls is also one the keyboard can scroll.
          tabIndex={0}
          className={LIST}
        >
          {found.map((item, at) => (
            <div
              key={item.id}
              id={optionId(at)}
              role="option"
              aria-selected={at === current}
              data-active={at === current}
              className={OPTION}
              onPointerMove={() => setActive(at)}
              // The caret stays in the field: a press on the menu never takes the focus.
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => write(item)}
            >
              <span className="flex shrink-0 text-muted-foreground" aria-hidden="true">
                {GLYPHS[item.kind]}
              </span>
              <Entry item={item} />
            </div>
          ))}
        </div>
      )}
    </Popover>
  )
}
