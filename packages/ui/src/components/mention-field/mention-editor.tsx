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

import { Skeleton } from '../loading/loading.tsx'
import { Popover } from '../popover/popover.tsx'
import {
  AREA,
  FieldBox,
  GLYPHS,
  KINDS,
  MentionBadge,
  type Mentionable,
  type MentionFieldProps,
  type MentionRef,
  mentionsFor,
  shortName,
} from './mention-parts.tsx'

const EDITABLE = 'min-h-full outline-none whitespace-pre-wrap break-words'
const LIST = 'flex max-h-mention-list w-mention flex-col gap-0.5 overflow-y-auto'
const OPTION =
  'flex min-h-control-md min-w-0 items-center gap-2 rounded-md px-2 text-sm select-none hover-motion data-[active=true]:tinted'
const QUIET = 'min-w-0 truncate text-xs text-muted-foreground'
/** The names the rows of a menu still searching are drawn at: a file's name, short and long. */
const LOADING_ROWS = ['server.ts', 'invoices-list.tsx', 'ACME-12']

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

/** The mentions a document holds, in their order. */
function mentionsOf(document: JSONContent): MentionRef[] {
  return (document.content ?? []).flatMap((paragraph) =>
    (paragraph.content ?? [])
      .filter((part) => part.type === 'mention')
      .map((part) => ({
        kind: KINDS.find((one) => one === part.attrs?.['kind']) ?? 'file',
        id: String(part.attrs?.['id'] ?? ''),
        label: String(part.attrs?.['label'] ?? ''),
      })),
  )
}

/** What the sources and a search found, each once: what a search found wins. */
function merged(
  mentionables: readonly Mentionable[],
  found: readonly Mentionable[],
): readonly Mentionable[] {
  const keyOf = (item: Mentionable) => `${item.kind}:${item.id}`
  const fresh = new Set(found.map(keyOf))
  return [...mentionables.filter((item) => !fresh.has(keyOf(item))), ...found]
}

/** The document a text stands for: an `@` followed by a known label is that mention's badge. */
function documentOf(text: string, mentionables: readonly MentionRef[]): JSONContent {
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

const NONE: readonly MentionRef[] = []

/** What the suggestion hands the menu while it is open. */
interface Menu {
  query: string
  items: readonly Mentionable[]
  /** Whether a search is still answering. */
  loading: boolean
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
  mentions = NONE,
  mentionables,
  search,
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
  /** Why the last search failed, in its own words; null when it did not. */
  const [failure, setFailure] = useState<string | null>(null)
  /** What the editor reads at the moment it reads it: the props and state of the last render. */
  const latest = useRef({ mentionables, search, submit, onValueChange, menu, active })
  useLayoutEffect(() => {
    latest.current = { mentionables, search, submit, onValueChange, menu, active }
  })
  /** What a search found and was mentioned, so a value set again draws it as its badge. */
  const found = useRef<readonly MentionRef[]>([])
  /** The text this field last handed back, so a value it wrote is not written back into it. */
  const handed = useRef(value)

  const current = Math.min(active, Math.max(0, (menu?.items.length ?? 1) - 1))
  const optionId = (at: number) => `${id}-mention-${String(at)}`

  const editor = useEditor({
    immediatelyRender: true,
    editable: !disabled,
    autofocus: autoFocus ? 'end' : false,
    content: documentOf(value, [...mentionables, ...mentions]),
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
        // A mention goes whole: Backspace leaves no `@` behind to open the menu again.
        deleteTriggerWithBackspace: true,
        renderText: ({ node }) => `@${String(node.attrs['label'] ?? '')}`,
        suggestion: {
          char: '@',
          items: async ({ query, signal }) => {
            const { mentionables: listed, search: asking } = latest.current
            if (asking === undefined) return [...mentionsFor(listed, query)]
            try {
              const answered = await asking(query, signal)
              setFailure(null)
              return [...mentionsFor(merged(listed, answered), query)]
            } catch (error) {
              if (signal.aborted) throw error
              setFailure(error instanceof Error ? error.message : 'The search failed.')
              return [...mentionsFor(listed, query)]
            }
          },
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
              setMenu((before) => ({
                query: props.query,
                // While a search answers, what the last one found stays rather than flickering.
                items: props.loading && before !== null ? before.items : props.items,
                loading: props.loading,
                pick: (item) => {
                  found.current = [...found.current, item]
                  props.command({ id: item.id, label: item.label, kind: item.kind })
                },
                at: props.decorationNode,
              }))
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
      const document = on.getJSON()
      const text = textOf(document)
      handed.current = text
      latest.current.onValueChange(text, mentionsOf(document))
    },
  })

  // A value set from outside — the composer emptied once a message is sent — is drawn anew.
  useEffect(() => {
    if (value === handed.current) return
    handed.current = value
    editor.commands.setContent(
      documentOf(value, [...mentionables, ...mentions, ...found.current]),
      { emitUpdate: false },
    )
  }, [editor, value, mentionables, mentions])

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
      <MentionMenu
        id={`${id}-mentions`}
        menu={menu}
        failure={failure}
        searching={search !== undefined}
        current={current}
        optionId={optionId}
        onActive={setActive}
      />
    </Popover>
  )
}

/**
 * The menu under the `@`: rows of a mention's shape while a search first answers, what it found,
 * or that nothing matches; a search that failed says why, above.
 */
function MentionMenu({
  id,
  menu,
  failure,
  searching,
  current,
  optionId,
  onActive,
}: {
  id: string
  menu: Menu | null
  failure: string | null
  /** Whether a source is searched as one types. */
  searching: boolean
  current: number
  optionId: (at: number) => string
  onActive: (at: number) => void
}): ReactNode {
  return (
    <>
      {failure !== null && (
        <p className="w-mention px-2 py-1.5 text-sm text-muted-foreground">{failure}</p>
      )}
      {searching && menu?.loading === true && menu.items.length === 0 ? (
        <div id={id} role="listbox" aria-label="Mentions" aria-busy="true" className={LIST}>
          {LOADING_ROWS.map((name) => (
            <div key={name} className={OPTION} aria-hidden="true">
              <Skeleton>{name}</Skeleton>
            </div>
          ))}
        </div>
      ) : menu === null || menu.items.length === 0 ? (
        failure === null && (
          <p id={id} className="w-mention px-2 py-1.5 text-sm text-muted-foreground">
            Nothing matches “{menu?.query}”
          </p>
        )
      ) : (
        <div
          id={id}
          role="listbox"
          aria-label="Mentions"
          aria-busy={searching && menu.loading ? 'true' : undefined}
          // Walked from the field; a list that scrolls is also one the keyboard can scroll.
          tabIndex={0}
          className={LIST}
        >
          {menu.items.map((item, at) => (
            <div
              key={`${item.kind}:${item.id}`}
              id={optionId(at)}
              role="option"
              aria-selected={at === current}
              data-active={at === current}
              className={OPTION}
              onPointerMove={() => onActive(at)}
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
    </>
  )
}
