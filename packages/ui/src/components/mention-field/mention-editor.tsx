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

import { Popover } from '../popover/popover.tsx'
import {
  AREA,
  FieldBox,
  GLYPHS,
  KINDS,
  MentionBadge,
  type Mentionable,
  type MentionFieldProps,
  mentionsFor,
  shortName,
} from './mention-parts.tsx'

const EDITABLE = 'min-h-full outline-none whitespace-pre-wrap break-words'
const LIST = 'flex max-h-mention-list w-mention flex-col gap-0.5 overflow-y-auto'
const OPTION =
  'flex min-h-control-md min-w-0 items-center gap-2 rounded-md px-2 text-sm select-none hover-motion data-[active=true]:tinted'
const QUIET = 'min-w-0 truncate text-xs text-muted-foreground'

/**
 * The mention field's editor, on Tiptap, which owns the editing; `mention-field.tsx` says what
 * the field is and loads this file only once a page shows one.
 */

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

/** The field itself, on Tiptap: what `MentionField` loads once a page shows one. */
export function MentionEditor({
  label,
  placeholder,
  value,
  onValueChange,
  mentionables,
  onSubmit,
  working = false,
  onStop,
  leading,
  trailing,
  disabled = false,
  autoFocus = false,
}: MentionFieldProps): ReactNode {
  const id = useId()
  const empty = value.trim() === ''
  /** Sends what is written, when there is something and nothing is being worked on. */
  const submit =
    onSubmit === undefined
      ? undefined
      : () => {
          if (!empty && !working) onSubmit()
        }
  const [menu, setMenu] = useState<Menu | null>(null)
  const [active, setActive] = useState(0)
  /** What the editor reads at the moment it reads it: the props and state of the last render. */
  const latest = useRef({ mentionables, submit, onValueChange, menu, active })
  useLayoutEffect(() => {
    latest.current = { mentionables, submit, onValueChange, menu, active }
  })
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
        const { menu: open, submit: send } = latest.current
        if (open !== null || event.key !== 'Enter') return false
        if (event.shiftKey || send === undefined) return false
        event.preventDefault()
        send()
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
        <FieldBox
          disabled={disabled}
          empty={empty}
          submit={submit}
          working={working}
          onStop={onStop}
          leading={leading}
          trailing={trailing}
        >
          <EditorContent editor={editor} className={AREA} />
        </FieldBox>
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
