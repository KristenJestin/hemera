/**
 * A new Project's setup (#53) over the link, drawn as onboarding over the Project: what the setup agent proposes (#44), one card
 * per kind, and the user's answers. It reads the cards and where the agent stands, then again on
 * each change of this Project's setup. A kind's Accept accepts its changes still waiting in their
 * order and stops at the first the settings refuse, whose reason the card then says; Decline
 * declines them all. The agent takes no edit, no discussion and no new proposal of one card:
 * those answers are left out. An agent done with nothing proposed leads to the Project's page.
 * No Effect here: the link's calls are promises.
 */

import type { Project, SetupCard, SetupStanding } from '@hemera/ipc'
import { SetupTakeover, type SetupKind } from '@hemera/ui'
import { type ReactNode, useEffect, useRef, useState } from 'react'

import type { Link } from './link.ts'
import {
  type AgentTimes,
  agentTimesOf,
  answerSaid,
  nothingProposed,
  pendingOf,
  setupAgentOf,
  setupEntriesOf,
  setupGlanceOf,
  waitingProposals,
} from './setup-cards.ts'

interface Seen {
  readonly cards: ReadonlyArray<SetupCard>
  readonly standing: SetupStanding
  /** Why the setup could not be read, in words; null once it is. */
  readonly unread: string | null
}

const NOTHING_YET: Seen = {
  cards: [],
  standing: { state: 'working', sentence: null },
  unread: null,
}

const nothing = (): void => undefined

/** The cards and the agent's standing, read again on each change of this Project's setup. */
function useSetup(link: Link, engineReady: boolean, projectId: string): [Seen, () => void] {
  const [seen, setSeen] = useState<Seen>(NOTHING_YET)
  const [reads, setReads] = useState(0)
  useEffect(() => {
    if (!engineReady) return undefined
    let stopped = false
    const unread = (failure: Error): void => {
      if (!stopped) setSeen((before) => ({ ...before, unread: failure.message }))
    }
    const read = (): void => {
      Promise.all([link.setupCards(projectId), link.setupStanding(projectId)]).then(
        ([cards, standing]) => {
          if (!stopped) setSeen({ cards, standing, unread: null })
        },
        unread,
      )
    }
    const unsubscribe = link.onSetupChanges((change) => {
      if (change.projectId === projectId) read()
    }, unread)
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
  /** The setup has left the window (Finish later, Done, nothing to answer): the Project's page. */
  onDone: () => void
  /** Why the setup could not start or be read, as the page was opened with it. */
  refused?: string | undefined
}

export function SetupRoute({
  link,
  engineReady,
  project,
  onDone,
  refused,
}: SetupRouteProps): ReactNode {
  const [seen, reread] = useSetup(link, engineReady, project.id)
  /** Why it could not start, until Try again asks once more. */
  const [startRefused, setStartRefused] = useState(refused)
  /** Why the last answer was not taken, in words. */
  const [said, setSaid] = useState<string | undefined>(undefined)
  /** Open until Finish later or Done; the window moves on once it has left. */
  const [open, setOpen] = useState(true)
  const unread = seen.unread === null ? undefined : `The setup could not be read: ${seen.unread}`
  const stopped = startRefused ?? unread
  const agent = stopped === undefined ? setupAgentOf(seen.standing) : 'failed'
  const [times, setTimes] = useState<AgentTimes>(() => ({ startedAt: Date.now(), endedAt: null }))
  // Its end is kept once seen: the chip's count stops there.
  useEffect(() => {
    setTimes((before) => agentTimesOf(before, agent, Date.now()))
  }, [agent])
  const answer = (work: Promise<unknown>): void => {
    setSaid(undefined)
    answerSaid(work, reread, setSaid)
  }
  const ofKind = (kind: SetupKind) => pendingOf(seen.cards, kind)
  // A setup that could not start has nothing proposed either: the page stays to say why.
  const empty = stopped === undefined && nothingProposed(seen.standing, seen.cards)
  const left = useRef(false)
  // Nothing to answer: the Project's page, once, as Create the Project would lead there.
  useEffect(() => {
    if (!empty || left.current) return
    left.current = true
    onDone()
  }, [empty, onDone])
  return (
    <SetupTakeover
      project={project.name}
      open={open}
      onFinishLater={() => setOpen(false)}
      onDone={() => setOpen(false)}
      onClosed={onDone}
      folder={project.mainCheckout}
      agent={agent}
      startedAt={times.startedAt}
      endedAt={times.endedAt}
      glance={setupGlanceOf(seen.standing)}
      failure={agent === 'failed' ? (stopped ?? seen.standing.sentence ?? undefined) : undefined}
      refused={said}
      cards={setupEntriesOf(seen.cards)}
      onAcceptAll={() => answer(link.acceptAllSetupCards(project.id))}
      onRetry={() => {
        // What could not be read is read again; a setup that stopped is asked for again.
        if (unread !== undefined) {
          reread()
          return
        }
        setStartRefused(undefined)
        answer(link.proposeSetup(project.id))
      }}
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

/**
 * How many changes the setup agent proposes still wait for an answer in a Project, read again on
 * each change of its setup; nothing while it is read or when it cannot be.
 */
export function useWaitingProposals(
  link: Link,
  engineReady: boolean,
  projectId: string | null,
): number {
  const [waiting, setWaiting] = useState(0)
  useEffect(() => {
    if (!engineReady || projectId === null) return undefined
    let stopped = false
    const read = (): void => {
      link.setupCards(projectId).then((cards) => {
        if (!stopped) setWaiting(waitingProposals(cards))
      }, nothing)
    }
    const unsubscribe = link.onSetupChanges((change) => {
      if (change.projectId === projectId) read()
    }, nothing)
    read()
    return () => {
      stopped = true
      unsubscribe()
      setWaiting(0)
    }
  }, [link, engineReady, projectId])
  return waiting
}
