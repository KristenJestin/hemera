import { AnimatePresence, motion } from 'motion/react'
import { type ReactNode, useState } from 'react'

import { Button } from '../../components/button/button.tsx'
import { Textarea } from '../../components/field/field.tsx'
import { Frame, FrameFooter, FrameHeader } from '../../components/frame/frame.tsx'
import { Loading } from '../../components/loading/loading.tsx'
import { Legend } from '../../components/tooltip/legend.tsx'
import { IconBan, IconCheck, IconMessages } from '../../icons.ts'
import { collapse, expand, fold, useTransition } from '../../motion.ts'
import {
  type Proposal,
  ProposalEditor,
  ProposalSkeleton,
  ProposalSummary,
  SETUP_TITLES,
  type SetupKind,
  setupIcon,
} from './proposal.tsx'

/**
 * A card of the setup: what the setup agent proposes for one part of a new Project, and the user's
 * answer to it.
 *
 * The card is a frame: its kind's glyph and name above, the proposal in short in the body, and the
 * answers below — Accept, the primary; Edit, which turns the body into the proposal's lines,
 * written in place; Discuss, which asks the agent for another proposal in the user's words; and
 * Decline, at the far end. While the agent is still reading, the body is the proposal's own shape.
 *
 * Accepted, the card goes quiet: its answers leave, its words take the muted tone, and a check
 * stands at the end of its head; declined, the same with the declined glyph and the one answer left,
 * Propose again. Discussed, the user's words stand under the proposal while the agent writes
 * another. An answer the engine refuses is said above the answers, in its words, and the card
 * stays as it was.
 *
 * What changes in the card — the proposal giving way to its editor, the answers giving way to
 * others, the discussion opening — folds in and out by its own height on `fold`, so the card grows
 * and shrinks and pushes what stands under it; nothing is scaled.
 */
export type CardStatus =
  /** The agent is still reading: the proposal's own shape. */
  | { readonly state: 'reading' }
  | {
      readonly state: 'proposed'
      /** Why the engine refused the last Accept, in its words. */
      readonly refused?: string | undefined
      /** Whether the Accept is on its way to the engine. */
      readonly accepting?: boolean | undefined
    }
  | { readonly state: 'editing'; readonly refused?: string | undefined }
  /** The user is writing what should change. */
  | { readonly state: 'discussing' }
  /** The user said what should change; the agent is writing another proposal. */
  | { readonly state: 'discussed'; readonly note: string }
  | { readonly state: 'accepted' }
  | { readonly state: 'declined' }

export interface SetupCardProps {
  kind: SetupKind
  status: CardStatus
  /** What the agent proposes; null while it is still reading. */
  proposal: Proposal | null
  /** What the editor holds while the card is edited. */
  draft?: Proposal | undefined
  onDraft?: ((draft: Proposal) => void) | undefined
  onAccept: () => void
  /** Left out where the agent takes no edit: no Edit then. */
  onEdit?: (() => void) | undefined
  /** Left out where the agent takes no discussion: no Discuss then. */
  onDiscuss?: (() => void) | undefined
  onDecline: () => void
  onSave: () => void
  onCancel: () => void
  /** Sends what should change to the agent. */
  onSend: (note: string) => void
  /** Left out where the agent writes no new proposal: nothing once declined then. */
  onProposeAgain?: (() => void) | undefined
}

const REFUSAL = 'w-full text-sm text-destructive-muted-foreground'

const QUIET = 'flex flex-col text-muted-foreground'

/** A part that folds in and out, clipped to the height it travels through. */
const FOLDING = 'overflow-hidden'

/** A part of the card that folds in and out on `fold` when what it shows changes. */
function Folding({ show, children }: { show: string | null; children: ReactNode }): ReactNode {
  const folding = useTransition(fold)
  return (
    <AnimatePresence initial={false}>
      {show !== null && (
        <motion.div
          key={show}
          className={FOLDING}
          initial={collapse}
          animate={expand}
          exit={collapse}
          transition={folding}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

const NOTE =
  'mx-3 my-2 flex flex-col gap-2 rounded-md border border-border bg-muted px-3 py-2 text-sm'

/** The glyph at the end of the head that says how the card was answered. */
function Answered({ status }: { status: CardStatus }): ReactNode {
  if (status.state === 'accepted') {
    return (
      <Legend label="Accepted">
        <span className="inline-flex text-success" aria-hidden="true">
          <IconCheck size="sm" />
        </span>
      </Legend>
    )
  }
  if (status.state === 'declined') {
    return (
      <Legend label="Declined">
        <span className="inline-flex text-muted-foreground" aria-hidden="true">
          <IconBan size="sm" />
        </span>
      </Legend>
    )
  }
  if (status.state === 'discussed') {
    return (
      <Legend label="Discussed with the setup agent">
        <span className="inline-flex text-primary-muted-foreground" aria-hidden="true">
          <IconMessages size="sm" />
        </span>
      </Legend>
    )
  }
  return undefined
}

/** What should change, in the user's words, before it is sent. */
function DiscussField({
  kind,
  onSend,
  onCancel,
}: {
  kind: SetupKind
  onSend: (note: string) => void
  onCancel: () => void
}): ReactNode {
  const [note, setNote] = useState('')
  return (
    <div className="flex flex-col gap-3 border-t border-border p-3">
      <Textarea
        label={`What should change in ${SETUP_TITLES[kind]}`}
        rows={2}
        value={note}
        onValueChange={setNote}
      />
      <div className="flex items-center gap-2">
        {note.trim() !== '' && (
          <Button variant="primary" size="sm" onClick={() => onSend(note.trim())}>
            Send
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

function Answers({
  status,
  onAccept,
  onEdit,
  onDiscuss,
  onDecline,
  onSave,
  onCancel,
  onProposeAgain,
}: Pick<
  SetupCardProps,
  | 'status'
  | 'onAccept'
  | 'onEdit'
  | 'onDiscuss'
  | 'onDecline'
  | 'onSave'
  | 'onCancel'
  | 'onProposeAgain'
>): ReactNode {
  switch (status.state) {
    case 'proposed':
      return (
        <FrameFooter>
          {status.refused !== undefined && (
            <p role="alert" className={REFUSAL}>
              {status.refused}
            </p>
          )}
          <Button
            variant="primary"
            size="sm"
            state={status.accepting === true ? 'loading' : 'idle'}
            onClick={onAccept}
          >
            Accept
          </Button>
          {onEdit !== undefined && (
            <Button size="sm" onClick={onEdit}>
              Edit
            </Button>
          )}
          {onDiscuss !== undefined && (
            <Button variant="ghost" size="sm" onClick={onDiscuss}>
              Discuss
            </Button>
          )}
          <Button variant="ghost" size="sm" className="ml-auto" onClick={onDecline}>
            Decline
          </Button>
        </FrameFooter>
      )
    case 'editing':
      return (
        <FrameFooter>
          {status.refused !== undefined && (
            <p role="alert" className={REFUSAL}>
              {status.refused}
            </p>
          )}
          <Button variant="primary" size="sm" onClick={onSave}>
            Save
          </Button>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        </FrameFooter>
      )
    case 'declined':
      return onProposeAgain === undefined ? undefined : (
        <FrameFooter>
          <Button variant="ghost" size="sm" onClick={onProposeAgain}>
            Propose again
          </Button>
        </FrameFooter>
      )
    default:
      return undefined
  }
}

/** Which answers the card offers, by group; null when it offers none. */
function answersOf(status: CardStatus, proposesAgain: boolean): string | null {
  if (status.state === 'proposed' || status.state === 'editing') return status.state
  if (status.state === 'declined' && proposesAgain) return status.state
  return null
}

/** What the body shows: the proposal's shape, its editor, or the proposal itself. */
function modeOf(status: CardStatus, proposal: Proposal | null): string {
  if (status.state === 'reading' || proposal === null) return 'reading'
  return status.state === 'editing' ? 'editing' : 'proposal'
}

export function SetupCard({
  kind,
  status,
  proposal,
  draft,
  onDraft,
  onSend,
  ...on
}: SetupCardProps): ReactNode {
  const title = SETUP_TITLES[kind]
  const quiet = status.state === 'accepted' || status.state === 'declined'
  const body = ((): ReactNode => {
    if (status.state === 'reading' || proposal === null) return <ProposalSkeleton kind={kind} />
    if (status.state === 'editing' && draft !== undefined && onDraft !== undefined) {
      return <ProposalEditor draft={draft} onChange={onDraft} />
    }
    const summary = <ProposalSummary proposal={proposal} />
    if (quiet) return <div className={QUIET}>{summary}</div>
    return (
      <>
        {summary}
        <Folding
          show={status.state === 'discussing' || status.state === 'discussed' ? status.state : null}
        >
          {status.state === 'discussing' && (
            <DiscussField kind={kind} onSend={onSend} onCancel={on.onCancel} />
          )}
          {status.state === 'discussed' && (
            <div className={NOTE} data-note="">
              <p className="whitespace-pre-line">{status.note}</p>
              <span className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loading size="sm" label="The setup agent is writing another proposal" />
              </span>
            </div>
          )}
        </Folding>
      </>
    )
  })()
  return (
    <section
      aria-label={title}
      aria-busy={status.state === 'reading'}
      data-setup-card={kind}
      data-card-state={status.state}
    >
      <Frame
        header={
          <FrameHeader
            icon={<span className="flex text-muted-foreground">{setupIcon(kind)}</span>}
            title={title}
            action={<Answered status={status} />}
          />
        }
        footer={
          <Folding show={answersOf(status, on.onProposeAgain !== undefined)}>
            <Answers status={status} {...on} />
          </Folding>
        }
      >
        <Folding show={modeOf(status, proposal)}>{body}</Folding>
      </Frame>
    </section>
  )
}
