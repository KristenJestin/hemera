/**
 * A Project's setup (#53) as a task of the Project, on its page while it runs or a proposal waits:
 * the user may launch it at any time, so it is a task like any other, not an onboarding, and it
 * does not stay on the page once nothing is left to answer. What the setup agent proposes
 * (#44), one card per kind, unfolds in place to answer them. It reads the cards and where the agent
 * stands, then again on each change of this Project's setup. A kind's Accept accepts its changes
 * still waiting in their order and stops at the first the settings refuse, whose reason the card
 * then says; Decline declines them all. It is launched from the dialog that adds the Project or
 * from the Project's settings (`useSetupLaunches`). No Effect here: the link's calls are promises.
 */

import type {
  AgentState,
  Project,
  RoleModels,
  SessionSummary,
  SetupCard,
  SetupStanding,
} from '@hemera/ipc'
import { ProjectTasks, SetupTask, type SetupKind } from '@hemera/ui'
import { type ReactNode, useCallback, useEffect, useState } from 'react'

import type { Link } from './link.ts'
import {
  type AgentTimes,
  agentTimesOf,
  type LaunchState,
  NO_LAUNCH,
  answerSaid,
  latestSetupOf,
  pendingOf,
  setupAgentOf,
  setupEntriesOf,
  setupAboutOf,
  setupGlanceOf,
  setupMessagesOf,
  setupOfferRead,
  setupLauncher,
  setupShownOf,
  setupTimesOf,
  sinceLatestSetup,
  type SetupOffer as Offer,
} from './setup-cards.ts'
import { useRead, valueOf } from './use-read.tsx'

export interface Seen {
  /** The latest setup's cards (`sinceLatestSetup`). */
  readonly cards: ReadonlyArray<SetupCard>
  readonly standing: SetupStanding
  /** The latest setup session; null when none ran, or when it cannot be read. */
  readonly session: SessionSummary | null
  /** What the setup agent said, oldest first. */
  readonly messages: ReadonlyArray<string>
  /** Why the setup could not be read, in words; null once it is. */
  readonly unread: string | null
}

const NOTHING_YET: Seen = {
  cards: [],
  standing: { state: 'none', sentence: null },
  session: null,
  messages: [],
  unread: null,
}

/** The Project's latest setup session; null when none ran, or when it cannot be read. */
const latestSessionOf = (link: Link, projectId: string): Promise<SessionSummary | null> =>
  link.projectSessions(projectId).then(latestSetupOf, () => null)

/** What a setup session said; nothing when none ran. */
const messagesOf = (link: Link, session: SessionSummary | null): Promise<ReadonlyArray<string>> =>
  session === null ? Promise.resolve([]) : link.sessionThread(session.id).then(setupMessagesOf)

const nothing = (): void => undefined

/**
 * Follows a Project's setup: read at once, again on each change of it, and once more when its
 * changes are followed (`onOpen`), for a change made between the first read and then. Reads may
 * answer out of order: an answer older than the last shown is dropped, refusal or not. Stopped, it
 * says nothing more.
 */
export function followSetup(
  link: Link,
  projectId: string,
  show: (seen: Seen) => void,
  unread: (failure: Error) => void,
): () => void {
  let stopped = false
  let asked = 0
  let shown = 0
  /** Whether the answer to read `mine` is the newest yet: then it is the one shown. */
  const newest = (mine: number): boolean => {
    if (stopped || mine <= shown) return false
    shown = mine
    return true
  }
  const read = (): void => {
    asked += 1
    const mine = asked
    Promise.all([
      link.setupCards(projectId),
      link.setupStanding(projectId),
      latestSessionOf(link, projectId).then(async (session) => ({
        session,
        // What the agent said is the menu's to show: unread, the setup still is.
        messages: await messagesOf(link, session).catch((): ReadonlyArray<string> => []),
      })),
    ]).then(
      ([cards, standing, { session, messages }]) => {
        if (!newest(mine)) return
        show({ cards: sinceLatestSetup(cards, session), standing, session, messages, unread: null })
      },
      (failure: Error) => {
        if (newest(mine)) unread(failure)
      },
    )
  }
  const unsubscribe = link.onSetupChanges(
    (change) => {
      if (change.projectId === projectId) read()
    },
    (failure) => {
      if (!stopped) unread(failure)
    },
    read,
  )
  read()
  return () => {
    stopped = true
    unsubscribe()
  }
}

/** The cards and the agent's standing, read again on each change of this Project's setup. */
function useSetup(link: Link, engineReady: boolean, projectId: string): [Seen, () => void] {
  const [seen, setSeen] = useState<Seen>(NOTHING_YET)
  const [reads, setReads] = useState(0)
  useEffect(() => {
    if (!engineReady) return undefined
    return followSetup(link, projectId, setSeen, (failure) =>
      setSeen((before) => ({ ...before, unread: failure.message })),
    )
  }, [link, engineReady, projectId, reads])
  return [seen, () => setReads((before) => before + 1)]
}

const readAgents = (link: Link) => link.agents()

/**
 * Who would run a setup for a Project, or for a Project not created yet with null: the agent its
 * role resolves to, or why none can, a read refused included; null while it is read. Read each
 * time `shown` turns true, and again whenever `asked` changes.
 */
export function useSetupOffer(
  link: Link,
  shown: boolean,
  projectId: string | null,
  asked = '',
): Offer | null {
  const readRoles = useCallback((ready: Link) => ready.roleModels(projectId), [projectId])
  const [agentsRead] = useRead<ReadonlyArray<AgentState>>(link, shown, readAgents, asked)
  const [rolesRead] = useRead<ReadonlyArray<RoleModels>>(link, shown, readRoles, asked)
  return setupOfferRead(agentsRead, rolesRead)
}

/** Who runs a Project's setup, as its chip's menu says it; nothing while it is read. */
function useSetupAbout(link: Link, engineReady: boolean, projectId: string): string | undefined {
  const readRoles = useCallback((ready: Link) => ready.roleModels(projectId), [projectId])
  const [agentsRead] = useRead<ReadonlyArray<AgentState>>(link, engineReady, readAgents)
  const [rolesRead] = useRead<ReadonlyArray<RoleModels>>(link, engineReady, readRoles)
  const agents = valueOf(agentsRead)
  const roles = valueOf(rolesRead)
  return agents === null || roles === null ? undefined : setupAboutOf(agents, roles)
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

/** Every Project's setup launch: where each stands, and how to launch one. */
export interface SetupLaunches {
  readonly of: (projectId: string) => LaunchState
  /** Launches a Project's setup, one launch at a time per Project; answers whether it started. */
  readonly start: (projectId: string) => Promise<boolean>
}

/**
 * The window's setup launches, one for every Project, from wherever they are asked: the dialog
 * that adds a Project, its settings, or Try again on its page. Each Project's refusal stays its
 * own until its next launch.
 */
export function useSetupLaunches(link: Link): SetupLaunches {
  const [states, setStates] = useState<ReadonlyMap<string, LaunchState>>(() => new Map())
  const [start] = useState(() =>
    setupLauncher(
      (projectId) => link.proposeSetup(projectId),
      (projectId, state) => setStates((before) => new Map(before).set(projectId, state)),
    ),
  )
  return { of: (projectId) => states.get(projectId) ?? NO_LAUNCH, start }
}

interface ProjectSetupTaskProps {
  link: Link
  engineReady: boolean
  project: Project
  /** Where this Project's last setup launch stands. */
  launch: LaunchState
  /** Launches this Project's setup again; answers whether it started. */
  onLaunch: () => Promise<boolean>
}

/** The Project's tasks, the setup among them. */
export function ProjectSetupTask({
  link,
  engineReady,
  project,
  launch,
  onLaunch,
}: ProjectSetupTaskProps): ReactNode {
  const [seen, reread] = useSetup(link, engineReady, project.id)
  const about = useSetupAbout(link, engineReady, project.id)
  const [open, setOpen] = useState(false)
  /** Whether its details are open or still closing: the task stays until they have closed. */
  const [held, setHeld] = useState(false)
  /** Why the last answer was not taken, in words. */
  const [said, setSaid] = useState<string | undefined>(undefined)
  const shown = setupShownOf(seen, launch.refused)
  const agent = shown?.agent ?? setupAgentOf(seen.standing)
  // Counted on the page only while no session is known; its end kept once seen.
  const [kept, setKept] = useState<AgentTimes>(() => ({ startedAt: Date.now(), endedAt: null }))
  useEffect(() => {
    setKept((before) => agentTimesOf(before, agent, Date.now()))
  }, [agent])
  const times = setupTimesOf(seen.session, kept)
  const answer = (work: Promise<unknown>): void => {
    setSaid(undefined)
    answerSaid(work, reread, setSaid)
  }
  const ofKind = (kind: SetupKind) => pendingOf(seen.cards, kind)
  // Nothing runs, nothing waits and nothing was refused: the page has no task to show, once
  // its details, if they were open, have closed.
  if (shown === null && !held) return null
  return (
    <ProjectTasks>
      <SetupTask
        project={project.name}
        about={about}
        messages={seen.messages}
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (next) setHeld(true)
        }}
        leaving={shown === null}
        onClosed={() => setHeld(false)}
        agent={agent}
        startedAt={times.startedAt}
        endedAt={times.endedAt}
        glance={setupGlanceOf(seen.standing)}
        failure={shown?.failure}
        refused={said}
        cards={setupEntriesOf(seen.cards)}
        onAcceptAll={() => answer(link.acceptAllSetupCards(project.id))}
        onRetry={() => {
          // What could not be read is read again; a setup that stopped is launched again.
          if (seen.unread !== null) reread()
          else void onLaunch().then(reread)
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
    </ProjectTasks>
  )
}
