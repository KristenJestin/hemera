/**
 * A Project's setup (#53) as a task of the Project, on its page while it runs or a proposal waits:
 * the user may launch it at any time, so it is a task like any other, not an onboarding, and it
 * does not stay on the page once nothing is left to answer. What the setup agent proposes
 * (#44), one card per kind, unfolds in place to answer them. It reads the cards and where the agent
 * stands, then again on each change of this Project's setup. A kind's Accept accepts its changes
 * still waiting in their order and stops at the first the settings refuse, whose reason the card
 * then says; Decline declines them all; Edit replaces them by what the user wrote in their place
 * (#185), and Discuss hands the user's words to the setup agent, who may revise them. It is launched from the dialog that adds the Project or
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
import {
  type CardStatus,
  type Proposal,
  ProjectTasks,
  type SetupCardEntry,
  type SetupKind,
  SetupTask,
  type SetupTaskProps,
} from '@hemera/ui'
import { type ReactNode, useCallback, useEffect, useState } from 'react'

import type { Link } from './link.ts'
import {
  type AgentTimes,
  agentTimesOf,
  type LaunchState,
  NO_LAUNCH,
  answerSaid,
  editedChangesOf,
  latestSetupOf,
  pendingOf,
  setupAgentOf,
  setupEntriesOf,
  setupAboutOf,
  setupGlanceOf,
  setupMessagesOf,
  setupOfferRead,
  setupLauncher,
  setupLineageOf,
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

/** The latest setup's sessions, oldest first; none when none ran, or when they cannot be read. */
const lineageOf = (link: Link, projectId: string): Promise<ReadonlyArray<SessionSummary>> =>
  link.projectSessions(projectId).then(setupLineageOf, () => [])

/** What the latest setup's sessions said, oldest first; nothing when none ran. */
const messagesOf = (
  link: Link,
  lineage: ReadonlyArray<SessionSummary>,
): Promise<ReadonlyArray<string>> =>
  Promise.all(lineage.map((one) => link.sessionThread(one.id).then(setupMessagesOf))).then((said) =>
    said.flat(),
  )

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
      lineageOf(link, projectId).then(async (lineage) => ({
        lineage,
        // What the agent said is the menu's to show: unread, the setup still is.
        messages: await messagesOf(link, lineage).catch((): ReadonlyArray<string> => []),
      })),
    ]).then(
      ([cards, standing, { lineage, messages }]) => {
        if (!newest(mine)) return
        // A setup started again for a discussion is the same setup: its cards since its start.
        const session = latestSetupOf(lineage)
        const cardsShown = sinceLatestSetup(cards, lineage[0] ?? null)
        show({ cards: cardsShown, standing, session, messages, unread: null })
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

/** A card being answered on the page, before the engine hears it: edited, or discussed. */
export type CardAnswer =
  | { readonly state: 'editing'; readonly draft: Proposal; readonly refused?: string | undefined }
  | { readonly state: 'discussing' }

interface CardAnswersOf {
  readonly link: Link
  /** The latest setup's cards. */
  readonly cards: ReadonlyArray<SetupCard>
  /** Its cards as the page draws them, one per kind. */
  readonly entries: ReadonlyArray<SetupCardEntry>
  /** What the page holds of each kind's answer. */
  readonly answers: ReadonlyMap<SetupKind, CardAnswer>
  readonly setAnswer: (kind: SetupKind, answer: CardAnswer | null) => void
  readonly reread: () => void
  /** Gives an answer to the engine: read again either way, a refusal said. */
  readonly answer: (work: Promise<unknown>) => void
}

/** The cards as the page shows them, and their Edit and Discuss. */
interface CardAnswering extends Pick<
  SetupTaskProps,
  'cards' | 'onDraft' | 'onSave' | 'onCancel' | 'onSend'
> {
  readonly onEdit: (kind: SetupKind) => void
  readonly onDiscuss: (kind: SetupKind) => void
}

/** What a card being answered on the page shows: its editor, or the field of its discussion. */
const statusShown = (answer: CardAnswer): CardStatus =>
  answer.state === 'editing'
    ? { state: 'editing', refused: answer.refused }
    : { state: 'discussing' }

/**
 * Edit and Discuss on the cards: the editor's draft and the discussion's field are the page's
 * until Save or Send gives them to the engine. Save replaces the kind's waiting cards by the
 * draft; refused, the editor stays with the reason. Cancel gives nothing. Send hands the user's
 * words to the setup agent. A card no longer waiting drops what the page held of it.
 */
export function cardAnswers({
  link,
  cards,
  entries,
  answers,
  setAnswer,
  reread,
  answer,
}: CardAnswersOf): CardAnswering {
  const shown = entries.map((entry) => {
    const held = answers.get(entry.kind)
    if (held === undefined || entry.status.state !== 'proposed') return entry
    return {
      ...entry,
      status: statusShown(held),
      draft: held.state === 'editing' ? held.draft : undefined,
    }
  })
  return {
    cards: shown,
    onEdit: (kind) => {
      const proposal = entries.find((entry) => entry.kind === kind)?.proposal
      if (proposal !== null && proposal !== undefined) {
        setAnswer(kind, { state: 'editing', draft: proposal })
      }
    },
    onDraft: (kind, draft) => {
      const held = answers.get(kind)
      if (held?.state === 'editing') setAnswer(kind, { ...held, draft })
    },
    onSave: (kind) => {
      const held = answers.get(kind)
      if (held?.state !== 'editing') return
      const edit = editedChangesOf(cards, held.draft)
      if ('refused' in edit) {
        setAnswer(kind, { ...held, refused: edit.refused })
        return
      }
      link.editSetupCards(edit.cardIds, edit.changes).then(
        () => {
          setAnswer(kind, null)
          reread()
        },
        (failure: Error) => setAnswer(kind, { ...held, refused: failure.message }),
      )
    },
    onCancel: (kind) => setAnswer(kind, null),
    onDiscuss: (kind) => setAnswer(kind, { state: 'discussing' }),
    onSend: (kind, note) => {
      setAnswer(kind, null)
      answer(
        link.discussSetupCards(
          pendingOf(cards, kind).map((card) => card.id),
          note,
        ),
      )
    },
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
  const [answers, setAnswers] = useState<ReadonlyMap<SetupKind, CardAnswer>>(() => new Map())
  const { cards, ...answering } = cardAnswers({
    link,
    cards: seen.cards,
    entries: setupEntriesOf(seen.cards),
    answers,
    setAnswer: (kind, next) =>
      setAnswers((before) => {
        const after = new Map(before)
        if (next === null) after.delete(kind)
        else after.set(kind, next)
        return after
      }),
    reread,
    answer,
  })
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
        cards={cards}
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
        onAddOther={(id) => answer(link.acceptSetupCard(id))}
        {...answering}
      />
    </ProjectTasks>
  )
}
