import { cn } from 'cn'
import type { ReactNode } from 'react'

import { IconAt, IconFileText } from '../icons.ts'

/**
 * A file named in a sentence, drawn the same wherever that sentence is read (design D4-07).
 *
 * The chip is one thing in two places — the box being typed into and the thread it was written
 * into — and neither of them owns it: a message that drew its own version of a chip would be a
 * message the reader has to learn twice. What the eye is taught once is a name in the mono face,
 * the mark of what naming the file did, and the tone that goes with the mark.
 *
 * It is a `span`, never a control: nothing about a chip is pressable, in the box or in the
 * thread. What makes one editable there — a node that is not editable itself and goes away whole
 * — is the composer's business, and the composer builds its chips as DOM nodes because a caret
 * cannot wait for React.
 */
export type FileChipKind = 'mention' | 'file'

/**
 * The two marks, and they are marks: colour alone is not a difference anyone can rely on.
 *
 * The `@` that made a mention, and the page that stands for a file handed along with the
 * message — the same one the header above the box draws beside the same name.
 */
const MARK: Record<FileChipKind, ReactNode> = {
  mention: <IconAt size="sm" />,
  file: <IconFileText size="sm" />,
}

/** The chip's own shape, which is the same in the thread as in the box. */
const CHIP =
  'mx-0.5 inline-flex max-w-full min-w-0 items-center gap-1 rounded-sm border border-current/20 px-1 align-middle font-mono text-xs'

/**
 * The tone of what naming the file did, which is not the same thing twice.
 *
 * A file *attached* is sent along with the message and wears the colour it wears in the header
 * above the box — one file, one colour, wherever it appears. A file merely *mentioned* is part
 * of the question and nothing more, so it takes the accent instead.
 */
const TONE: Record<FileChipKind, string> = {
  mention: 'bg-primary-muted text-primary-muted-foreground',
  file: 'bg-info-muted text-info-muted-foreground',
}

/** What a chip is drawn with, as classes — the box builds its chips at the caret, not in React. */
export function fileChip(kind: FileChipKind): string {
  return cn(CHIP, TONE[kind])
}

/** The box the name sits in, shared by the React chip and the one the box builds as a node. */
export const FILE_CHIP_NAME = 'truncate'

/** What a chip is written as in the value of a message, and what a thread looks for. */
export const MENTION_MARK = '@'

/** The quote around a path that cannot be written as one word: the mention's, and the file's. */
export const MENTION_QUOTE = "'"
export const ATTACH_QUOTE = '"'

/**
 * How a named file is written in the sentence, and therefore how the thread reads its kind back.
 *
 * A mention is `@` and its path, and a path is a word: one with a space in it, which a Project
 * does have, is quoted instead — `@'my file.ts'` — since the space would otherwise end it. A file
 * handed over is `@"path"` whatever it is called: the double quote says the gesture that put it
 * in the sentence was the paperclip, and the thread draws that one as the file it is rather than
 * as one more thing pointed at. The kind is in the words, because the words are what survives.
 */
export function spell(path: string, kind: FileChipKind): string {
  if (kind === 'file') return `${MENTION_MARK}${ATTACH_QUOTE}${path}${ATTACH_QUOTE}`
  return /\s/.test(path)
    ? `${MENTION_MARK}${MENTION_QUOTE}${path}${MENTION_QUOTE}`
    : `${MENTION_MARK}${path}`
}

/** A sentence taken apart: the words, and the files it names. */
export type Named = { at: 'words'; said: string } | { at: 'file'; path: string; kind: FileChipKind }

/**
 * The reading of a sentence, and the only one there is: the box rebuilds its chips from it and
 * the thread draws a message from it, so what is written and what is read back cannot drift.
 *
 * Only a named file becomes a chip. What comes before the `@` decides: a word in front of it is
 * an address (`kris@example.com` is not a file), and anything else — a space, a bracket, the
 * start of the sentence — is how a mention is written. Punctuation after it is left where it is,
 * so a mention can end a sentence.
 */
const NAMED_AT = /(^|[^\w@])@(?:"([^"\n]+)"|'([^'\n]+)'|(\S+))/g

/** What a sentence is allowed to end on, and what a path is not. */
const TRAILING = /[.,;:!?)\]}'"»]+$/

export function named(text: string): Named[] {
  const pieces: Named[] = []
  let at = 0

  for (const found of text.matchAll(NAMED_AT)) {
    const start = (found.index ?? 0) + (found[1] ?? '').length
    const handed = found[2]
    const quoted = found[3]
    const word = found[4]
    const path = handed ?? quoted ?? (word ?? '').replace(TRAILING, '')
    // A lone `@`, or one followed by nothing but punctuation, names nothing: it stays text.
    if (path === '') continue

    // A quoted path ends where its quote ends, so the full stop of the sentence is outside it.
    // A word ends where a path ends: the punctuation that follows it is the sentence's.
    // Either way the width is the chip's own and never the character in front of it: that one is
    // part of the match so the `@` can be told from an address, and it was already read as words.
    const width =
      handed === undefined && quoted === undefined
        ? 1 + path.length
        : found[0].length - (found[1] ?? '').length

    if (start > at) pieces.push({ at: 'words', said: text.slice(at, start) })
    pieces.push({ at: 'file', path, kind: handed === undefined ? 'mention' : 'file' })
    at = start + width
  }

  if (at < text.length) pieces.push({ at: 'words', said: text.slice(at) })
  return pieces
}

/**
 * What a chip says: the name, since the folders above it are the same for most of them.
 *
 * A path is spelled by whoever handed it over. A file of the Workspace is named relative to it;
 * a file chosen anywhere else — which is what the paperclip is for — is named by its own
 * absolute path, and the two systems spell a folder with a separator of their own. The name is
 * what the last of either leaves behind.
 */
export function fileName(path: string): string {
  return path.split(/[/\\]/).at(-1) || path
}

export interface FileChipProps {
  /** The path as it was handed over: relative to the Workspace, or absolute. */
  path: string
  kind?: FileChipKind | undefined
}

export function FileChip({ path, kind = 'mention' }: FileChipProps): ReactNode {
  return (
    <span className={fileChip(kind)} data-file={path} data-kind={kind}>
      {MARK[kind]}
      {/* The name in a box of its own: a path handed over from anywhere can be longer than the
          line it was written in, and a chip that cannot shorten takes the whole thread sideways
          with it — the bubble is as wide as what will not wrap. */}
      <span className={FILE_CHIP_NAME}>{fileName(path)}</span>
    </span>
  )
}
