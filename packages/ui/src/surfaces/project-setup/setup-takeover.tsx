import { Dialog as BaseDialog } from '@base-ui/react/dialog'
import { cn } from 'cn'
import { type ReactNode, useRef } from 'react'

import { Button } from '../../components/button/button.tsx'
import { Face } from '../../components/face/face.tsx'
import type { FaceState } from '../../components/face/states.ts'
import { IconCheck, IconFolder } from '../../icons.ts'
import { useOverlayContainer } from '../../overlay.ts'
import {
  AgentMark,
  allAnswered,
  type ProjectSetupProps,
  SetupBody,
  type SetupCardEntry,
  shownCards,
} from './project-setup.tsx'

/**
 * A Project being set up: a one-time step, drawn as onboarding rather than as a page of the
 * Project. It takes the window over — the sidebar and the Project behind it dimmed, a narrower
 * column in the middle — and never stands in the trail.
 *
 * Its header names it ("Setting up Acme") with Hemera's face beside the setup agent's state, and
 * how many proposals are answered. The cards follow, one column. At its foot, Finish later closes
 * it (the Project's settings keep a way back while a proposal waits) and, once every proposal is
 * answered, Done leads to the Project. Escape is Finish later. It arrives and leaves on the
 * dialog's own rise; nothing else moves.
 */
export interface SetupTakeoverProps extends Omit<ProjectSetupProps, 'creating' | 'onCreate'> {
  /** The Project's name: "Setting up Acme". */
  project: string
  open: boolean
  /** Closes it; what waits stays to be answered from the Project's settings. */
  onFinishLater: () => void
  /** Every proposal answered: the Project's page. */
  onDone: () => void
  /** It has left the window, once closed: where the window goes next. */
  onClosed?: (() => void) | undefined
}

/** How many of the proposals shown have their answer, of how many. */
export interface SetupProgressCount {
  readonly answered: number
  readonly total: number
}

/** How many of the proposals shown have their answer, of how many. */
export function setupProgress(cards: readonly SetupCardEntry[]): SetupProgressCount {
  return {
    answered: cards.filter(
      (card) => card.status.state === 'accepted' || card.status.state === 'declined',
    ).length,
    total: cards.length,
  }
}

/** Hemera's face, as the setup stands: reading, asking, done, stopped, or waiting for a slot. */
export function setupFace(
  agent: ProjectSetupProps['agent'],
  cards: readonly SetupCardEntry[],
): FaceState {
  if (agent === 'failed') return 'error'
  if (agent === 'waiting') return 'asleep'
  if (agent === 'working') return 'reading'
  return allAnswered(cards) ? 'done' : 'question'
}

const SEGMENTS = 'flex h-1 min-w-0 flex-1 gap-1'
const SEGMENT = 'h-full min-w-0 flex-1 rounded-full bg-muted'
const SEGMENT_DONE = 'primary-fill'

/** "3 of 5 proposals answered", and one mark per proposal, filled once it is answered. */
export function SetupProgress({ cards }: { cards: readonly SetupCardEntry[] }): ReactNode {
  const { answered, total } = setupProgress(cards)
  if (total === 0) return null
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span className="shrink-0 text-sm text-muted-foreground tabular-nums">
        {answered} of {total} proposals answered
      </span>
      <span className={SEGMENTS} aria-hidden="true">
        {cards.map((card) => (
          <span
            key={card.kind}
            className={cn(
              SEGMENT,
              (card.status.state === 'accepted' || card.status.state === 'declined') &&
                SEGMENT_DONE,
            )}
          />
        ))}
      </span>
    </div>
  )
}

/** The head of a setup, in either of its views: who, what, where the agent stands, how far. */
export function SetupHead({
  project,
  folder,
  agent,
  startedAt,
  endedAt,
  glance,
  cards,
  onAcceptAll,
  title,
}: Pick<
  SetupTakeoverProps,
  'project' | 'folder' | 'agent' | 'startedAt' | 'endedAt' | 'glance' | 'cards' | 'onAcceptAll'
> & {
  /** The heading, as the view names it to a reader. */
  title: ReactNode
}): ReactNode {
  const shown = shownCards(agent, cards)
  const waiting = shown.some((card) => card.status.state === 'proposed')
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex min-w-0 items-center gap-3">
        <Face state={setupFace(agent, shown)} size="md" label={`Hemera, setting up ${project}`} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {title}
          <span className="flex min-w-0 items-center gap-1.5 font-mono text-xs text-muted-foreground">
            <IconFolder size="sm" aria-hidden="true" />
            <span className="sr-only">Folder:</span>
            <span className="truncate">{folder}</span>
          </span>
        </div>
        <span className="flex shrink-0 items-center gap-1.5">
          <AgentMark agent={agent} startedAt={startedAt} endedAt={endedAt} glance={glance} />
          {waiting && (
            <Button onClick={onAcceptAll}>
              <IconCheck size="sm" aria-hidden="true" />
              Accept all
            </Button>
          )}
        </span>
      </div>
      <SetupProgress cards={shown} />
    </div>
  )
}

/** The foot of a setup: Finish later, and Done once every proposal is answered. */
export function SetupFoot({
  agent,
  cards,
  onFinishLater,
  onDone,
}: Pick<SetupTakeoverProps, 'agent' | 'cards' | 'onFinishLater' | 'onDone'>): ReactNode {
  const shown = shownCards(agent, cards)
  const done = agent !== 'waiting' && agent !== 'working' && shown.length > 0 && allAnswered(shown)
  return (
    <>
      <Button variant="ghost" onClick={onFinishLater}>
        Finish later
      </Button>
      {done && (
        <Button variant="primary" onClick={onDone}>
          Done
        </Button>
      )}
    </>
  )
}

const BACKDROP =
  'fixed inset-0 bg-overlay backdrop-blur-xs backdrop-motion data-starting-style:opacity-0 data-ending-style:opacity-0'

const TAKEOVER =
  'fixed inset-0 mx-auto flex w-full max-w-3xl flex-col border-x border-border bg-surface-content text-foreground shadow-lg outline-none translate-y-0 popup-motion data-starting-style:translate-y-4 data-starting-style:opacity-0 data-ending-style:translate-y-4 data-ending-style:opacity-0'

const SECTION = 'shrink-0 px-8'

export function SetupTakeover(props: SetupTakeoverProps): ReactNode {
  const { project, open, onFinishLater, onClosed } = props
  const container = useOverlayContainer()
  // It opens on its heading: the agent's chip, first to take the focus otherwise, would open its
  // tooltip by itself.
  const heading = useRef<HTMLHeadingElement>(null)
  return (
    <BaseDialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onFinishLater()
      }}
      onOpenChangeComplete={(next) => {
        if (!next) onClosed?.()
      }}
    >
      <BaseDialog.Portal container={container}>
        <BaseDialog.Backdrop className={BACKDROP} />
        <BaseDialog.Popup className={TAKEOVER} initialFocus={heading} data-setup-takeover="">
          <div className={cn(SECTION, 'border-b border-border pt-8 pb-5')}>
            <SetupHead
              {...props}
              title={
                <BaseDialog.Title
                  ref={heading}
                  tabIndex={-1}
                  className="truncate text-2xl font-semibold tracking-tight outline-none"
                >
                  Setting up {project}
                </BaseDialog.Title>
              }
            />
            <BaseDialog.Description className="sr-only">
              A one-time step: answer what the setup agent proposes for this Project.
            </BaseDialog.Description>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-auto px-8 py-6 scrollbar-stable">
            <SetupBody {...props} narrow />
          </div>
          <div className={cn(SECTION, 'flex justify-end gap-2 border-t border-border py-4')}>
            <SetupFoot {...props} />
          </div>
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  )
}

/**
 * Where a setup left for later waits, at the top of the Project's settings: what the agent still
 * proposes, and Review, which opens the setup again.
 */
export function SetupWaiting({
  proposals,
  onReview,
}: {
  /** How many proposals still wait for an answer. */
  proposals: number
  onReview: () => void
}): ReactNode {
  return (
    <div
      role="status"
      className="flex min-w-0 items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm"
    >
      <Face state="question" size="sm" label="Hemera" />
      <span className="min-w-0 flex-1 truncate">
        The agent proposes {proposals} {proposals === 1 ? 'change' : 'changes'}
      </span>
      <Button size="sm" variant="link" onClick={onReview}>
        Review
      </Button>
    </div>
  )
}
