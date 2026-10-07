import type { ReactNode } from 'react'

import { NeedCard } from '../../blocks/need/need-card.tsx'
import { type Proposal, type SetupKind } from '../../blocks/setup/proposal.tsx'
import { type CardStatus, SetupCard } from '../../blocks/setup/setup-card.tsx'
import { Button } from '../../components/button/button.tsx'
import { LiveChip } from '../../components/live-chip/live-chip.tsx'
import type { LiveGlance } from '../../components/live-chip/live-chip-glance.tsx'
import { Legend } from '../../components/tooltip/legend.tsx'
import { IconCheck, IconClockPause, IconFolder, IconSearch } from '../../icons.ts'
import { Page, PageHeader } from '../page.tsx'

/**
 * A new Project, set up: the folder chosen, and what the setup agent proposes for it, a card per
 * part — its repositories, its commands with their roles, its preparation, its variables, what it
 * never runs.
 *
 * The header is "New Project" and the folder's path; at its end, what the setup agent is doing —
 * its chip while it reads, its glyph while it waits for a free slot — and what can be done with
 * every card at once: Accept all while a card waits for an answer, Create the Project once every
 * card is answered. Accept all accepts the cards in their order and stops at the first the engine
 * refuses, which says why on itself.
 *
 * The cards stand in a grid, two by two where the window is wide, each as tall as what it holds.
 * A card still being read is its own shape; the cards arrive in batches as the agent writes them.
 * If the agent stops, a Project need says so above the cards, with Try again; the cards it had
 * written stay, the others are not drawn.
 */
export type SetupAgent = 'waiting' | 'working' | 'done' | 'failed'

export interface SetupCardEntry {
  kind: SetupKind
  status: CardStatus
  proposal: Proposal | null
  /** What the card's editor holds while it is edited. */
  draft?: Proposal | undefined
}

export interface ProjectSetupProps {
  /** The folder chosen, as it is written on this machine. */
  folder: string
  agent: SetupAgent
  /** When the setup agent started, in milliseconds since the epoch. */
  startedAt: number
  /** When it ended; null while it works. */
  endedAt: number | null
  /** Why the agent stopped, in words. */
  failure?: string | undefined
  /** What its chip opens: the agent, where it stands and its step. Left out, a tooltip. */
  glance?: LiveGlance | undefined
  cards: readonly SetupCardEntry[]
  /** Whether the Project is being created. */
  creating?: boolean | undefined
  /** Why the Project was not created, in words. */
  refused?: string | undefined
  onAcceptAll: () => void
  onCreate: () => void
  onRetry: () => void
  onAccept: (kind: SetupKind) => void
  /** Left out where the agent takes no edit. */
  onEdit?: ((kind: SetupKind) => void) | undefined
  onDraft: (kind: SetupKind, draft: Proposal) => void
  /** Left out where the agent takes no discussion. */
  onDiscuss?: ((kind: SetupKind) => void) | undefined
  onDecline: (kind: SetupKind) => void
  onSave: (kind: SetupKind) => void
  onCancel: (kind: SetupKind) => void
  onSend: (kind: SetupKind, note: string) => void
  /** Left out where the agent writes no new proposal. */
  onProposeAgain?: ((kind: SetupKind) => void) | undefined
}

const ABOUT = 'flex min-w-0 items-center gap-1.5 font-mono text-xs'

const GRID = 'grid grid-cols-1 items-start gap-6 xl:grid-cols-2'

const COLUMN = 'flex flex-col gap-6'

const REFUSAL = 'text-sm text-destructive-muted-foreground'

/** Whether every card has its answer. */
export function allAnswered(cards: readonly SetupCardEntry[]): boolean {
  return cards.every((card) => card.status.state === 'accepted' || card.status.state === 'declined')
}

/** The chip's state for each state of the agent past waiting. */
const CHIP_STATES = { working: 'running', done: 'finished', failed: 'failed' } as const

/** What the setup agent is doing, at the end of the header. */
export function AgentMark({
  agent,
  startedAt,
  endedAt,
  glance,
}: Pick<ProjectSetupProps, 'agent' | 'startedAt' | 'endedAt' | 'glance'>): ReactNode {
  if (agent === 'waiting') {
    return (
      <Legend label="Setup agent, waiting for a free slot">
        <span className="inline-flex text-muted-foreground" aria-hidden="true">
          <IconClockPause size="sm" />
        </span>
      </Legend>
    )
  }
  return (
    <LiveChip
      name="Setup agent"
      icon={<IconSearch size="sm" />}
      state={CHIP_STATES[agent]}
      startedAt={startedAt}
      endedAt={endedAt}
      glance={glance}
    />
  )
}

/** The cards shown: once the agent stopped, those it had not written are not drawn. */
export const shownCards = (
  agent: SetupAgent,
  cards: readonly SetupCardEntry[],
): readonly SetupCardEntry[] =>
  agent === 'failed' ? cards.filter((card) => card.status.state !== 'reading') : cards

/** What the cards' answers and the agent's state say, under a setup's header: shared by its views. */
export type SetupBodyProps = Pick<
  ProjectSetupProps,
  | 'agent'
  | 'failure'
  | 'cards'
  | 'refused'
  | 'onRetry'
  | 'onAccept'
  | 'onEdit'
  | 'onDraft'
  | 'onDiscuss'
  | 'onDecline'
  | 'onSave'
  | 'onCancel'
  | 'onSend'
  | 'onProposeAgain'
> & {
  /** One column, where the view is narrow; two by two where the window is wide otherwise. */
  narrow?: boolean | undefined
}

/** The refusal of the last answer, the agent stopped, then the cards. */
export function SetupBody({
  agent,
  failure,
  cards,
  refused,
  narrow = false,
  onRetry,
  onAccept,
  onEdit,
  onDraft,
  onDiscuss,
  onDecline,
  onSave,
  onCancel,
  onSend,
  onProposeAgain,
}: SetupBodyProps): ReactNode {
  return (
    <>
      {refused !== undefined && (
        <p role="alert" className={REFUSAL}>
          {refused}
        </p>
      )}
      {agent === 'failed' && (
        <NeedCard
          ask={{ kind: 'environment', action: 'Try again' }}
          title="The setup agent stopped"
          text={failure}
          when="now"
          role="Setup agent"
          onRetry={onRetry}
        />
      )}
      <div className={narrow ? COLUMN : GRID}>
        {shownCards(agent, cards).map((card) => (
          <SetupCard
            key={card.kind}
            kind={card.kind}
            status={card.status}
            proposal={card.proposal}
            draft={card.draft}
            onDraft={(draft) => onDraft(card.kind, draft)}
            onAccept={() => onAccept(card.kind)}
            onEdit={onEdit === undefined ? undefined : () => onEdit(card.kind)}
            onDiscuss={onDiscuss === undefined ? undefined : () => onDiscuss(card.kind)}
            onDecline={() => onDecline(card.kind)}
            onSave={() => onSave(card.kind)}
            onCancel={() => onCancel(card.kind)}
            onSend={(note) => onSend(card.kind, note)}
            onProposeAgain={
              onProposeAgain === undefined ? undefined : () => onProposeAgain(card.kind)
            }
          />
        ))}
      </div>
    </>
  )
}

export function ProjectSetup(props: ProjectSetupProps): ReactNode {
  const {
    folder,
    agent,
    startedAt,
    endedAt,
    glance,
    cards,
    creating = false,
    onAcceptAll,
    onCreate,
  } = props
  const shown = shownCards(agent, cards)
  const waiting = shown.some((card) => card.status.state === 'proposed')
  const answered =
    agent !== 'waiting' && agent !== 'working' && shown.length > 0 && allAnswered(shown)
  return (
    <Page>
      <PageHeader
        title="New Project"
        about={
          <span className={ABOUT}>
            <IconFolder size="sm" aria-hidden="true" />
            <span className="sr-only">Folder:</span>
            <span className="truncate">{folder}</span>
          </span>
        }
        actions={
          <>
            <AgentMark agent={agent} startedAt={startedAt} endedAt={endedAt} glance={glance} />
            {waiting && (
              <Button onClick={onAcceptAll}>
                <IconCheck size="sm" aria-hidden="true" />
                Accept all
              </Button>
            )}
            {answered && (
              <Button variant="primary" state={creating ? 'loading' : 'idle'} onClick={onCreate}>
                Create the Project
              </Button>
            )}
          </>
        }
      />
      <SetupBody {...props} />
    </Page>
  )
}
