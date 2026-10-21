import { cn } from 'cn'
import { type ClipboardEvent, type DragEvent, type ReactNode, useId, useState } from 'react'

import { Button } from '../../components/button/button.tsx'
import { Frame } from '../../components/frame/frame.tsx'
import { Textarea } from '../../components/field/field.tsx'
import { Skeleton } from '../../components/loading/loading.tsx'
import { MentionField, type Mentionable } from '../../components/mention-field/mention-field.tsx'
import { SectionHead } from '../../components/section-head/section-head.tsx'
import type { MarkState } from '../../components/status-mark/mark-legends.ts'
import { StatusMark } from '../../components/status-mark/status-mark.tsx'
import { Legend } from '../../components/tooltip/legend.tsx'
import {
  IconAlertTriangle,
  IconArrowBackUp,
  IconGitCompare,
  IconHelpCircle,
  IconPhoto,
  IconX,
} from '../../icons.ts'
import {
  Chevron,
  ID,
  LINE,
  MARKED,
  MONO,
  PROSE,
  QUIET,
  Unfolding,
  plural,
} from './review-parts.tsx'
import type { Remark, RemarkImage, RemarkState, Round } from './review-types.ts'

/**
 * The user's feedback, as #254 recommends it for open question 33: it lives in the middle of the
 * Review page, by round. On top, the field to write a remark or a question, images pasted,
 * dropped or attached; under it, the next round being written — what waits to be sent, with Fix —
 * then each round, the newest first, with what the agent answered to every remark it carried.
 * The latest round stands open; the older ones are one line each.
 *
 * A comment written in the diff is a remark like the others, with its place in the code: one list,
 * one set of states, one way to the diff. A team's comment joins a round only through the user,
 * from For you, and then reads as their own remark.
 */

export type RemarkAction = 'add' | 'edit' | 'withdraw' | 'resolve'

export interface NewRemark {
  kind: Remark['kind']
  text: string
  images: readonly string[]
  follows?: string | undefined
}

/** What Hemera answered for an image attached: the id it keeps it by, or why it refused it. */
export type Attached = { id: string } | { refused: string }

export interface FeedbackHandlers {
  onAdd: (remark: NewRemark) => void
  /** An image attached, pasted or dropped, handed to Hemera at once: Hemera judges it. */
  onAttach: (file: File) => Promise<Attached>
  /** A remark the agent answered with a mission of its own: the mission is started from it. */
  onStartMission: (id: string) => void
  onEdit: (id: string, text: string) => void
  onWithdraw: (id: string) => void
  onResolve: (id: string) => void
  onFix: () => void
  onOpenDiff: (where: string) => void
  onOpenRound: (n: number) => void
}

const MARK: Record<RemarkState, MarkState> = {
  waiting: 'todo',
  inRound: 'running',
  addressed: 'waiting',
  resolved: 'done',
  withdrawn: 'skipped',
}

/** What a remark's mark says, in words. */
export function remarkLegend(remark: Remark): string {
  switch (remark.state) {
    case 'waiting':
      return 'Waiting for the next round'
    case 'inRound':
      return `In round ${String(remark.round ?? '')}`
    case 'addressed':
      return 'Addressed: resolve it or follow up'
    case 'resolved':
      return 'Resolved'
    case 'withdrawn':
      return 'Withdrawn'
  }
}

const sizeOf = (bytes: number): string =>
  bytes >= 1024 * 1024
    ? `${String(Math.round(bytes / 1024 / 1024))} MB`
    : `${String(Math.max(1, Math.round(bytes / 1024)))} KB`

/** An image of the remark being written: kept by Hemera under its id, or refused with why. */
interface Taken extends RemarkImage {
  id?: string | undefined
}

/** The images of a remark, one line each: kept with their size, refused with why. */
function Images({
  images,
  onRemove,
}: {
  images: readonly RemarkImage[]
  onRemove?: ((name: string) => void) | undefined
}): ReactNode {
  if (images.length === 0) return null
  return (
    <ul aria-label="Images of the remark" className="flex flex-col gap-0.5">
      {images.map((image) => (
        <li key={image.name} className="flex min-w-0 items-center gap-2 text-sm">
          <span
            className={cn(
              'flex shrink-0',
              image.refused === undefined ? 'text-muted-foreground' : 'text-warning',
            )}
          >
            {image.refused === undefined ? (
              <IconPhoto size="sm" />
            ) : (
              <IconAlertTriangle size="sm" />
            )}
          </span>
          <span className="min-w-0 truncate font-mono text-xs">{image.name}</span>
          <span
            className={
              image.refused === undefined
                ? QUIET
                : 'min-w-0 truncate text-xs text-warning-muted-foreground'
            }
          >
            {image.refused ?? image.size}
          </span>
          {onRemove !== undefined && (
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Remove ${image.name}`}
              className="ml-auto"
              onClick={() => onRemove(image.name)}
            >
              <IconX size="sm" />
            </Button>
          )}
        </li>
      ))}
    </ul>
  )
}

const filesOf = (list: FileList | null): File[] => (list === null ? [] : [...list])

/**
 * The field a remark is written in: a remark or a question, then the words, then the images —
 * pasted, dropped on the field, or attached. Enter adds it (Shift+Enter breaks the line); adding
 * sends nothing.
 */
export function Composer({
  follows,
  mentionables,
  onAdd,
  onAttach,
  onOpenDiff,
}: {
  /** The remark this one follows up, for a follow-up written under it. */
  follows?: string | undefined
  mentionables: readonly Mentionable[]
  onAdd: (remark: NewRemark) => void
  onAttach: (file: File) => Promise<Attached>
  onOpenDiff?: (() => void) | undefined
}): ReactNode {
  const id = useId()
  const [kind, setKind] = useState<Remark['kind']>('remark')
  const [text, setText] = useState('')
  const [images, setImages] = useState<readonly Taken[]>([])
  const take = (files: readonly File[]): void => {
    for (const file of files) {
      if (images.some((had) => had.name === file.name)) continue
      const size = sizeOf(file.size)
      void onAttach(file).then(
        (answer) => {
          const taken: Taken =
            'id' in answer
              ? { name: file.name, size, id: answer.id }
              : { name: file.name, size, refused: answer.refused }
          setImages((before) =>
            before.some((had) => had.name === file.name) ? before : [...before, taken],
          )
        },
        (failure: Error) =>
          setImages((before) => [...before, { name: file.name, size, refused: failure.message }]),
      )
    }
  }
  const add = (): void => {
    const words = text.trim()
    if (words === '') return
    const kept = images.flatMap((one) => (one.id === undefined ? [] : [one.id]))
    onAdd(
      follows === undefined
        ? { kind, text: words, images: kept }
        : { kind, text: words, images: kept, follows },
    )
    setText('')
    setImages([])
  }
  const label =
    follows !== undefined
      ? `A follow-up on ${follows}`
      : kind === 'question'
        ? 'A question for the agent'
        : 'A remark from your live test'
  return (
    <form
      aria-label={label}
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault()
        add()
      }}
      onPaste={(event: ClipboardEvent<HTMLFormElement>) => take(filesOf(event.clipboardData.files))}
      onDragOver={(event: DragEvent<HTMLFormElement>) => event.preventDefault()}
      onDrop={(event: DragEvent<HTMLFormElement>) => {
        event.preventDefault()
        take(filesOf(event.dataTransfer.files))
      }}
    >
      <MentionField
        label={label}
        placeholder={
          kind === 'question'
            ? 'What you want to understand. It gets an answer, never a change.'
            : 'What you saw. Paste or drop images here.'
        }
        value={text}
        onValueChange={(value) => setText(value)}
        mentionables={mentionables}
        onSubmit={add}
      />
      <Images
        images={images}
        onRemove={(name) => setImages((before) => before.filter((one) => one.name !== name))}
      />
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {follows === undefined && (
          <div role="group" aria-label="Kind" className="flex gap-0.5">
            {(['remark', 'question'] as const).map((one) => (
              <Button
                key={one}
                variant={kind === one ? 'secondary' : 'ghost'}
                size="sm"
                aria-pressed={kind === one}
                onClick={() => setKind(one)}
              >
                {one === 'remark' ? 'Remark' : 'Question'}
              </Button>
            ))}
          </div>
        )}
        <label
          htmlFor={`${id}-files`}
          className="flex h-control-sm cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-sm text-muted-foreground outline-none hover:tinted focus-within:focus-ring hover-motion"
        >
          <IconPhoto size="sm" />
          Attach images
          <input
            id={`${id}-files`}
            type="file"
            multiple
            className="sr-only"
            onChange={(event) => {
              take(filesOf(event.target.files))
              event.target.value = ''
            }}
          />
        </label>
        {onOpenDiff !== undefined && (
          <Button variant="ghost" size="sm" onClick={onOpenDiff}>
            <IconGitCompare size="sm" />
            Comment in the diff
          </Button>
        )}
        {text.trim() !== '' && (
          <Button
            type="submit"
            variant="secondary"
            size="sm"
            className="ml-auto"
            aria-label={kind === 'question' ? 'Add the question' : 'Add the remark'}
          >
            Add
          </Button>
        )}
      </div>
    </form>
  )
}

/**
 * A remark on one line — its mark, its id, a question's glyph, its words, its place in the code —
 * that opens to the whole of it: its words, its images, the agent's answer, and what its author
 * can do with it at this point: edit or withdraw it while it waits, resolve it or follow it up
 * once addressed.
 */
export function RemarkLine({
  remark,
  handlers,
  mentionables,
  initiallyOpen = false,
}: {
  remark: Remark
  handlers: FeedbackHandlers
  mentionables: readonly Mentionable[]
  initiallyOpen?: boolean | undefined
}): ReactNode {
  const [open, setOpen] = useState(initiallyOpen)
  const [editing, setEditing] = useState<string | null>(null)
  const [following, setFollowing] = useState(false)
  const quiet = remark.state === 'resolved' || remark.state === 'withdrawn'
  const kept = (remark.images ?? []).length
  return (
    <li className="flex flex-col border-b border-border last:border-b-0">
      <div className={MARKED}>
        <Legend label={remarkLegend(remark)}>
          <StatusMark state={MARK[remark.state]} size="sm" />
        </Legend>
        <button
          type="button"
          aria-expanded={open}
          className={cn(LINE, 'pl-2 hover:shadow-none')}
          onClick={() => setOpen(!open)}
        >
          <span className={ID}>{remark.id}</span>
          {remark.kind === 'question' && (
            <span className="flex shrink-0 text-muted-foreground">
              <IconHelpCircle size="sm" />
            </span>
          )}
          {remark.follows !== undefined && (
            <span className="flex shrink-0 items-center gap-0.5 text-xs text-muted-foreground">
              <IconArrowBackUp size="sm" />
              {remark.follows}
            </span>
          )}
          <span className="flex min-w-0 flex-1">
            <span
              className={cn(
                'min-w-0',
                open ? 'max-w-measure break-words whitespace-pre-line' : 'truncate',
                quiet && 'text-muted-foreground',
                remark.state === 'withdrawn' && 'line-through',
              )}
            >
              {remark.text}
            </span>
          </span>
          {remark.anchor !== undefined && !open && (
            <span className={cn(MONO, 'shrink')}>{remark.anchor}</span>
          )}
          {kept > 0 && (
            <span className="flex shrink-0 items-center gap-0.5 text-xs text-muted-foreground">
              <IconPhoto size="sm" />
              {kept}
            </span>
          )}
          <span className={QUIET}>{remark.at}</span>
          <Chevron open={open} />
        </button>
      </div>
      <Unfolding open={open}>
        <div className="flex flex-col gap-3 pr-4 pb-3 pl-12">
          {editing !== null && (
            <div className="flex max-w-measure flex-col gap-2">
              <Textarea label={remark.id} rows={3} value={editing} onValueChange={setEditing} />
              <div className="flex gap-2">
                <Button
                  variant="primary"
                  size="sm"
                  aria-label={`Save ${remark.id}`}
                  onClick={() => {
                    handlers.onEdit(remark.id, editing.trim())
                    setEditing(null)
                  }}
                >
                  Save
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
          {remark.anchor !== undefined && (
            <Button
              variant="link"
              size="sm"
              className="self-start"
              onClick={() => handlers.onOpenDiff(remark.anchor ?? '')}
            >
              <span className="break-all font-mono text-xs">{remark.anchor}</span>
            </Button>
          )}
          {remark.images !== undefined && <Images images={remark.images} />}
          {remark.answer !== undefined && (
            <div className="flex max-w-measure flex-col gap-1 border-l-2 border-border pl-3">
              <span className="text-xs font-medium text-muted-foreground">
                {remark.kind === 'question' ? 'The answer' : 'What the agent did'}
              </span>
              <p className={PROSE}>{remark.answer}</p>
              {remark.toMission === true && (
                <Button
                  variant="secondary"
                  size="sm"
                  className="self-start"
                  aria-label={`Start a mission from ${remark.id}`}
                  onClick={() => handlers.onStartMission(remark.id)}
                >
                  Start a mission from this
                </Button>
              )}
            </div>
          )}
          <RemarkActions
            remark={remark}
            handlers={handlers}
            editing={editing !== null}
            onEdit={() => setEditing(remark.text)}
            onFollow={() => setFollowing(!following)}
          />
          {following && (
            <div className="max-w-measure">
              <Composer
                follows={remark.id}
                mentionables={mentionables}
                onAttach={handlers.onAttach}
                onAdd={(added) => {
                  handlers.onAdd(added)
                  setFollowing(false)
                }}
              />
            </div>
          )}
        </div>
      </Unfolding>
    </li>
  )
}

/** What its author can do with a remark where it stands; nothing once it is settled. */
function RemarkActions({
  remark,
  handlers,
  editing,
  onEdit,
  onFollow,
}: {
  remark: Remark
  handlers: FeedbackHandlers
  editing: boolean
  onEdit: () => void
  onFollow: () => void
}): ReactNode {
  if (remark.state === 'resolved' || remark.state === 'withdrawn' || editing) return null
  const withdraw = (
    <Button
      variant="ghost"
      size="sm"
      aria-label={`Withdraw ${remark.id}`}
      onClick={() => handlers.onWithdraw(remark.id)}
    >
      Withdraw
    </Button>
  )
  return (
    <div className="flex flex-wrap gap-2">
      {remark.state === 'addressed' && (
        <>
          <Button
            variant="primary"
            size="sm"
            aria-label={`Resolve ${remark.id}`}
            onClick={() => handlers.onResolve(remark.id)}
          >
            Resolve
          </Button>
          <Button
            variant="secondary"
            size="sm"
            aria-label={`Follow up on ${remark.id}`}
            onClick={onFollow}
          >
            Follow up
          </Button>
        </>
      )}
      {remark.state === 'waiting' && (
        <Button variant="secondary" size="sm" aria-label={`Edit ${remark.id}`} onClick={onEdit}>
          Edit
        </Button>
      )}
      {withdraw}
    </div>
  )
}

/** What a round's line says beside its name: where it stands, and what waits in it. */
function roundWords(round: Round, remarks: readonly Remark[]): string {
  const addressed = remarks.filter((one) => one.state === 'addressed').length
  switch (round.state) {
    case 'grilling':
      return `questions before it starts · sent ${round.sentAt}`
    case 'building':
      return `Building · ${round.building ?? ''}`
    case 'back':
      return addressed > 0
        ? `back ${round.backAt ?? ''} · ${String(addressed)} to resolve`
        : `back ${round.backAt ?? ''}`
    case 'closed':
      return `closed · ${plural(remarks.length, 'remark', 'remarks')}`
  }
}

/** A round in the feedback: its line, Open round N, and its remarks under it. */
function RoundGroup({
  round,
  remarks,
  handlers,
  mentionables,
  initiallyOpen,
}: {
  round: Round
  remarks: readonly Remark[]
  handlers: FeedbackHandlers
  mentionables: readonly Mentionable[]
  initiallyOpen: boolean
}): ReactNode {
  const [open, setOpen] = useState(initiallyOpen)
  const name = `Round ${String(round.n)}`
  return (
    <Frame>
      <div className="flex min-w-0 items-center pr-2">
        <button type="button" aria-expanded={open} className={LINE} onClick={() => setOpen(!open)}>
          <Chevron open={open} />
          <span className="shrink-0 font-medium">{name}</span>
          <span className="min-w-0 truncate text-muted-foreground">
            {roundWords(round, remarks)}
          </span>
          {remarks.some((one) => one.state === 'addressed') && (
            <span
              aria-hidden="true"
              className="ml-auto size-1.5 shrink-0 rounded-full bg-warning"
            />
          )}
        </button>
        <Button variant="link" size="sm" onClick={() => handlers.onOpenRound(round.n)}>
          {`Open round ${String(round.n)}`}
        </Button>
      </div>
      <Unfolding open={open}>
        <ul aria-label={name} className="flex flex-col border-t border-border">
          {remarks.map((remark) => (
            <RemarkLine
              key={remark.id}
              remark={remark}
              handlers={handlers}
              mentionables={mentionables}
            />
          ))}
        </ul>
      </Unfolding>
    </Frame>
  )
}

/** Rows of a known shape while the page waits: a remark's line each. */
function SkeletonRows(): ReactNode {
  return (
    <Frame>
      <ul aria-label="Next round" className="flex flex-col">
        {[
          'The export keeps the previous customer’s filter',
          'The progress jumps on small exports',
          'The query reads every column',
        ].map((text, at) => (
          <li
            key={text}
            className="flex min-h-control-md items-center gap-2 border-b border-border px-4 last:border-b-0"
          >
            <Skeleton>{`F${String(at + 1)}`}</Skeleton>
            <Skeleton>{text}</Skeleton>
          </li>
        ))}
      </ul>
    </Frame>
  )
}

export interface FeedbackProps extends FeedbackHandlers {
  remarks: readonly Remark[]
  /** Whether Fix may be pressed now: the engine's word, never worked out here. */
  fixable: boolean
  rounds: readonly Round[]
  /** What the field offers after `@`: the Project's missions and commands. */
  mentionables: readonly Mentionable[]
  loading?: boolean | undefined
}

/** The feedback by round: the field, the next round with Fix, then the rounds, newest first. */
export function Feedback({
  remarks,
  fixable,
  rounds,
  mentionables,
  loading = false,
  ...handlers
}: FeedbackProps): ReactNode {
  const waiting = remarks.filter((one) => one.state === 'waiting')
  const next = (rounds[0]?.n ?? 0) + 1
  return (
    <section
      aria-label="Feedback"
      aria-busy={loading ? 'true' : undefined}
      className="flex flex-col gap-4"
    >
      <SectionHead
        title="Feedback"
        count={loading ? undefined : remarks.filter((one) => one.state !== 'withdrawn').length}
      />
      <Frame>
        <div className="px-4 py-3">
          <Composer
            mentionables={mentionables}
            onAdd={handlers.onAdd}
            onAttach={handlers.onAttach}
            onOpenDiff={() => handlers.onOpenDiff('')}
          />
        </div>
      </Frame>
      {loading ? (
        <SkeletonRows />
      ) : (
        <>
          {waiting.length > 0 && (
            <div className="flex flex-col gap-2">
              <div className="flex min-h-control-md items-center gap-3">
                <h3 className="text-sm font-semibold">Next round</h3>
                <span className={QUIET}>{plural(waiting.length, 'waits', 'wait')} to be sent</span>
                {fixable && (
                  <Button variant="primary" size="sm" className="ml-auto" onClick={handlers.onFix}>
                    {`Fix · round ${String(next)}`}
                  </Button>
                )}
              </div>
              <Frame>
                <ul aria-label="Next round" className="flex flex-col">
                  {waiting.map((remark) => (
                    <RemarkLine
                      key={remark.id}
                      remark={remark}
                      handlers={handlers}
                      mentionables={mentionables}
                    />
                  ))}
                </ul>
              </Frame>
            </div>
          )}
          {rounds.map((round, at) => (
            <RoundGroup
              key={round.n}
              round={round}
              remarks={remarks.filter((one) => one.round === round.n && one.state !== 'waiting')}
              handlers={handlers}
              mentionables={mentionables}
              initiallyOpen={at === 0}
            />
          ))}
        </>
      )}
    </section>
  )
}
