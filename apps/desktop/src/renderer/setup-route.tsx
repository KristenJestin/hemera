/**
 * A new Project's setup page (#53) over the link: what the setup agent proposes (#44), one card
 * per kind, and the user's answers. It reads the cards and where the agent stands, then again on
 * each change of this Project's setup. A kind's Accept accepts its changes still waiting in their
 * order and stops at the first the settings refuse, whose reason the card then says; Decline
 * declines them all. The agent takes no edit, no discussion and no new proposal of one card:
 * those answers are left out. An agent done with nothing proposed leads to the Project's page.
 * No Effect here: the link's calls are promises.
 */

import type { Project, SetupCard, SetupStanding } from '@hemera/ipc'
import { ProjectSetup, type SetupKind } from '@hemera/ui'
import { type ReactNode, useEffect, useRef, useState } from 'react'

import type { Link } from './link.ts'
import {
  type AgentTimes,
  agentTimesOf,
  nothingProposed,
  pendingOf,
  setupAgentOf,
  setupEntriesOf,
  setupGlanceOf,
} from './setup-cards.ts'

interface Seen {
  readonly cards: ReadonlyArray<SetupCard>
  readonly standing: SetupStanding
}

const NOTHING_YET: Seen = { cards: [], standing: { state: 'working', sentence: null } }

const nothing = (): void => undefined

/** The cards and the agent's standing, read again on each change of this Project's setup. */
function useSetup(link: Link, engineReady: boolean, projectId: string): [Seen, () => void] {
  const [seen, setSeen] = useState<Seen>(NOTHING_YET)
  const [reads, setReads] = useState(0)
  useEffect(() => {
    if (!engineReady) return undefined
    let stopped = false
    const read = (): void => {
      Promise.all([link.setupCards(projectId), link.setupStanding(projectId)]).then(
        ([cards, standing]) => {
          if (!stopped) setSeen({ cards, standing })
        },
        nothing,
      )
    }
    const unsubscribe = link.onSetupChanges((change) => {
      if (change.projectId === projectId) read()
    }, nothing)
    read()
    return () => {
      stopped = true
      unsubscribe()
    }
  }, [link, engineReady, projectId, reads])
  return [seen, () => setReads((before) => before + 1)]
}

/** Accepts the cards in order; stops at the first the settings refuse, which stays pending. */
async function acceptInOrder(link: Link, cards: ReadonlyArray<SetupCard>): Promise<void> {
  for (const card of cards) {
    // One after the other: each is applied on what the one before declared.
    // oxlint-disable-next-line no-await-in-loop -- a refusal stops the ones after it
    const after = await link.acceptSetupCard(card.id)
    if (after.state === 'pending') return
  }
}

interface SetupRouteProps {
  link: Link
  engineReady: boolean
  project: Project
  /** The user is done with the setup: the Project's page. */
  onDone: () => void
}

export function SetupRoute({ link, engineReady, project, onDone }: SetupRouteProps): ReactNode {
  const [seen, reread] = useSetup(link, engineReady, project.id)
  const agent = setupAgentOf(seen.standing)
  const [times, setTimes] = useState<AgentTimes>(() => ({ startedAt: Date.now(), endedAt: null }))
  // Its end is kept once seen: the chip's count stops there.
  useEffect(() => {
    setTimes((before) => agentTimesOf(before, agent, Date.now()))
  }, [agent])
  const answer = (work: Promise<unknown>): void => {
    work.then(reread, reread)
  }
  const ofKind = (kind: SetupKind) => pendingOf(seen.cards, kind)
  const empty = nothingProposed(seen.standing, seen.cards)
  const left = useRef(false)
  // Nothing to answer: the Project's page, once, as Create the Project would lead there.
  useEffect(() => {
    if (!empty || left.current) return
    left.current = true
    onDone()
  }, [empty, onDone])
  return (
    <ProjectSetup
      folder={project.mainCheckout}
      agent={agent}
      startedAt={times.startedAt}
      endedAt={times.endedAt}
      glance={setupGlanceOf(seen.standing)}
      failure={agent === 'failed' ? (seen.standing.sentence ?? undefined) : undefined}
      cards={setupEntriesOf(seen.cards)}
      onAcceptAll={() => answer(link.acceptAllSetupCards(project.id))}
      onCreate={onDone}
      onRetry={() => answer(link.proposeSetup(project.id))}
      onAccept={(kind) => answer(acceptInOrder(link, ofKind(kind)))}
      onDecline={(kind) =>
        answer(Promise.all(ofKind(kind).map((card) => link.declineSetupCard(card.id))))
      }
      onDraft={nothing}
      onSave={nothing}
      onCancel={nothing}
      onSend={nothing}
    />
  )
}
