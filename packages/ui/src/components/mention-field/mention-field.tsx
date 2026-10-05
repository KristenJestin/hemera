import type { JSONContent } from '@tiptap/core'
import { Document } from '@tiptap/extension-document'
import { Mention } from '@tiptap/extension-mention'
import { Paragraph } from '@tiptap/extension-paragraph'
import { Text } from '@tiptap/extension-text'
import { Placeholder } from '@tiptap/extensions'
import {
  EditorContent,
  type NodeViewProps,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  useEditor,
} from '@tiptap/react'
import { exitSuggestion, type SuggestionProps } from '@tiptap/suggestion'
import { cn } from 'cn'
import { type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'

import { IconFileText, IconListCheck, IconTerminal } from '../../icons.ts'
import { Popover } from '../popover/popover.tsx'
import { Tooltip } from '../tooltip/tooltip.tsx'
import { fuzzyScore } from './fuzzy.ts'

/**
 * The mention field: where a message is written — the Chat's composer, Discuss, an answer, a
 * Review remark, the first field of a mission. On Tiptap, which owns the editing; this file owns
 * what it looks like and what it offers.
 *
 * - It never changes height: its box is four lines, and a longer text scrolls inside it.
 * - `@` at the start of a word opens a menu at the caret: the files of the main checkout, the
 *   missions and the commands, the recent first; what follows the `@` searches them, fuzzily.
 *   Up and Down walk it, Enter or Tab write the mention, Escape puts the menu away. The caret
 *   never leaves the field.
 * - A mention is a badge: a file's name alone (its path in the tooltip), a mission's key, a
 *   command's name. Backspace takes it away whole. In the text the field hands back, it is
 *   `@` and the whole path.
 * - Without a menu, Enter sends when the field has somewhere to send to, and Shift+Enter starts
 *   a new line.
 * - A bar at the foot of the box holds what the caller sets there: the composer's model picker
 *   at its start, Send or Stop at its end.
 */

export type MentionKind = 'file' | 'mission' | 'command'

export interface Mentionable {
  kind: MentionKind
  id: string
  /** What the mention stands for: a path, a mission's key, a command's name. */
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
  /** The text, a mention written `@` and its label. */
  value: string
  onValueChange: (value: string) => void
  mentionables: readonly Mentionable[]
  /** What Enter does without a menu open; left out, Enter starts a new line. */
  onSubmit?: (() => void) | undefined
  /** What stands at the start of the box's foot: the composer's model picker. */
  leading?: ReactNode
  /** What stands at its end: Send, Stop. */
  trailing?: ReactNode
  disabled?: boolean | undefined
  /** Whether it takes the focus when it appears: a new Chat's composer. */
  autoFocus?: boolean | undefined
}

const BOX =
  'flex h-composer w-full min-w-0 flex-col rounded-lg border border-input bg-input-fill focus-within:border-ring has-data-disabled:opacity-50'
const AREA = 'min-h-0 w-full flex-1 overflow-y-auto px-3 pt-2.5 text-sm text-foreground'
const EDITABLE = 'min-h-full outline-none whitespace-pre-wrap break-words'
const FOOT = 'flex min-h-control-sm shrink-0 items-center gap-1 px-2 pb-2'
const LIST = 'flex max-h-mention-list w-mention flex-col gap-0.5 overflow-y-auto'
const OPTION =
  'flex min-h-control-md min-w-0 items-center gap-2 rounded-md px-2 text-sm select-none hover-motion data-[active=true]:tinted'
const QUIET = 'min-w-0 truncate text-xs text-muted-foreground'
const BADGE =
  'mx-0.5 inline-flex items-center gap-1 rounded-md bg-primary-muted px-1.5 align-baseline text-xs font-medium text-primary-muted-foreground outline-none'

/** How many entries the menu lists at most. */
const SHOWN = 50

const GLYPHS: Record<MentionKind, ReactNode> = {
  file: <IconFileText size="sm" />,
  mission: <IconListCheck size="sm" />,
  command: <IconTerminal size="sm" />,
}

const baseName = (path: string): string => path.slice(path.lastIndexOf('/') + 1)

/** What a badge shows: a file's name, anything else whole. */
const shortName = (kind: MentionKind, label: string): string =>
  kind === 'file' ? baseName(label) : label

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

const KINDS: readonly MentionKind[] = ['file', 'mission', 'command']

/** A mention as a badge: its glyph and its short name, its whole label in the tooltip. */
export function MentionBadge({ kind, label }: { kind: MentionKind; label: string }): ReactNode {
  return (
    <Tooltip label={label}>
      <button type="button" tabIndex={-1} aria-label={label} className={BADGE}>
        <span className="flex" aria-hidden="true">
          {GLYPHS[kind]}
        </span>
        {shortName(kind, label)}
      </button>
    </Tooltip>
  )
}

/** What a written `@label` most likely is, with nothing else to go on: a key, a path, a name. */
export function kindOf(label: string): MentionKind {
  if (/^[A-Z][A-Z0-9]*-\d+$/.test(label)) return 'mission'
  return label.includes('/') || label.includes('.') ? 'file' : 'command'
}

/** A mention in the field: its badge. */
function Badge({ node }: NodeViewProps): ReactNode {
  const kind = KINDS.find((one) => one === node.attrs['kind']) ?? 'file'
  return (
    <NodeViewWrapper as="span" className="inline">
      <MentionBadge kind={kind} label={String(node.attrs['label'] ?? '')} />
    </NodeViewWrapper>
  )
}

/** The text a document stands for: a mention as `@` and its label, a paragraph as a line. */
function textOf(document: JSONContent): string {
  return (document.content ?? [])
    .map((paragraph) =>
      (paragraph.content ?? [])
        .map((part) =>
          part.type === 'mention' ? `@${String(part.attrs?.['label'] ?? '')}` : (part.text ?? ''),
        )
        .join(''),
    )
    .join('\n')
}

/** The document a text stands for: an `@` followed by a known label is that mention's badge. */
function documentOf(text: string, mentionables: readonly Mentionable[]): JSONContent {
  const known = new Map(mentionables.map((item) => [item.label, item]))
  return {
    type: 'doc',
    content: text.split('\n').map((line) => {
      const parts = line
        .split(/(@\S+)/)
        .filter((part) => part !== '')
        .map((part): JSONContent => {
          const item = part.startsWith('@') ? known.get(part.slice(1)) : undefined
          return item === undefined
            ? { type: 'text', text: part }
            : { type: 'mention', attrs: { id: item.id, label: item.label, kind: item.kind } }
        })
      return parts.length === 0 ? { type: 'paragraph' } : { type: 'paragraph', content: parts }
    }),
  }
}

/** What the suggestion hands the menu while it is open. */
interface Menu {
  query: string
  items: readonly Mentionable[]
  pick: (item: Mentionable) => void
  /** What Tiptap draws around the `@` and its query: what the menu hangs off. */
  at: Element | null
}

export function MentionField({
  label,
  placeholder,
  value,
  onValueChange,
  mentionables,
  onSubmit,
  leading,
  trailing,
  disabled = false,
  autoFocus = false,
}: MentionFieldProps): ReactNode {
  const id = useId()
  const [menu, setMenu] = useState<Menu | null>(null)
  const [active, setActive] = useState(0)
  /** What the editor reads at the moment it reads it: the props and state of this render. */
  const latest = useRef({ mentionables, onSubmit, onValueChange, menu, active })
  latest.current = { mentionables, onSubmit, onValueChange, menu, active }
  /** The text this field last handed back, so a value it wrote is not written back into it. */
  const handed = useRef(value)

  const current = Math.min(active, Math.max(0, (menu?.items.length ?? 1) - 1))
  const optionId = (at: number) => `${id}-mention-${String(at)}`

  const editor = useEditor({
    immediatelyRender: true,
    editable: !disabled,
    autofocus: autoFocus ? 'end' : false,
    content: documentOf(value, mentionables),
    editorProps: {
      attributes: {
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': label,
        'aria-autocomplete': 'list',
        class: EDITABLE,
      },
      handleKeyDown: (_view, event) => {
        const { menu: open, onSubmit: submit } = latest.current
        if (open !== null || event.key !== 'Enter') return false
        if (event.shiftKey || submit === undefined) return false
        event.preventDefault()
        submit()
        return true
      },
    },
    extensions: [
      Document,
      Paragraph,
      Text,
      Placeholder.configure({ placeholder: placeholder ?? '' }),
      Mention.extend({
        addAttributes() {
          return {
            ...this.parent?.(),
            kind: { default: 'file' },
          }
        },
        addNodeView() {
          return ReactNodeViewRenderer(Badge, { as: 'span' })
        },
      }).configure({
        renderText: ({ node }) => `@${String(node.attrs['label'] ?? '')}`,
        suggestion: {
          char: '@',
          items: ({ query }) => [...mentionsFor(latest.current.mentionables, query)],
          command: ({ editor: on, range, props }) => {
            on.chain()
              .focus()
              .insertContentAt(range, [
                { type: 'mention', attrs: props },
                { type: 'text', text: ' ' },
              ])
              .run()
          },
          render: () => {
            const show = (props: SuggestionProps<Mentionable>) => {
              setMenu({
                query: props.query,
                items: props.items,
                pick: (item) => props.command({ id: item.id, label: item.label, kind: item.kind }),
                at: props.decorationNode,
              })
            }
            return {
              onStart: (props) => {
                setActive(0)
                show(props)
              },
              onUpdate: (props) => {
                setActive(0)
                show(props)
              },
              onExit: () => setMenu(null),
              onKeyDown: ({ event, view }) => {
                const { menu: open, active: at } = latest.current
                if (open === null) return false
                const last = Math.max(0, open.items.length - 1)
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  const delta = event.key === 'ArrowDown' ? 1 : -1
                  setActive(Math.min(Math.max(Math.min(at, last) + delta, 0), last))
                  return true
                }
                if (event.key === 'Enter' || event.key === 'Tab') {
                  const item = open.items[Math.min(at, last)]
                  if (item === undefined) return false
                  open.pick(item)
                  return true
                }
                if (event.key === 'Escape') {
                  exitSuggestion(view)
                  setMenu(null)
                  return true
                }
                return false
              },
            }
          },
        },
      }),
    ],
    onUpdate: ({ editor: on }) => {
      const text = textOf(on.getJSON())
      handed.current = text
      latest.current.onValueChange(text)
    },
  })

  // A value set from outside — the composer emptied once a message is sent — is drawn anew.
  useEffect(() => {
    if (value === handed.current) return
    handed.current = value
    editor.commands.setContent(documentOf(value, mentionables), { emitUpdate: false })
  }, [editor, value, mentionables])

  useEffect(() => {
    editor.setEditable(!disabled)
  }, [editor, disabled])

  // The entry walked to is kept in sight in a list that scrolls.
  useLayoutEffect(() => {
    if (menu === null) return
    document.getElementById(optionId(current))?.scrollIntoView({ block: 'nearest' })
  }, [menu, current])

  const open = menu !== null

  return (
    <Popover
      label="Mentions"
      anchorOnly
      keepFocus
      side="top"
      align="start"
      at={menu?.at ?? undefined}
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          exitSuggestion(editor.view)
          setMenu(null)
        }
      }}
      className="w-full"
      trigger={
        <div className={BOX} data-disabled={disabled ? '' : undefined}>
          <EditorContent editor={editor} className={AREA} />
          {(leading !== undefined || trailing !== undefined) && (
            <div className={FOOT}>
              {leading}
              <span className="ml-auto flex items-center gap-1">{trailing}</span>
            </div>
          )}
        </div>
      }
    >
      {menu === null || menu.items.length === 0 ? (
        <p id={`${id}-mentions`} className="w-mention px-2 py-1.5 text-sm text-muted-foreground">
          Nothing matches “{menu?.query}”
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
          {menu.items.map((item, at) => (
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
              onClick={() => menu.pick(item)}
            >
              <span className="flex shrink-0 text-muted-foreground" aria-hidden="true">
                {GLYPHS[item.kind]}
              </span>
              <span className={cn('shrink-0', item.kind === 'command' && 'font-mono text-xs')}>
                {shortName(item.kind, item.label)}
              </span>
              {item.kind === 'file'
                ? item.label.includes('/') && (
                    <span className={QUIET}>
                      {item.label.slice(0, item.label.lastIndexOf('/'))}
                    </span>
                  )
                : item.detail !== undefined && <span className={QUIET}>{item.detail}</span>}
            </div>
          ))}
        </div>
      )}
    </Popover>
  )
}
