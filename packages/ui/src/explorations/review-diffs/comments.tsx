import { cn } from 'cn'
import { motion } from 'motion/react'
import { type ReactNode, useEffect, useRef, useState } from 'react'

import { Button } from '../../components/button/button.tsx'
import { Textarea } from '../../components/field/field.tsx'
import { LetterAvatar } from '../../components/letter-avatar/letter-avatar.tsx'
import { type MarkState, StatusMark } from '../../components/status-mark/status-mark.tsx'
import { Legend } from '../../components/tooltip/legend.tsx'
import {
  IconArrowsVertical,
  IconBrandGithub,
  IconCheck,
  IconHelpCircle,
  IconHistory,
} from '../../icons.ts'
import { collapse, expand, fold, useTransition } from '../../motion.ts'
import { CODE, Chevron, ID, PROSE, QUIET, Unfolding } from '../review/parts.tsx'
import type { RemarkState } from '../review/types.ts'
import type { DiffComment, Place } from './types.ts'

/**
 * A comment as it is read under the lines it is about, in the manner of a pull request page.
 *
 * The user's comments are the remarks of the Review page (#254) with a place in the code: the
 * same id, the same mark, the same words for each state, and the same actions where it stands —
 * Edit and Withdraw while it waits, Withdraw while a round works on it, Resolve, Follow up and
 * Withdraw once addressed, nothing once settled. Under it, the agent's answer. A team member's
 * comment comes from the forge with its author, and a link back there. What is settled —
 * resolved, withdrawn, resolved on the forge — folds to its line, so the diff reads through it.
 */

export type CommentAction = 'edit' | 'withdraw' | 'resolve' | 'follow'

const MARK: Record<RemarkState, MarkState> = {
  waiting: 'todo',
  inRound: 'running',
  addressed: 'waiting',
  resolved: 'done',
  withdrawn: 'skipped',
}

/** What a comment's mark says, in the words of the Review page. */
export function commentLegend(comment: DiffComment): string {
  if (comment.team !== undefined) {
    return comment.team.resolved ? 'Resolved on the forge' : `Open on ${comment.team.forge}`
  }
  switch (comment.state) {
    case 'waiting':
      return 'Waiting for the next round'
    case 'inRound':
      return `In round ${String(comment.round ?? '')}`
    case 'addressed':
      return 'Addressed: resolve it or follow up'
    case 'resolved':
      return 'Resolved'
    case 'withdrawn':
      return 'Withdrawn'
  }
}

/** The lines of a place as a reader reads them: `57`, `57–60`, or the whole file. */
export function linesOf(place: Place): string {
  if (place.lines === null) return 'Whole file'
  const { start, end } = place.lines
  return start === end ? `Line ${String(start)}` : `Lines ${String(start)}–${String(end)}`
}

/** Whether a comment folds to its line: it is settled, here or on the forge. */
export const settled = (comment: DiffComment): boolean =>
  comment.team?.resolved === true || comment.state === 'resolved' || comment.state === 'withdrawn'

const CARD =
  'flex min-w-0 flex-col rounded-lg border border-border bg-card font-sans text-sm text-foreground shadow-sm data-[lit=true]:ring-2 data-[lit=true]:ring-ring'

const HEAD = 'flex min-h-control-md min-w-0 items-center gap-2 px-3 py-1'

const FOLDED =
  'flex min-h-control-md min-w-0 flex-1 items-center gap-2 rounded-lg px-3 py-1 text-left outline-none hover:tinted focus-ring hover-motion'

/** Who wrote it: the user, or the team member from the forge, with their letters. */
function Author({ comment }: { comment: DiffComment }): ReactNode {
  if (comment.team === undefined) return <span className="shrink-0 font-medium">You</span>
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      <LetterAvatar name={comment.team.name} />
      <span className="font-medium">{comment.team.name}</span>
    </span>
  )
}

/** The marks of the head: its state, a question, moved with its lines, outdated. */
function Marks({ comment }: { comment: DiffComment }): ReactNode {
  return (
    <>
      <Legend label={commentLegend(comment)}>
        {comment.team?.resolved === true ? (
          <span className="flex text-success">
            <IconCheck size="sm" />
          </span>
        ) : (
          <StatusMark state={comment.team === undefined ? MARK[comment.state] : 'idle'} size="sm" />
        )}
      </Legend>
      <span className={ID}>{comment.id}</span>
      {comment.kind === 'question' && (
        <Legend label="A question: it gets an answer, never a change">
          <span className="flex text-muted-foreground">
            <IconHelpCircle size="sm" />
          </span>
        </Legend>
      )}
    </>
  )
}

/** What its author can do with it where it stands; nothing once it is settled. */
function Actions({
  comment,
  writable,
  onAction,
}: {
  comment: DiffComment
  writable: boolean
  onAction: (id: string, action: CommentAction) => void
}): ReactNode {
  if (!writable || comment.team !== undefined || settled(comment)) return null
  const button = (
    action: CommentAction,
    words: string,
    variant: 'primary' | 'secondary' | 'ghost',
  ) => (
    <Button
      key={action}
      variant={variant}
      size="sm"
      aria-label={`${words} ${comment.id}`}
      onClick={() => onAction(comment.id, action)}
    >
      {words}
    </Button>
  )
  return (
    <div className="flex flex-wrap gap-2 px-3 pb-3">
      {comment.state === 'addressed' && button('resolve', 'Resolve', 'primary')}
      {comment.state === 'addressed' && button('follow', 'Follow up', 'secondary')}
      {comment.state === 'waiting' && button('edit', 'Edit', 'secondary')}
      {button('withdraw', 'Withdraw', 'ghost')}
    </div>
  )
}

export interface CommentCardProps {
  comment: DiffComment
  /** Sent here from the Review page, or from the tree: wears the focus ring while it is. */
  lit?: boolean | undefined
  writable: boolean
  onAction: (id: string, action: CommentAction) => void
  onOpenVersion: (id: string) => void
  onOpenForge: (url: string) => void
}

export function CommentCard({
  comment,
  lit = false,
  writable,
  onAction,
  onOpenVersion,
  onOpenForge,
}: CommentCardProps): ReactNode {
  const folds = settled(comment)
  const [open, setOpen] = useState(!folds || lit)
  const quiet = folds ? 'text-muted-foreground' : undefined
  const struck = comment.state === 'withdrawn' && comment.team === undefined
  const name = `${comment.id}, ${commentLegend(comment).toLowerCase()}`
  return (
    <article aria-label={name} data-comment={comment.id} data-lit={lit} className={CARD}>
      {folds ? (
        <div className="flex min-w-0 items-center">
          <span className="flex shrink-0 items-center gap-2 pl-3">
            <Marks comment={comment} />
          </span>
          <button
            type="button"
            aria-expanded={open}
            aria-label={`${open ? 'Fold' : 'Open'} ${comment.id}`}
            className={cn(FOLDED, 'pl-2')}
            onClick={() => setOpen(!open)}
          >
            <Author comment={comment} />
            <span className={cn('min-w-0 flex-1 truncate', quiet, struck && 'line-through')}>
              {comment.text}
            </span>
            <span className={QUIET}>{comment.at}</span>
            <Chevron open={open} />
          </button>
        </div>
      ) : (
        <div className={HEAD}>
          <Marks comment={comment} />
          <Author comment={comment} />
          <span className={QUIET}>{linesOf(comment.place)}</span>
          {comment.movedFrom !== undefined && (
            <Legend
              label={`Moved with its lines: written on line ${String(comment.movedFrom.start)}`}
            >
              <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
                <IconArrowsVertical size="sm" />
                {String(comment.movedFrom.start)}
              </span>
            </Legend>
          )}
          {comment.outdated !== undefined && (
            <Legend label="Outdated: its lines changed since it was written">
              <span className="flex text-warning">
                <IconHistory size="sm" />
              </span>
            </Legend>
          )}
          <span className={cn(QUIET, 'ml-auto')}>{comment.at}</span>
        </div>
      )}
      <Unfolding open={!folds || open}>
        <div className="flex min-w-0 flex-col gap-3 px-3 pb-3">
          {folds && <span className={QUIET}>{linesOf(comment.place)}</span>}
          <p className={cn(PROSE, quiet, struck && 'line-through')}>{comment.text}</p>
          {comment.outdated !== undefined && (
            <div className="flex max-w-measure min-w-0 flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">
                {`Written on ${comment.outdated.version}`}
              </span>
              <pre className={CODE}>{comment.outdated.excerpt.trimEnd()}</pre>
              <Button
                variant="link"
                size="sm"
                className="self-start"
                onClick={() => onOpenVersion(comment.id)}
              >
                Open the commented version
              </Button>
            </div>
          )}
          {(comment.thread ?? []).map((reply) => (
            <div
              key={`${reply.who}-${reply.at}`}
              className="flex max-w-measure flex-col gap-1 border-l-2 border-border pl-3"
            >
              <span className="text-xs font-medium text-muted-foreground">
                {reply.who === 'you'
                  ? 'Your follow-up'
                  : comment.kind === 'question'
                    ? 'The answer'
                    : 'What the agent did'}
                <span className="font-normal">{` · ${reply.at}`}</span>
              </span>
              <p className={PROSE}>{reply.text}</p>
            </div>
          ))}
          {comment.team !== undefined && (
            <Button
              variant="link"
              size="sm"
              className="self-start"
              onClick={() => onOpenForge(comment.team?.url ?? '')}
            >
              <IconBrandGithub size="sm" />
              {`Open on ${comment.team.forge}`}
            </Button>
          )}
        </div>
        <Actions comment={comment} writable={writable} onAction={onAction} />
      </Unfolding>
    </article>
  )
}

/** The comments that end on one line, one under the other, the oldest first. */
export function CommentStack(
  props: Omit<CommentCardProps, 'comment' | 'lit'> & {
    comments: readonly DiffComment[]
    lit: string | null
  },
): ReactNode {
  const { comments, lit, ...rest } = props
  return (
    <div className="flex min-w-0 flex-col gap-2 px-3 py-2">
      {comments.map((comment) => (
        <CommentCard key={comment.id} comment={comment} lit={lit === comment.id} {...rest} />
      ))}
    </div>
  )
}

export interface NewComment {
  kind: DiffComment['kind']
  text: string
  place: Place
}

/**
 * The box a comment is written in, opened under the lines it is about or at the head of a file:
 * a remark or a question, then the words. Enter adds it (Shift+Enter breaks the line), Escape
 * lets it go; adding sends nothing: it waits for the next round, as on the Review page.
 */
export function CommentBox({
  place,
  where,
  onAdd,
  onCancel,
}: {
  place: Place
  /** The file and lines in words, which name the field. */
  where: string
  onAdd: (comment: NewComment) => void
  onCancel: () => void
}): ReactNode {
  const [kind, setKind] = useState<DiffComment['kind']>('remark')
  const [text, setText] = useState('')
  const form = useRef<HTMLFormElement>(null)
  useEffect(() => {
    form.current?.querySelector('textarea')?.focus({ preventScroll: true })
  }, [])
  const add = (): void => {
    const words = text.trim()
    if (words === '') return
    onAdd({ kind, text: words, place })
  }
  const label = `${kind === 'question' ? 'A question on' : 'A comment on'} ${where}`
  const growing = useTransition(fold)
  return (
    // It grows from the line it is about, pushing the lines under it rather than jumping them.
    <motion.div
      className="overflow-hidden px-3 py-2"
      initial={collapse}
      animate={expand}
      transition={growing}
    >
      <form
        ref={form}
        aria-label={label}
        className="flex max-w-measure flex-col gap-2 rounded-lg border border-border bg-card p-3 font-sans shadow-sm"
        onSubmit={(event) => {
          event.preventDefault()
          add()
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            onCancel()
            return
          }
          if (event.key !== 'Enter' || event.shiftKey) return
          if (!(event.target instanceof HTMLTextAreaElement)) return
          event.preventDefault()
          add()
        }}
      >
        <Textarea
          label={label}
          rows={2}
          placeholder={
            kind === 'question'
              ? 'What you want to understand. It gets an answer, never a change.'
              : 'What should change here.'
          }
          value={text}
          onValueChange={setText}
        />
        <div className="flex min-w-0 flex-wrap items-center gap-2">
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
          <span className="ml-auto flex gap-2">
            <Button variant="ghost" size="sm" onClick={onCancel}>
              Cancel
            </Button>
            {text.trim() !== '' && (
              <Button
                type="submit"
                variant="primary"
                size="sm"
                aria-label={kind === 'question' ? 'Add the question' : 'Add the comment'}
              >
                Add
              </Button>
            )}
          </span>
        </div>
      </form>
    </motion.div>
  )
}
