import {
  type CodeViewItem,
  type FileDiffMetadata,
  type SelectedLineRange,
  parseDiffFromFile,
} from '@pierre/diffs'
import {
  CodeView,
  type CodeViewHandle,
  type CodeViewReactOptions,
  type DiffLineAnnotation,
  type LineAnnotation,
} from '@pierre/diffs/react'
import { cn } from 'cn'
import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'

import { Button, IconButton } from '../../components/button/button.tsx'
import { Skeleton } from '../../components/loading/loading.tsx'
import { Legend } from '../../components/tooltip/legend.tsx'
import { Tooltip } from '../../components/tooltip/tooltip.tsx'
import {
  IconAlertTriangle,
  IconBinary,
  IconChevronRight,
  IconCircleDashed,
  IconFileCode,
  IconLock,
  IconMessagePlus,
  IconPlus,
} from '../../icons.ts'
import { instant, useTransition } from '../../motion.ts'
import {
  type CommentHandlers,
  CommentStack,
  type NewComment,
  NewCommentBox,
} from './diff-comments.tsx'
import { DIFF_THEME, useDocumentTheme } from './diff-theme.ts'
import { idOf } from './diff-tree.tsx'
import type { DiffComment, DiffFile, DiffRepository, GitLetter, Place } from './diff-types.ts'

/**
 * The middle of the diff view: every file of the Workspace one after the other in one scroll, the
 * way a pull request page is read, drawn by `@pierre/diffs`'s CodeView. Only what is on screen is
 * drawn, so a file of ten thousand lines scrolls as one of ten.
 *
 * Each file has its head — its repository, its path, Git's letter, its marks, its counts, the fold
 * — and folds on its own. Split or stacked is one toggle, the view's. A generated file comes
 * folded; a binary file is its head and its sizes; a file that may hold secrets is its head and
 * its lock, its content never drawn; a file too long to draw at once waits for its Show.
 *
 * A comment is written on a line (its number pressed), on a range (dragged over, or Shift with the
 * arrows), or on the whole file (the head's comment button); the comments stand under the lines
 * they end on, a whole-file one at the head of its file.
 *
 * The library draws no line the keyboard can reach. The scroll is a stop of its own: the arrows
 * walk a line cursor through the files (the library's own selection, drawn in the selection's
 * colour), Shift with them stretches it, Enter writes a comment on what it holds, Escape lets it
 * go. A live line says where the cursor stands, for a screen reader.
 */

export type DiffLayout = 'split' | 'stacked'

/** Where the view was asked to go: a file from the tree, or a comment from the Review page. */
export type StageTarget =
  | { kind: 'file'; id: string; nonce: number }
  | { kind: 'comment'; id: string; nonce: number }

/** What a line of the diff holds under it: the comments ending there, or the box being written. */
type Note = { kind: 'comments'; comments: readonly DiffComment[] } | { kind: 'draft'; place: Place }

export interface DiffStageProps extends CommentHandlers {
  repositories: readonly DiffRepository[]
  comments: readonly DiffComment[]
  layout: DiffLayout
  /** Whether comments can be written and acted on: not on a diff read from a checkpoint. */
  writable: boolean
  loading?: boolean | undefined
  target?: StageTarget | null | undefined
  /** The comment the view was sent to, lit while it is. */
  lit?: string | null | undefined
  onAdd: (comment: NewComment) => void
  /** A large file's Show pressed: its sides are asked for, by its id. */
  onShow: (id: string) => void
}

interface Known {
  repository: string
  file: DiffFile
}

/** One line the cursor can stand on: its side, its number, its words. */
interface Row {
  side: 'deletions' | 'additions'
  line: number
  text: string
}

/** The lines of a diff in the order a stacked diff draws them: context, removed, then added. */
function rowsOf(diff: FileDiffMetadata): readonly Row[] {
  const rows: Row[] = []
  for (const hunk of diff.hunks) {
    let removed = hunk.deletionStart
    let added = hunk.additionStart
    for (const part of hunk.hunkContent) {
      if (part.type === 'context') {
        for (let at = 0; at < part.lines; at += 1) {
          const text = diff.additionLines[part.additionLineIndex + at] ?? ''
          rows.push({ side: 'additions', line: added, text })
          removed += 1
          added += 1
        }
        continue
      }
      for (let at = 0; at < part.deletions; at += 1) {
        const text = diff.deletionLines[part.deletionLineIndex + at] ?? ''
        rows.push({ side: 'deletions', line: removed, text })
        removed += 1
      }
      for (let at = 0; at < part.additions; at += 1) {
        const text = diff.additionLines[part.additionLineIndex + at] ?? ''
        rows.push({ side: 'additions', line: added, text })
        added += 1
      }
    }
  }
  return rows
}

/** The files in the order the tree lists them: at each level folders first, then by name. */
function inTreeOrder(left: DiffFile, right: DiffFile): number {
  const a = left.path.split('/')
  const b = right.path.split('/')
  for (let at = 0; at < Math.min(a.length, b.length); at += 1) {
    if (a[at] === b[at]) continue
    const aFolder = at < a.length - 1
    const bFolder = at < b.length - 1
    if (aFolder !== bFolder) return aFolder ? -1 : 1
    return (a[at] ?? '').localeCompare(b[at] ?? '')
  }
  return a.length - b.length
}

/** Whether a file has lines to draw at all: not a binary, a withheld or an unreadable one. */
const drawable = (file: DiffFile): boolean =>
  file.binary === undefined && file.withheld !== true && file.unreadable === undefined

/** The diff of a file with no lines to draw, or none read yet. */
const emptyOf = (file: DiffFile): FileDiffMetadata =>
  parseDiffFromFile({ name: file.path, contents: '' }, { name: file.path, contents: '' })

/** A text file's diff, and the count of its parses: what moved in it moves its version. */
interface Parsed {
  before: string | null
  after: string | null
  diff: FileDiffMetadata
  parse: number
}

/**
 * Each text file's diff, parsed once per content: CodeView keeps a diff by identity, and a new
 * object under the same version is a file it refuses to redraw. A file whose sides are not read
 * yet has none.
 */
function useDiffs(files: ReadonlyMap<string, Known>): ReadonlyMap<string, Parsed> {
  const cache = useRef(new Map<string, Parsed>())
  return useMemo(() => {
    const diffs = new Map<string, Parsed>()
    for (const [id, { file }] of files) {
      const sides = file.sides
      if (!drawable(file) || sides === undefined) continue
      const known = cache.current.get(id)
      if (known !== undefined && known.before === sides.before && known.after === sides.after) {
        diffs.set(id, known)
        continue
      }
      const name = file.path
      const diff = parseDiffFromFile(
        { name: file.from ?? name, contents: sides.before ?? '' },
        { name, contents: sides.after ?? '' },
      )
      const parsed = { ...sides, diff, parse: (known?.parse ?? 0) + 1 }
      cache.current.set(id, parsed)
      diffs.set(id, parsed)
    }
    return diffs
  }, [files])
}

/** What each expand button of the library's separators does, which it leaves unnamed. */
const EXPANDERS: readonly (readonly [string, string])[] = [
  ['[data-expand-up]', 'Show the lines above'],
  ['[data-expand-down]', 'Show the lines below'],
  ['[data-expand-both]', 'Show the lines between'],
]

/** The library draws its buttons with no name: each is named here once drawn. */
function nameButtons(node: HTMLElement): void {
  const root = node.shadowRoot ?? node
  for (const [selector, name] of EXPANDERS) {
    for (const button of root.querySelectorAll(`[data-expand-button]${selector}`)) {
      button.setAttribute('aria-label', name)
    }
  }
  for (const button of root.querySelectorAll('[data-utility-button]')) {
    button.setAttribute('aria-label', 'Comment on this line')
  }
}

const LETTERS: Record<GitLetter, { words: string; tone: string }> = {
  A: { words: 'Added', tone: 'text-success-muted-foreground' },
  M: { words: 'Modified', tone: 'text-warning-muted-foreground' },
  D: { words: 'Deleted', tone: 'text-destructive-muted-foreground' },
  R: { words: 'Renamed', tone: 'text-info-muted-foreground' },
  T: { words: 'Type changed', tone: 'text-info-muted-foreground' },
}

/** The head of a file is as tall as the library reserves for it, so nothing is measured twice. */
const HEAD =
  'flex h-diff-head min-w-0 items-center gap-2 border-b border-border bg-card px-3 font-sans text-sm'

const REPO = 'shrink-0 rounded-sm bg-muted px-1.5 font-mono text-xs text-muted-foreground'

const MARK = 'flex shrink-0 text-muted-foreground'

interface HeadProps {
  repository: string
  file: DiffFile
  open: boolean
  /** Whether the file folds at all: one with no lines to show has nothing to fold. */
  folds: boolean
  writable: boolean
  comments: number
  onFold: () => void
  onShow: () => void
  onComment: () => void
}

/** A file's head: the fold, where it is, what changed in it, and what can be done with it. */
function FileHead({
  repository,
  file,
  open,
  folds,
  writable,
  comments,
  onFold,
  onShow,
  onComment,
}: HeadProps): ReactNode {
  const id = idOf(repository, file.path)
  const letter = LETTERS[file.letter]
  const waits = file.large !== undefined && file.sides === undefined
  return (
    <div className={HEAD} data-file-head={id}>
      {folds ? (
        <IconButton
          variant="ghost"
          size="sm"
          icon={
            <span className={cn('flex chevron-motion', open && 'rotate-90')}>
              <IconChevronRight size="sm" />
            </span>
          }
          aria-label={`${open ? 'Fold' : 'Unfold'} ${id}`}
          aria-expanded={open}
          onClick={onFold}
        />
      ) : (
        <span className="size-control-sm shrink-0" />
      )}
      <span className={REPO}>{repository}</span>
      <span className="flex min-w-0 items-center gap-1 font-mono text-xs">
        {file.from !== undefined && (
          <>
            <span className="min-w-0 truncate text-muted-foreground">{file.from}</span>
            <span className="shrink-0 text-muted-foreground">→</span>
          </>
        )}
        <span className={cn('min-w-0 truncate', file.letter === 'D' && 'line-through')}>
          {file.path}
        </span>
      </span>
      <Legend label={letter.words}>
        <span className={cn('shrink-0 font-mono text-xs font-semibold', letter.tone)}>
          {file.letter}
        </span>
      </Legend>
      {file.untracked === true && (
        <Legend label="Not tracked by Git: a commit would leave it out">
          <span className={MARK}>
            <IconCircleDashed size="sm" />
          </span>
        </Legend>
      )}
      {file.generated === true && (
        <Legend label="Generated: written by a tool, folded until you open it">
          <span className={MARK}>
            <IconFileCode size="sm" />
          </span>
        </Legend>
      )}
      {file.outside === true && (
        <Legend label="Changed outside Hemera">
          <span className="flex shrink-0 text-warning">
            <IconAlertTriangle size="sm" />
          </span>
        </Legend>
      )}
      {file.withheld === true && (
        <Legend label="Withheld: it may hold secrets, so its content is never shown">
          <span className={MARK}>
            <IconLock size="sm" />
          </span>
        </Legend>
      )}
      {file.unreadable !== undefined && (
        <Legend label={`Unreadable: ${file.unreadable}`}>
          <span className="flex shrink-0 text-destructive">
            <IconAlertTriangle size="sm" />
          </span>
        </Legend>
      )}
      {file.binary !== undefined && (
        <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
          <Legend label="Binary: its sizes before and after">
            <span className={MARK}>
              <IconBinary size="sm" />
            </span>
          </Legend>
          {`${file.binary.before ?? '—'} → ${file.binary.after ?? '—'}`}
        </span>
      )}
      {drawable(file) && (
        <span className="shrink-0 font-mono text-xs tabular-nums">
          {file.added > 0 && (
            <span className="text-success-muted-foreground">{`+${String(file.added)}`}</span>
          )}
          {file.added > 0 && file.removed > 0 && ' '}
          {file.removed > 0 && (
            <span className="text-destructive-muted-foreground">{`−${String(file.removed)}`}</span>
          )}
        </span>
      )}
      <span className="ml-auto flex shrink-0 items-center gap-1">
        {comments > 0 && (
          <span className="text-xs text-muted-foreground tabular-nums">
            {`${String(comments)} ${comments === 1 ? 'comment' : 'comments'}`}
          </span>
        )}
        {waits && (
          <Button variant="secondary" size="sm" onClick={onShow}>
            {`Show its ${(file.large?.lines ?? 0).toLocaleString('en')} lines`}
          </Button>
        )}
        {writable && drawable(file) && file.sides !== undefined && (
          <Tooltip label="Comment on the whole file">
            <IconButton
              variant="ghost"
              size="sm"
              icon={<IconMessagePlus size="sm" />}
              aria-label={`Comment on the whole file ${id}`}
              onClick={onComment}
            />
          </Tooltip>
        )}
      </span>
    </div>
  )
}

/** The heads of files while the diff is read: their shape is known, their words are not. */
function StageSkeleton(): ReactNode {
  return (
    <div aria-busy="true" aria-label="The diff" role="region" className="flex flex-col gap-3 p-3">
      {[
        'api/src/billing/export.controller.ts',
        'api/src/billing/export.query.ts',
        'web/src/billing/export-button.tsx',
      ].map((path) => (
        <div key={path} className="flex flex-col rounded-lg border border-border">
          <div className={HEAD}>
            <Skeleton>{path}</Skeleton>
          </div>
          <div className="flex flex-col gap-1 p-3">
            {['export function invoicesOf(customer: string) {', "  return db.select('*')", '}'].map(
              (line) => (
                <span key={line} className="font-mono text-xs">
                  <Skeleton>{line}</Skeleton>
                </span>
              ),
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

/** Where a place is, in words: `api/src/billing/export.query.ts, lines 57–60`. */
export function whereOf(place: Place): string {
  const file = idOf(place.repository, place.path)
  if (place.lines === null) return `the whole file ${file}`
  const { start, end } = place.lines
  return start === end
    ? `${file}, line ${String(start)}`
    : `${file}, lines ${String(start)}–${String(end)}`
}

const sideOf = (side: Place['side']): 'deletions' | 'additions' =>
  side === 'old' ? 'deletions' : 'additions'

/** The cursor of the keyboard: a file, the row it stands on, and the row a stretch began at. */
interface Cursor {
  id: string
  at: number
  from: number
}

export function DiffStage({
  repositories,
  comments,
  layout,
  writable,
  loading = false,
  target = null,
  lit = null,
  onAdd,
  onShow,
  ...handlers
}: DiffStageProps): ReactNode {
  const view = useRef<CodeViewHandle<Note, undefined>>(null)
  const scroller = useRef<HTMLDivElement | null>(null)
  const hint = useId()
  const theme = useDocumentTheme()
  const moving = useTransition()
  const [draft, setDraft] = useState<{ id: string; place: Place } | null>(null)
  const [selection, setSelection] = useState<{ id: string; range: SelectedLineRange } | null>(null)
  const [cursor, setCursor] = useState<Cursor | null>(null)
  const [said, setSaid] = useState('')
  // What the hand folded and unfolded, by id: a generated file starts folded, the others open.
  const [toggled, setToggled] = useState<ReadonlySet<string>>(new Set())

  const files = useMemo(() => {
    const index = new Map<string, Known>()
    for (const repository of repositories) {
      for (const file of repository.files.toSorted(inTreeOrder)) {
        index.set(idOf(repository.name, file.path), { repository: repository.name, file })
      }
    }
    return index
  }, [repositories])
  const diffs = useDiffs(files)
  const rows = useMemo(() => {
    const index = new Map<string, readonly Row[]>()
    for (const [id, parsed] of diffs) index.set(id, rowsOf(parsed.diff))
    return index
  }, [diffs])

  const isOpen = (id: string, file: DiffFile): boolean => {
    if (!drawable(file) || file.sides === undefined) return false
    const folded = file.generated === true
    return toggled.has(id) ? folded : !folded
  }

  // An item keeps its version while nothing of it changed, and takes the next one when its notes,
  // its fold or its content did: CodeView redraws an item only when its version moves.
  const versions = useRef(new Map<string, { signature: string; version: number }>())
  const items = useMemo(() => {
    const list: CodeViewItem<Note>[] = []
    for (const [id, { repository, file }] of files) {
      const notes: DiffLineAnnotation<Note>[] = []
      const ending = new Map<string, DiffComment[]>()
      for (const comment of comments) {
        const { place } = comment
        if (place.repository !== repository || place.path !== file.path) continue
        const key = `${place.side}:${String(place.lines?.end ?? 0)}`
        ending.set(key, [...(ending.get(key) ?? []), comment])
      }
      for (const [key, here] of ending) {
        const [side = 'new', line = '0'] = key.split(':')
        notes.push({
          side: side === 'old' ? 'deletions' : 'additions',
          lineNumber: Number(line),
          metadata: { kind: 'comments', comments: here },
        })
      }
      if (draft?.id === id) {
        notes.push({
          side: sideOf(draft.place.side),
          lineNumber: draft.place.lines?.end ?? 0,
          metadata: { kind: 'draft', place: draft.place },
        })
      }
      const open = isOpen(id, file)
      const parsed = diffs.get(id)
      const signature = JSON.stringify([
        notes.map((note) =>
          note.metadata.kind === 'draft'
            ? ['draft', note.side, note.lineNumber]
            : note.metadata.comments.map((one) => [one.id, one.state, one.text, lit === one.id]),
        ),
        open,
        writable,
        parsed?.parse,
      ])
      const known = versions.current.get(id)
      const version =
        known === undefined ? 0 : known.signature === signature ? known.version : known.version + 1
      versions.current.set(id, { signature, version })
      list.push({
        id,
        type: 'diff',
        // A file with no lines read yet is an empty diff, folded: the same kind of item as the
        // one it becomes once its sides arrive, which the library then redraws in place.
        fileDiff: parsed?.diff ?? emptyOf(file),
        annotations: notes,
        collapsed: !open,
        version,
      })
    }
    return list
    // `isOpen` reads `toggled`, listed.
  }, [files, diffs, comments, draft, toggled, lit, writable])

  const behavior = moving === instant ? 'instant' : 'smooth'

  const options = useMemo<CodeViewReactOptions<Note, undefined>>(
    () => ({
      theme: DIFF_THEME,
      themeType: theme,
      diffStyle: layout === 'split' ? 'split' : 'unified',
      diffIndicators: 'bars',
      lineDiffType: 'word-alt',
      hunkSeparators: 'line-info-basic',
      overflow: 'wrap',
      stickyHeaders: true,
      enableLineSelection: writable,
      enableGutterUtility: writable,
      lineHoverHighlight: 'number',
      // A comment's buttons answer the hand even while the view scrolls to it.
      pointerEventsOnScroll: true,
      onPostRender: (node, _instance, phase) => {
        if (phase !== 'unmount') nameButtons(node)
      },
      onLineSelectionEnd: (range, context) => {
        if (range !== null) openDraft(context.item.id, range)
      },
    }),
    // `openDraft` reads only the files, which change with the repositories.
    [theme, layout, writable, files],
  )

  function openDraft(id: string, range: SelectedLineRange): void {
    const known = files.get(id)
    if (known === undefined) return
    const start = Math.min(range.start, range.end)
    const end = Math.max(range.start, range.end)
    const side = (range.endSide ?? range.side) === 'deletions' ? 'old' : 'new'
    setSelection({ id, range })
    setDraft({
      id,
      place: { repository: known.repository, path: known.file.path, side, lines: { start, end } },
    })
  }

  function closeDraft(): void {
    setDraft(null)
    setSelection(null)
    scroller.current?.focus({ preventScroll: true })
  }

  // A large file asked for: once its lines arrive, the view stands at its head. Left alone, the
  // scroll would keep the file after it in place and leap over the lines just asked for.
  const asked = useRef(new Set<string>())
  useEffect(() => {
    for (const id of asked.current) {
      if (!diffs.has(id)) continue
      asked.current.delete(id)
      view.current?.scrollTo({ type: 'item', id, align: 'start', behavior: 'instant' })
    }
  }, [diffs])

  // Sent here from the tree, or from a comment's place on the Review page.
  useEffect(() => {
    if (target === null) return
    if (target.kind === 'file') {
      view.current?.scrollTo({ type: 'item', id: target.id, align: 'start', behavior })
      return
    }
    const comment = comments.find((one) => one.id === target.id)
    if (comment === undefined) return
    const { place } = comment
    const id = idOf(place.repository, place.path)
    if (place.lines === null) {
      view.current?.scrollTo({ type: 'item', id, align: 'start', behavior })
      return
    }
    const side = sideOf(place.side)
    view.current?.scrollTo({
      type: 'range',
      id,
      range: { start: place.lines.start, end: place.lines.end, side, endSide: side },
      align: 'center',
      behavior,
    })
  }, [target])

  /** The keyboard's cursor put on a row: selected, brought into sight, and said. */
  function putCursor(next: Cursor): void {
    const list = rows.get(next.id) ?? []
    const row = list[next.at]
    const first = list[next.from]
    if (row === undefined || first === undefined) return
    setCursor(next)
    const range: SelectedLineRange =
      next.at >= next.from
        ? { start: first.line, side: first.side, end: row.line, endSide: row.side }
        : { start: row.line, side: row.side, end: first.line, endSide: first.side }
    setSelection({ id: next.id, range })
    view.current?.scrollTo({
      type: 'line',
      id: next.id,
      lineNumber: row.line,
      side: row.side,
      align: 'nearest',
      // Clear of the file's head, which stays stuck over the top of the scroll.
      offset: scroller.current?.querySelector('[data-file-head]')?.clientHeight ?? 0,
      behavior: 'instant',
    })
    const known = files.get(next.id)
    const where = known === undefined ? next.id : idOf(known.repository, known.file.path)
    const side = row.side === 'deletions' ? 'removed ' : ''
    const count = Math.abs(next.at - next.from) + 1
    const span = count > 1 ? `, ${String(count)} lines chosen` : ''
    setSaid(`${where}, ${side}line ${String(row.line)}${span}: ${row.text.trim() || 'empty'}`)
  }

  /** The open files the cursor walks through, in their order. */
  const walkable = [...files].filter(
    ([id, { file }]) => isOpen(id, file) && (rows.get(id)?.length ?? 0) > 0,
  )

  function step(by: 1 | -1, stretch: boolean): void {
    if (walkable.length === 0) return
    if (cursor === null) {
      const [first] = walkable[0] ?? []
      if (first !== undefined) putCursor({ id: first, at: 0, from: 0 })
      return
    }
    const list = rows.get(cursor.id) ?? []
    const next = cursor.at + by
    if (next >= 0 && next < list.length) {
      putCursor({ id: cursor.id, at: next, from: stretch ? cursor.from : next })
      return
    }
    // A stretch stays in its file; the cursor alone goes on to the next one.
    if (stretch) return
    const at = walkable.findIndex(([id]) => id === cursor.id)
    const [other] = walkable[at + by] ?? []
    if (other === undefined) return
    const length = rows.get(other)?.length ?? 0
    const row = by === 1 ? 0 : length - 1
    putCursor({ id: other, at: row, from: row })
  }

  function keys(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.target !== scroller.current) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      step(event.key === 'ArrowDown' ? 1 : -1, event.shiftKey)
      return
    }
    if (event.key === 'Enter' && cursor !== null && selection !== null && writable) {
      event.preventDefault()
      openDraft(selection.id, selection.range)
      return
    }
    if (event.key === 'Escape' && cursor !== null) {
      event.preventDefault()
      event.stopPropagation()
      setCursor(null)
      setSelection(null)
      setSaid('')
    }
  }

  const commentsOf = (repository: string, path: string): number =>
    comments.filter((one) => one.place.repository === repository && one.place.path === path).length

  function annotationOf(annotation: LineAnnotation<Note> | DiffLineAnnotation<Note>): ReactNode {
    const { metadata } = annotation
    if (metadata.kind === 'draft') {
      return (
        <NewCommentBox
          place={metadata.place}
          where={whereOf(metadata.place)}
          onCancel={closeDraft}
          onAdd={(added) => {
            onAdd(added)
            closeDraft()
          }}
        />
      )
    }
    return <CommentStack comments={metadata.comments} lit={lit} writable={writable} {...handlers} />
  }

  function headOf(item: CodeViewItem<Note>): ReactNode {
    const known = files.get(item.id)
    if (known === undefined) return null
    const { repository, file } = known
    return (
      <FileHead
        repository={repository}
        file={file}
        open={isOpen(item.id, file)}
        folds={drawable(file) && file.sides !== undefined}
        writable={writable}
        comments={commentsOf(repository, file.path)}
        onFold={() =>
          setToggled((before) => {
            const next = new Set(before)
            if (next.has(item.id)) next.delete(item.id)
            else next.add(item.id)
            return next
          })
        }
        onShow={() => {
          asked.current.add(item.id)
          onShow(item.id)
        }}
        onComment={() =>
          setDraft({
            id: item.id,
            place: {
              repository,
              path: file.path,
              side: file.letter === 'D' ? 'old' : 'new',
              lines: null,
            },
          })
        }
      />
    )
  }

  if (loading) return <StageSkeleton />

  return (
    <div data-diff-stage="" className="flex min-h-0 flex-1 flex-col bg-card" onKeyDown={keys}>
      <p id={hint} className="sr-only">
        The arrows go line by line; Shift with them chooses lines; Enter writes a comment on them.
      </p>
      <p aria-live="polite" className="sr-only">
        {said}
      </p>
      <CodeView<Note, undefined>
        ref={view}
        containerRef={(element) => {
          scroller.current = element
          if (element === null) return
          element.tabIndex = 0
          element.setAttribute('role', 'region')
          element.setAttribute('aria-label', 'The diff')
          element.setAttribute('aria-describedby', hint)
          element.classList.add('outline-none')
          element.dataset['diffScroller'] = ''
        }}
        items={items}
        options={options}
        className={cn('min-h-0 flex-1 overflow-auto')}
        selectedLines={selection}
        onSelectedLinesChange={(next) => {
          setSelection(next)
          if (next === null) setCursor(null)
        }}
        renderAnnotation={annotationOf}
        renderCustomHeader={headOf}
        renderGutterUtility={(hovered, item) =>
          writable ? (
            <button
              type="button"
              aria-label="Comment on this line"
              className="flex size-icon-md items-center justify-center rounded-sm primary-fill text-primary-foreground outline-none focus-ring"
              onClick={() => {
                const line = hovered()
                if (line === undefined) return
                const side = 'side' in line && line.side === 'deletions' ? 'deletions' : 'additions'
                openDraft(item.id, {
                  start: line.lineNumber,
                  end: line.lineNumber,
                  side,
                  endSide: side,
                })
              }}
            >
              <IconPlus size="sm" />
            </button>
          ) : null
        }
      />
    </div>
  )
}
