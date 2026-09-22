import { type ReactNode, type RefObject, useEffect, useRef } from 'react'

import { IconAt, IconFileText } from '../icons.ts'
import {
  type FileChipKind,
  FILE_CHIP_NAME,
  fileChip,
  fileName,
  named,
  spell,
} from './file-chip.tsx'

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
 *
 * A chip is drawn by `file-chip.tsx` and built here, and the two are one chip: the caret needs a
 * node where the thread needs an element, and neither of them gets to decide what a file named
 * in a sentence looks like. The marks are drawn by React once, off to the side and never shown,
 * and a chip takes a copy of the one it needs — an icon of this design system is a component and
 * a chip is a DOM node built at the caret, and those two do not meet anywhere else.
 */
const BOX =
  'composer-box field-sizing-content max-h-40 min-h-12 w-full whitespace-pre-wrap outline-none'

/** The attribute a chip carries its path in, which is what the value is rebuilt from. */
const PATH = 'data-file'

/** The attribute saying which of the two it is, so the DOM says it as plainly as the eye does. */
const KIND = 'data-kind'

/** The text of the box, with every chip written back out as the file it names. */
function serialise(box: HTMLElement): string {
  let text = ''
  for (const node of box.childNodes) {
    if (node instanceof HTMLElement && node.dataset.file !== undefined) {
      const kind = node.getAttribute(KIND) === 'file' ? 'file' : 'mention'
      text += spell(node.dataset.file, kind)
    } else if (node instanceof HTMLBRElement) {
      text += '\n'
    } else {
      text += node.textContent ?? ''
    }
  }
  return text
}

/** One chip, built as a node because that is what goes into the sentence at the caret. */
function chipFor(path: string, kind: FileChipKind, mark: Element | null): HTMLSpanElement {
  const chip = document.createElement('span')
  chip.className = fileChip(kind)
  chip.contentEditable = 'false'
  chip.setAttribute(PATH, path)
  chip.setAttribute(KIND, kind)
  if (mark !== null) chip.append(mark.cloneNode(true))
  const name = document.createElement('span')
  name.className = FILE_CHIP_NAME
  name.append(document.createTextNode(fileName(path)))
  chip.append(name)
  return chip
}

export interface ComposerBoxHandle {
  /** Writes a file where the caret is, in the tone of what naming it did. */
  insertFile: (path: string, kind: FileChipKind) => void
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
  /**
   * The id of the entry a list beside the box would choose, while one is open.
   *
   * The mention band is a list the caret never leaves the box for: the arrows and Enter are read
   * here, and nothing in that band is ever focused. `aria-activedescendant` is the one thing
   * that says so to whatever reads the page — without it the band is a list on screen and
   * silence in the ear, which is what it became when it stopped being a popover of its own.
   */
  activeDescendant?: string | undefined
}

export function ComposerBox({
  value,
  onValueChange,
  placeholder,
  onKeyDown,
  handle,
  activeDescendant,
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

  /** The mark of a kind, cloned into the chip rather than drawn again per chip. */
  const markFor = (kind: FileChipKind): Element | null =>
    marks.current?.querySelector(`[${KIND}='${kind}'] svg`) ?? null

  handle.current = {
    insertFile: (path, kind) => {
      put(chipFor(path, kind, markFor(kind)))
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
    // Read back the way the thread reads a message, in the one reading there is: a value that
    // came from somewhere else names its files in the same words, so it draws the same chips. A
    // box that took the words at face value would show `@"C:\…"` to the person who wrote it.
    const rebuilt = document.createDocumentFragment()
    for (const piece of named(value)) {
      if (piece.at === 'words') {
        for (const [at, line] of piece.said.split('\n').entries()) {
          if (at > 0) rebuilt.append(document.createElement('br'))
          if (line !== '') rebuilt.append(document.createTextNode(line))
        }
      } else {
        rebuilt.append(chipFor(piece.path, piece.kind, markFor(piece.kind)))
      }
    }
    element.replaceChildren(rebuilt)
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
        aria-activedescendant={activeDescendant}
        aria-label={placeholder}
        data-placeholder={placeholder}
        data-empty={value === '' ? 'true' : 'false'}
        tabIndex={0}
        className={BOX}
        onInput={() => {
          if (box.current !== null) onValueChange(serialise(box.current))
        }}
        onKeyDown={onKeyDown}
        /**
         * What is pasted is the text and nothing else.
         *
         * A copy taken inside the application carries the surfaces it was copied from, and a
         * sentence pasted from the thread arrived in the box wearing their chips, their colours
         * and their boxes — a message written about the application is a message, not a picture
         * of one. The plain half of the clipboard is what a sentence is, and it is the half
         * every other application writes too.
         */
        onPaste={(event) => {
          event.preventDefault()
          const text = event.clipboardData.getData('text/plain')
          if (text !== '') put(document.createTextNode(text))
        }}
      />
    </>
  )
}
