import { type ReactNode, useEffect, useState } from 'react'

import { type Proposal, SETUP_KINDS, type SetupKind } from '../../blocks/setup/proposal.tsx'
import type { CardStatus } from '../../blocks/setup/setup-card.tsx'
import {
  ACME_FOLDER,
  LONG_PROPOSALS,
  NESTED_REPOSITORY,
  PROPOSALS,
  REFUSALS,
  REVISED_VARIABLES,
} from '../../blocks/setup/setup-fixtures.ts'
import { ContentHeader } from '../../shell/content-header.tsx'
import { SystemControls } from '../../shell/shell-fixtures.tsx'
import type { SetupAgent, SetupCardEntry } from './project-setup.tsx'
import { ProjectTasks, SetupProposals, SetupTask, type SetupTaskProps } from './setup-task.tsx'

/**
 * A small machine around the setup of Acme, so a story walks what a user walks: the cards arriving
 * in batches, an answer given, refused, edited, discussed, declined and proposed again, every card
 * accepted at once. Nothing here is an engine: a story holds the state the renderer's hooks will
 * hold, and the engine's refusals are the fixtures'.
 */
export interface SetupFixtureProps {
  agent?: SetupAgent | undefined
  /** Each card's state as the story starts, by kind; the others are proposed. */
  states?: Partial<Record<SetupKind, CardStatus>> | undefined
  /** The cards that arrive one after the other as the story plays, from reading to proposed. */
  arriving?: readonly SetupKind[] | undefined
  /** The folder is not a repository and holds none Hemera found: the agent looked deeper. */
  nested?: boolean | undefined
  /** A long path, a long line and a long name in every field that holds one. */
  long?: boolean | undefined
  failure?: string | undefined
  /** The folder chosen. */
  folder?: string | undefined
}

/** The step the agent's glance says it is on, as it stands. */
const STEPS: Record<SetupAgent, string> = {
  waiting: 'Waiting for a free slot',
  working: 'Reading the folder',
  done: 'Proposed the setup of 5 parts',
  failed: 'Stopped',
}

/** How long a batch takes to arrive, and the agent to write another proposal, in a story. */
const BEAT = 700

export function SetupFixture({
  agent: firstAgent = 'done',
  states = {},
  arriving = [],
  nested = false,
  long = false,
  failure,
  folder = ACME_FOLDER,
}: SetupFixtureProps): ReactNode {
  const proposals = long ? LONG_PROPOSALS : PROPOSALS
  const proposalOf = (kind: SetupKind): Proposal =>
    kind === 'repositories' && nested ? NESTED_REPOSITORY : proposals[kind]
  const [startedAt] = useState(() => Date.now() - 42_000)
  const [agent, setAgent] = useState<SetupAgent>(firstAgent)
  const [open, setOpen] = useState(false)
  const [cards, setCards] = useState<SetupCardEntry[]>(() =>
    SETUP_KINDS.map((kind) => {
      const status: CardStatus = arriving.includes(kind)
        ? { state: 'reading' }
        : (states[kind] ?? { state: 'proposed' })
      return {
        kind,
        status,
        proposal: status.state === 'reading' ? null : proposalOf(kind),
        draft: status.state === 'editing' ? proposalOf(kind) : undefined,
      }
    }),
  )
  const set = (kind: SetupKind, change: Partial<SetupCardEntry>): void =>
    setCards((before) => before.map((card) => (card.kind === kind ? { ...card, ...change } : card)))

  // The batches the agent writes, one card after the other.
  const [batch, setBatch] = useState(0)
  useEffect(() => {
    const next = arriving[batch]
    if (next === undefined) {
      if (arriving.length > 0 && batch === arriving.length) setAgent('done')
      return undefined
    }
    const arrive = setTimeout(() => {
      set(next, { status: { state: 'proposed' }, proposal: proposalOf(next) })
      setBatch((before) => before + 1)
    }, BEAT)
    return () => clearTimeout(arrive)
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- a batch is played once, in order.
  }, [batch])

  const accept = (kind: SetupKind): boolean => {
    const refusal = REFUSALS[kind]
    set(kind, {
      status:
        refusal === undefined ? { state: 'accepted' } : { state: 'proposed', refused: refusal },
    })
    return refusal === undefined
  }

  /** Waits a beat, then gives the card a proposal again, as the agent would. */
  const proposeLater = (kind: SetupKind, proposal: Proposal): void => {
    setTimeout(() => set(kind, { status: { state: 'proposed' }, proposal }), BEAT * 2)
  }

  const task: SetupTaskProps = {
    project: folder.split('/').at(-1) ?? folder,
    open,
    onOpenChange: setOpen,
    agent,
    startedAt,
    endedAt: agent === 'working' || agent === 'waiting' ? null : startedAt + 42_000,
    failure,
    glance: {
      kind: 'helper',
      type: 'Agent · Claude Code',
      step: agent === 'failed' ? failure : STEPS[agent],
    },
    cards,
    onAcceptAll: () => {
      for (const card of cards) {
        if (card.status.state !== 'proposed') continue
        if (!accept(card.kind)) break
      }
    },
    onRetry: () => {
      setAgent('working')
      for (const card of cards) {
        if (card.status.state === 'reading') proposeLater(card.kind, proposalOf(card.kind))
      }
    },
    onAccept: accept,
    onEdit: (kind) => {
      const card = cards.find((one) => one.kind === kind)
      set(kind, { status: { state: 'editing' }, draft: card?.proposal ?? undefined })
    },
    onDraft: (kind, draft) => set(kind, { draft }),
    onDiscuss: (kind) => set(kind, { status: { state: 'discussing' } }),
    onDecline: (kind) => set(kind, { status: { state: 'declined' } }),
    onSave: (kind) => {
      const card = cards.find((one) => one.kind === kind)
      set(kind, {
        status: { state: 'proposed' },
        proposal: card?.draft ?? card?.proposal ?? null,
      })
    },
    onCancel: (kind) => set(kind, { status: { state: 'proposed' }, draft: undefined }),
    onSend: (kind, note) => {
      set(kind, { status: { state: 'discussed', note } })
      proposeLater(kind, kind === 'variables' ? REVISED_VARIABLES : proposalOf(kind))
    },
    onProposeAgain: (kind) => {
      set(kind, { status: { state: 'reading' }, proposal: null })
      proposeLater(kind, proposalOf(kind))
    },
  }

  return (
    <main className="flex h-screen flex-col bg-surface-content">
      <ContentHeader
        folded={false}
        onFold={() => {}}
        crumbs={[{ id: 'acme', label: folder.split('/').at(-1) ?? folder }]}
        controls={<SystemControls />}
      />
      <div className="flex min-h-0 flex-1 flex-col overflow-auto">
        <div className="mx-auto flex w-full max-w-page flex-col p-8">
          <ProjectTasks>
            <SetupTask {...task} />
          </ProjectTasks>
          <div className="mt-6 flex flex-col">
            <SetupProposals {...task} />
          </div>
        </div>
      </div>
    </main>
  )
}
