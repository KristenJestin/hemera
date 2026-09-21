import { cn } from 'cn'
import type { ReactNode } from 'react'

import { IconGitBranch } from '../icons.ts'
import { Disclosure } from './disclosure.tsx'

/**
 * One file's change, as the turn made it (design D17-07).
 *
 * An edit is the one tool call whose result is worth reading line by line, so it gets its own
 * block: the path, how much moved, and the lines themselves. The counts are in the folded line
 * because they are the answer to the question the block is asked ninety times out of a hundred
 * — how far did this change go — and the lines are behind a press for the hundredth.
 *
 * The change is read from the two texts the notification carries, not from a patch, and that is
 * what it is: the common head and the common tail are trimmed and the middle is reported as
 * what left and what arrived. A proper edit script would be a dependency and a pile of code
 * for a precision nobody reads — a line moved from the top of a file to the bottom shows as a
 * removal and an addition, which is exactly what happened to the file. What the reader needs is
 * not a minimal set of edits, it is what each end of the change looks like now.
 *
 * The body has its own box and its own scroll: a three-hundred-line file whose only change is
 * on line four would otherwise push the rest of the turn off the screen.
 */

/**
 * How a line stands to the change: it was there, it left, or it arrived.
 */
type LineKind = 'context' | 'removed' | 'added'

interface Line {
  kind: LineKind
  text: string
}

/** What each kind of line is drawn as: the mark in the gutter, then the line. */
const GUTTER: Record<LineKind, string> = {
  context: 'text-muted-foreground',
  removed: 'text-destructive-muted-foreground',
  added: 'text-success-muted-foreground',
}

const LINE: Record<LineKind, string> = {
  context: 'text-foreground',
  removed: 'bg-destructive-muted text-destructive-muted-foreground',
  added: 'bg-success-muted text-success-muted-foreground',
}

const MARK: Record<LineKind, string> = { context: ' ', removed: '-', added: '+' }

/** The output of the comparison: the lines to draw, and what they add up to. */
interface Change {
  lines: Line[]
  added: number
  removed: number
}

/** The line that is read: the path, then how much of it moved. */
const SUMMARY = 'flex min-w-0 items-center gap-2'

/** Where the lines are written: a box of a bounded height, scrolling inside the thread. */
const BOX =
  'scroll-quiet max-h-64 overflow-auto rounded-md border border-border bg-muted py-1 outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring'

/** One line: its mark, and the line itself, which does not wrap but scrolls across. */
const ROW = 'flex gap-2 px-2 font-mono text-xs whitespace-pre'

/** The mark of the line, in a column of its own so the text starts at the same place. */
const MARKS = 'w-2 shrink-0 text-right'

/**
 * The text as its lines. A file that ends with a newline has no empty last line: the counter
 * counts the lines of the file, not the separators between them.
 */
function intoLines(text: string): string[] {
  const all = text.split('\n')
  return all[all.length - 1] === '' ? all.slice(0, -1) : all
}

/**
 * The change between two texts, and what it adds up to.
 *
 * The head and the tail are walked off the two texts and the middle is taken as the change. The
 * walk stops at the first difference, so an insertion near the top of a file costs the tail it
 * shares and nothing else: what is left is the shortest region containing every difference the
 * two ends can explain, which for the files a tool call touches — where the change is a
 * paragraph and the rest is identical — is the change itself.
 */
function compare(oldText: string | null, newText: string): Change {
  const before = oldText === null ? [] : intoLines(oldText)
  const after = intoLines(newText)
  let head = 0
  while (head < before.length && head < after.length && before[head] === after[head]) head += 1
  let tail = 0
  while (
    tail < before.length - head &&
    tail < after.length - head &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  ) {
    tail += 1
  }
  const lines: Line[] = []
  for (let index = 0; index < head; index += 1) lines.push({ kind: 'context', text: after[index]! })
  const removed = before.slice(head, before.length - tail)
  const added = after.slice(head, after.length - tail)
  for (const text of removed) lines.push({ kind: 'removed', text })
  for (const text of added) lines.push({ kind: 'added', text })
  for (let index = after.length - tail; index < after.length; index += 1) {
    lines.push({ kind: 'context', text: after[index]! })
  }
  return { lines, added: added.length, removed: removed.length }
}

export interface DiffBlockProps {
  /** The absolute path of the file, as the agent reported it. */
  path: string
  /** What the file held before, or `null` when the call created it. */
  oldText: string | null
  /** What the file holds now. */
  newText: string
  /** Whether it starts open, for a change the reader is expected to want in full. */
  defaultOpen?: boolean | undefined
  /** Where the block sits; never how it looks. */
  className?: string | undefined
}

export function DiffBlock({
  path,
  oldText,
  newText,
  defaultOpen = false,
  className,
}: DiffBlockProps): ReactNode {
  const change = compare(oldText, newText)
  return (
    <Disclosure
      className={className}
      defaultOpen={defaultOpen}
      summary={
        <span className={SUMMARY}>
          <span className="flex shrink-0 text-muted-foreground">
            <IconGitBranch size="sm" aria-hidden="true" />
          </span>
          <span className="truncate font-mono text-foreground">{path}</span>
          <span className="flex shrink-0 items-center gap-2 font-mono text-xs">
            {/* A count of nothing is not worth a mark: a file that was created has no minus,
                and a column of `-0` beside it would be a number nobody asked for. */}
            {change.added > 0 && (
              <span className="text-success-muted-foreground">+{change.added}</span>
            )}
            {change.removed > 0 && (
              <span className="text-destructive-muted-foreground">-{change.removed}</span>
            )}
          </span>
        </span>
      }
    >
      <div tabIndex={0} role="group" aria-label={path} className={BOX}>
        {change.lines.map((line, index) => (
          <div key={index} className={LINE[line.kind]}>
            <div className={ROW}>
              <span aria-hidden="true" className={cn(GUTTER[line.kind], MARKS)}>
                {MARK[line.kind]}
              </span>
              <span>{line.text}</span>
            </div>
          </div>
        ))}
      </div>
    </Disclosure>
  )
}
