import { type ReactNode, type RefObject, useEffect, useRef } from 'react'

import { IconAt, IconFileText } from '../icons.ts'

/**
 * The box a message is written in, and the files named inside it (design D4-07).
 *
 * Not a `<textarea>`. A textarea holds characters and nothing else, and a file named in a
 * sentence has to be visible as a file — a path typed out in the middle of a paragraph is
 * something the eye has to parse, where a chip is something it recognises. So the box is an
 * editable element and a mention is a real node inside it: not editable itself, removed whole
 * by one press of Backspace, and carried along as the sentence is rewritten around it.
 *
 * The element owns what is in it; React writes to it only when the value it is handed differs
 * from what is already there — a page clearing the box after a send, never a keystroke. That is
 * the whole reason the caret is never thrown to the end mid-sentence: nothing re-renders under
 * it while it is being typed into.
 *
 * What the caller sees is still a string, because that is what a message is: a mention
 * serialises as `@` and its path, exactly as if it had been typed. The chip is how it is drawn,
 * not what it is.
 */
const BOX =
  'composer-box field-sizing-content max-h-40 min-h-12 w-full whitespace-pre-wrap outline-none'

/**
 * A file named in the sentence, in the tone of what naming it did.
 *
 * The two are not the same thing and are not drawn the same. A file *attached* is sent along
 * with the message, and it wears the colour it wears in the header above the box — one file,
 * one colour, wherever it appears. A file merely *mentioned* is part of the question and
 * nothing more, so it takes the accent instead.
 *
 * Colour is not the only thing telling them apart: each carries the mark of what it is — the
 * `@` that made a mention, the page of a file, the same one the header draws beside the same
 * name. Two chips that differed only in hue would be two chips nobody could tell apart in a
 * screenshot, let alone with a colour vision deficiency.
 *
 * The marks are drawn by React once, off to the side and never shown, and a chip takes a copy
 * of the one it needs. An icon of this design system is a component and a chip is a DOM node
 * built at the caret, and those two do not meet anywhere else: hand-writing the same glyph as
 * a path here would be a second catalogue of icons nobody would remember to keep in step.
 */
const TOKEN =
  'mx-0.5 inline-flex items-center gap-1 rounded-sm border border-current/20 px-1 align-middle font-mono text-xs'

const TONE = {
  mention: 'bg-primary-muted text-primary-muted-foreground',
  file: 'bg-info-muted text-info-muted-foreground',
} as const

/** What naming the file did, which is what the chip is drawn as. */
export type MentionKind = keyof typeof TONE

/** What a mention is written as, both in the value and to whatever reads the message. */
export const MENTION_MARK = '@'

/** The attribute a chip carries its path in, which is what the value is rebuilt from. */
const PATH = 'data-file'

/** The attribute saying which of the two it is, so the DOM says it as plainly as the eye does. */
const KIND = 'data-kind'

/** What a chip says: the name, since the folders above it are the same for most of them. */
function shortName(path: string): string {
  return path.split('/').at(-1) ?? path
}

/** The text of the box, with every chip written back out as the mention it stands for. */
function serialise(box: HTMLElement): string {
  let text = ''
  for (const node of box.childNodes) {
    if (node instanceof HTMLElement && node.dataset.file !== undefined) {
      text += MENTION_MARK + node.dataset.file
    } else if (node instanceof HTMLBRElement) {
      text += '\n'
    } else {
      text += node.textContent ?? ''
    }
  }
  return text
}

/** One chip, built as a node because that is what goes into the sentence at the caret. */
function chipFor(path: string, kind: MentionKind, mark: Element | null): HTMLSpanElement {
  const chip = document.createElement('span')
  chip.className = `${TOKEN} ${TONE[kind]}`
  chip.contentEditable = 'false'
  chip.setAttribute(PATH, path)
  chip.setAttribute(KIND, kind)
  if (mark !== null) chip.append(mark.cloneNode(true))
  chip.append(document.createTextNode(shortName(path)))
  return chip
}

export interface ComposerBoxHandle {
  /** Writes a file where the caret is, in the tone of what naming it did. */
  insertFile: (path: string, kind: MentionKind) => void
  /** Writes plain text where the caret is, which is how the `@` itself goes in. */
  insertText: (text: string) => void
  /** What is written, as the caller's own string. */
  read: () => string
  focus: () => void
  /** The text before the caret, which is what the mention menu answers. */
  textBeforeCaret: () => string
}

/** The marks, rendered once and cloned into chips: `[mention, file]`, in that order. */
const MARKS = ['mention', 'file'] as const

export interface ComposerBoxProps {
  value: string
  onValueChange: (value: string) => void
  placeholder: string
  onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void
  handle: RefObject<ComposerBoxHandle | null>
}

export function ComposerBox({
  value,
  onValueChange,
  placeholder,
  onKeyDown,
  handle,
}: ComposerBoxProps): ReactNode {
  const box = useRef<HTMLDivElement>(null)
  const marks = useRef<HTMLDivElement>(null)

  /** Puts the caret back after whatever was just inserted, inside the box. */
  const caretAfter = (node: Node) => {
    const selection = document.getSelection()
    if (selection === null) return
    const range = document.createRange()
    range.setStartAfter(node)
    range.collapse(true)
    selection.removeAllRanges()
    selection.addRange(range)
  }

  /** Where the caret is, or the end of the box when it is somewhere else entirely. */
  const rangeInBox = (): Range | null => {
    const element = box.current
    if (element === null) return null
    const selection = document.getSelection()
    const range = selection?.rangeCount === 0 ? null : (selection?.getRangeAt(0) ?? null)
    if (range !== null && element.contains(range.commonAncestorContainer)) return range
    const end = document.createRange()
    end.selectNodeContents(element)
    end.collapse(false)
    return end
  }

  const put = (node: Node) => {
    const element = box.current
    const range = rangeInBox()
    if (element === null || range === null) return
    range.deleteContents()
    range.insertNode(node)
    caretAfter(node)
    element.focus()
    onValueChange(serialise(element))
  }

  handle.current = {
    insertFile: (path, kind) => {
      put(chipFor(path, kind, marks.current?.querySelector(`[${KIND}='${kind}'] svg`) ?? null))
      // A space after it, or the next word is typed inside a chip it does not belong to.
      put(document.createTextNode(' '))
    },
    insertText: (text) => {
      put(document.createTextNode(text))
    },
    read: () => (box.current === null ? '' : serialise(box.current)),
    focus: () => box.current?.focus(),
    textBeforeCaret: () => {
      const element = box.current
      const range = rangeInBox()
      if (element === null || range === null) return ''
      const before = range.cloneRange()
      before.selectNodeContents(element)
      before.setEnd(range.endContainer, range.endOffset)
      return before.toString()
    },
  }

  // Only when the two have come apart, which is a page rewriting the box and never a keystroke:
  // React re-rendering under the caret is React moving it to the end of the sentence.
  useEffect(() => {
    const element = box.current
    if (element === null || serialise(element) === value) return
    element.replaceChildren(document.createTextNode(value))
  }, [value])

  return (
    <>
      {/* Never shown and never in the box: what is in the box is what the message says. */}
      <div ref={marks} hidden>
        {MARKS.map((kind) => (
          <span key={kind} data-kind={kind}>
            {kind === 'mention' ? <IconAt size="sm" /> : <IconFileText size="sm" />}
          </span>
        ))}
      </div>
      <div
        ref={box}
        role="textbox"
        contentEditable
        suppressContentEditableWarning
        aria-multiline="true"
        aria-label={placeholder}
        data-placeholder={placeholder}
        data-empty={value === '' ? 'true' : 'false'}
        tabIndex={0}
        className={BOX}
        onInput={() => {
          if (box.current !== null) onValueChange(serialise(box.current))
        }}
        onKeyDown={onKeyDown}
      />
    </>
  )
}
