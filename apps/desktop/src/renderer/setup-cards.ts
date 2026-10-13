/**
 * The setup agent's cards (#44) as the new-Project page draws them (#53), plain values and no
 * React. The engine proposes one card per change; the page shows one card per kind (the
 * repositories, the commands, the preparation, the variables), holding that kind's changes. A
 * kind's Accept and Decline go to its changes still waiting, in the order proposed.
 */

import { SetupProposal } from '@hemera/core/domain'
import type {
  AgentState,
  EditedChange,
  RoleModels,
  SessionSummary,
  SetupCard,
  SetupStanding,
  ThreadLine,
} from '@hemera/ipc'
import { Option, Predicate, Schema } from 'effect'
import type {
  CardStatus,
  LiveGlance,
  Proposal,
  SetupAgent,
  SetupCardEntry,
  SetupKind,
} from '@hemera/ui'

import type { Read } from './app-settings-data.ts'

/** The page's kind of each change the engine proposes, in the settings' order. */
const KINDS: ReadonlyArray<readonly [SetupCard['change']['kind'], SetupKind]> = [
  ['repository', 'repositories'],
  ['command', 'commands'],
  ['step', 'preparation'],
  ['variable', 'variables'],
  ['specLanguage', 'specLanguage'],
]

const kindOf = (card: SetupCard): SetupKind | undefined =>
  KINDS.find(([change]) => change === card.change.kind)?.[1]

/** A command listed apart by the agent: one of the card's other scripts, not waited on. */
const isListed = (card: SetupCard): boolean =>
  card.change.kind === 'command' && card.change.listed === true

/** A kind's changes still waiting for the user, in the order proposed; the listed scripts apart. */
export const pendingOf = (cards: ReadonlyArray<SetupCard>, kind: SetupKind): SetupCard[] =>
  cards
    .filter((card) => kindOf(card) === kind && card.state === 'pending' && !isListed(card))
    .toSorted((a, b) => a.createdAt.localeCompare(b.createdAt))

const statusOf = (cards: ReadonlyArray<SetupCard>): CardStatus => {
  // The scripts listed apart are no proposal to answer: only their own click adds one.
  const chosen = cards.filter((card) => !isListed(card))
  if (chosen.length === 0) return { state: 'accepted' }
  const waiting = chosen.filter((card) => card.state === 'pending')
  // The user's words stand on the card while the agent answers them.
  const note = waiting.find((card) => card.discussion !== null)?.discussion
  if (note !== undefined && note !== null) return { state: 'discussed', note }
  if (waiting.length > 0) {
    const refused = waiting.findLast((card) => card.refusal !== null)?.refusal ?? undefined
    return { state: 'proposed', refused }
  }
  return chosen.some((card) => card.state === 'accepted')
    ? { state: 'accepted' }
    : { state: 'declined' }
}

const proposalOf = (kind: SetupKind, cards: ReadonlyArray<SetupCard>): Proposal => {
  switch (kind) {
    case 'repositories':
      return {
        kind,
        items: cards.flatMap(({ id, change }) =>
          change.kind === 'repository'
            ? [
                {
                  id,
                  path: change.path,
                  base: [change.remote, change.baseBranch]
                    .filter((part) => part !== undefined)
                    .join('/'),
                },
              ]
            : [],
        ),
      }
    case 'commands':
      return {
        kind,
        items: cards.flatMap(({ id, change, state }) =>
          change.kind === 'command'
            ? [
                {
                  id,
                  name: change.name,
                  type: change.type,
                  line: change.line,
                  check: change.check ?? false,
                  service: change.type === 'serve',
                  atOpen: change.atOpen ?? false,
                  ask: change.askBeforeRunning ?? false,
                  other: change.listed === true,
                  added: change.listed === true && state === 'accepted',
                },
              ]
            : [],
        ),
      }
    case 'preparation':
      return {
        kind,
        items: cards.flatMap(({ id, change }) =>
          change.kind === 'step'
            ? [
                {
                  id,
                  kind: change.step,
                  place: change.repository ?? '.',
                  what: change.path ?? change.line ?? change.command ?? '',
                },
              ]
            : [],
        ),
      }
    case 'variables':
      // The value is the engine's alone: the card never holds it.
      return {
        kind,
        items: cards.flatMap(({ id, change }) =>
          change.kind === 'variable' ? [{ id, key: change.name, value: '' }] : [],
        ),
      }
    case 'specLanguage':
      return {
        kind,
        items: cards.flatMap(({ id, change }) =>
          change.kind === 'specLanguage'
            ? [{ id, tag: change.language, source: change.source }]
            : [],
        ),
      }
    case 'never':
      return { kind, items: [] }
  }
}

/** The Project's latest setup session, the last the setup role started; null when none ran. */
export const latestSetupOf = (sessions: ReadonlyArray<SessionSummary>): SessionSummary | null =>
  sessions
    .filter((one) => one.role === SETUP_ROLE)
    .reduce<SessionSummary | null>(
      (latest, one) =>
        latest === null || Date.parse(one.createdAt) > Date.parse(latest.createdAt) ? one : latest,
      null,
    )

/**
 * The cards of the latest setup: those written since its session started, and whatever still
 * waits for its answer from before. The engine keeps every card ever proposed; a setup launched
 * again does not show the earlier ones' answers. Every card when no session is known.
 */
export const sinceLatestSetup = (
  cards: ReadonlyArray<SetupCard>,
  latest: SessionSummary | null,
): ReadonlyArray<SetupCard> => {
  if (latest === null) return cards
  const start = Date.parse(latest.createdAt)
  // What waits from before is carried over; the scripts a setup listed apart are its own.
  return cards.filter(
    (card) => Date.parse(card.createdAt) >= start || (card.state === 'pending' && !isListed(card)),
  )
}

/**
 * The setup sessions of the latest setup's lineage, oldest first: a setup started again for a
 * discussion is still the same setup.
 */
export const setupLineageOf = (sessions: ReadonlyArray<SessionSummary>): SessionSummary[] => {
  const latest = latestSetupOf(sessions)
  if (latest === null) return []
  return sessions
    .filter((one) => one.role === SETUP_ROLE && one.lineage === latest.lineage)
    .toSorted((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
}

/**
 * One card per kind the agent proposed something for, in the settings' order. A card another took
 * the place of (the user's edit, the agent's revision) is not drawn.
 */
export function setupEntriesOf(cards: ReadonlyArray<SetupCard>): SetupCardEntry[] {
  return KINDS.flatMap(([, kind]) => {
    const ofKind = cards
      .filter((card) => kindOf(card) === kind && card.state !== 'revised')
      .toSorted((a, b) => a.createdAt.localeCompare(b.createdAt))
    return ofKind.length === 0
      ? []
      : [{ kind, status: statusOf(ofKind), proposal: proposalOf(kind, ofKind) }]
  })
}

/** What the header says of the setup agent; one never asked for has nothing more to do. */
export const setupAgentOf = (standing: SetupStanding): SetupAgent =>
  standing.state === 'none' ? 'done' : standing.state

/** An answer to the cards: they are read again either way, and a refusal is said in words. */
export const answerSaid = (
  work: Promise<unknown>,
  reread: () => void,
  say: (sentence: string) => void,
): void => {
  work.then(reread, (failure: Error) => {
    say(`Your answer could not be given: ${failure.message}`)
    reread()
  })
}

/** When the setup agent started and ended, as its chip counts it. */
export interface AgentTimes {
  readonly startedAt: number
  readonly endedAt: number | null
}

/**
 * The agent's times once it stands as `agent` at `now`: its end kept from the moment it ended, a
 * new start when it works again. The same times when nothing changed.
 */
export function agentTimesOf(times: AgentTimes, agent: SetupAgent, now: number): AgentTimes {
  const ended = agent === 'done' || agent === 'failed'
  if (ended && times.endedAt === null) return { startedAt: times.startedAt, endedAt: now }
  if (!ended && times.endedAt !== null) return { startedAt: now, endedAt: null }
  return times
}

/**
 * The chip's times from the latest setup session: when it started, and when it ended. With no
 * session known (not read, or none ran), `kept`: the times the page counted itself.
 */
export function setupTimesOf(session: SessionSummary | null, kept: AgentTimes): AgentTimes {
  if (session === null) return kept
  return {
    startedAt: Date.parse(session.createdAt),
    endedAt: session.endedAt === null ? null : Date.parse(session.endedAt),
  }
}

/** What the agent's chip opens: who it is, and the step it stands at. */
export const setupGlanceOf = (standing: SetupStanding): LiveGlance => ({
  kind: 'helper',
  type: 'Setup agent',
  step: standing.sentence ?? STEPS[setupAgentOf(standing)],
})

const STEPS: Record<SetupAgent, string> = {
  waiting: 'Waiting for a free slot',
  working: 'Reading the Project folder',
  done: 'Proposed the setup',
  failed: 'Stopped',
}

/**
 * Whether the setup is a task of the Project now: while the agent waits or works, or a proposal
 * waits for its answer. Once every proposal is answered, it leaves the page, and so does a setup
 * that stopped with nothing left to answer: it is launched again from the Project's settings.
 */
export function setupIsTask(standing: SetupStanding, cards: ReadonlyArray<SetupCard>): boolean {
  if (standing.state === 'waiting' || standing.state === 'working') return true
  return cards.some((card) => card.state === 'pending' && !isListed(card))
}

/** What the Tasks row of a Project's page reads of its setup. */
export interface SetupRead {
  readonly standing: SetupStanding
  /** The latest setup's cards (`sinceLatestSetup`). */
  readonly cards: ReadonlyArray<SetupCard>
  /** Why the setup could not be read, in words; null once it is. */
  readonly unread: string | null
}

/** The setup's chip as the Tasks row draws it: the agent's state, and why it stopped. */
export interface SetupShown {
  readonly agent: SetupAgent
  readonly failure: string | undefined
}

/**
 * The setup's chip on the Project's page, or null when the page has no task to show: while it is
 * a task (`setupIsTask`), when it cannot be read, or when its last launch was refused, said even
 * if no setup ever ran. A refusal waits for an agent at work to stop: the chip says the agent.
 */
export function setupShownOf(read: SetupRead, refused: string | undefined): SetupShown | null {
  if (read.unread !== null) {
    return { agent: 'failed', failure: `The setup could not be read: ${read.unread}` }
  }
  if (refused === undefined && !setupIsTask(read.standing, read.cards)) return null
  const running = read.standing.state === 'waiting' || read.standing.state === 'working'
  const agent = refused !== undefined && !running ? 'failed' : setupAgentOf(read.standing)
  return {
    agent,
    failure: agent === 'failed' ? (refused ?? read.standing.sentence ?? undefined) : undefined,
  }
}

/** Where a Project's setup launch stands: on its way, and why the last one was refused. */
export interface LaunchState {
  readonly starting: boolean
  readonly refused: string | undefined
}

export const NO_LAUNCH: LaunchState = { starting: false, refused: undefined }

/**
 * Launches a Project's setup, one launch at a time per Project: one asked while another for the
 * same Project is on its way is not made, and answers false. `told` hears each Project's launch
 * state as it changes; the promise answers whether it started.
 */
export function setupLauncher(
  propose: (projectId: string) => Promise<void>,
  told: (projectId: string, state: LaunchState) => void,
): (projectId: string) => Promise<boolean> {
  const launching = new Set<string>()
  return (projectId) => {
    if (launching.has(projectId)) return Promise.resolve(false)
    launching.add(projectId)
    told(projectId, { starting: true, refused: undefined })
    return propose(projectId)
      .then(
        () => {
          told(projectId, NO_LAUNCH)
          return true
        },
        (failure: Error) => {
          told(projectId, {
            starting: false,
            refused: `The setup agent could not start: ${failure.message}`,
          })
          return false
        },
      )
      .finally(() => launching.delete(projectId))
  }
}

/** Whether an agent can run the setup: nothing to say when one can, or why none can. */
export interface SetupOffer {
  readonly unavailable?: string | undefined
}

export function setupOfferOf(
  agents: ReadonlyArray<Pick<AgentState, 'id' | 'label' | 'installed' | 'signedIn'>>,
  roles: ReadonlyArray<Pick<RoleModels, 'role' | 'resolved'>>,
): SetupOffer {
  const provider = roles.find((role) => role.role === SETUP_ROLE)?.resolved.agent
  if (provider === undefined) return { unavailable: 'No agent runs the setup' }
  const agent = agents.find((one) => one.id === provider)
  // The setup role's agent is the one that matters: others installed do not run it.
  if (agent === undefined) return { unavailable: `${provider} is not installed` }
  if (!agent.installed) return { unavailable: `${agent.label} is not installed` }
  if (!agent.signedIn) return { unavailable: `${agent.label} is not signed in` }
  return {}
}

/**
 * The setup offered once the agents and the roles' models are read: null while either is on its
 * way, and a read refused said as the reason none is offered.
 */
export function setupOfferRead(
  agents: Read<ReadonlyArray<Pick<AgentState, 'id' | 'label' | 'installed' | 'signedIn'>>>,
  roles: Read<ReadonlyArray<Pick<RoleModels, 'role' | 'resolved'>>>,
): SetupOffer | null {
  const refused = agents.kind === 'failed' ? agents : roles.kind === 'failed' ? roles : null
  if (refused !== null) {
    return { unavailable: `Who would run the setup could not be read: ${refused.sentence}` }
  }
  if (agents.kind !== 'ready' || roles.kind !== 'ready') return null
  return setupOfferOf(agents.value, roles.value)
}

/** The role the setup agent runs as (#44). */
const SETUP_ROLE = 'setup'

/** Who runs the setup, as its chip's menu says it: the agent and the model its role resolves to. */
export function setupAboutOf(
  agents: ReadonlyArray<Pick<AgentState, 'id' | 'label'>>,
  roles: ReadonlyArray<Pick<RoleModels, 'role' | 'resolved'>>,
): string | undefined {
  const resolved = roles.find((role) => role.role === SETUP_ROLE)?.resolved
  const agent = agents.find((one) => one.id === resolved?.agent)
  if (resolved === undefined || agent === undefined) return undefined
  return `Agent · ${agent.label} · ${resolved.model ?? 'its default model'}`
}

/** What the setup agent said, oldest first, from its session's thread. */
export const setupMessagesOf = (thread: ReadonlyArray<ThreadLine>): string[] =>
  thread.filter((line) => line.kind === 'said').map((line) => line.text)

/** What an edit sends: the waiting cards it replaces, and the changes written in their place. */
export type EditedCards =
  | { readonly cardIds: ReadonlyArray<string>; readonly changes: ReadonlyArray<EditedChange> }
  | { readonly refused: string }

/** Said of a line the editor left without what it needs. */
export const LINE_MISSING = 'A line is missing what it needs: fill it in or remove it.'

/** A change as the editor wrote it, the fields it left empty not written. */
const written = (fields: Record<string, string | boolean | ReadonlyArray<string> | undefined>) =>
  Object.fromEntries(
    Object.entries(fields).flatMap(([key, value]) =>
      value === undefined || (Predicate.isString(value) && value.trim() === '')
        ? []
        : [[key, Predicate.isString(value) ? value.trim() : value]],
    ),
  )

/** A repository's base as the editor writes it, `origin/main`, back into its remote and branch. */
/** Where a repository's work starts from, as its change says it. */
interface RepositoryBase {
  readonly remote?: string | undefined
  readonly baseBranch?: string | undefined
}

const baseOf = (base: string, remote: string | undefined): RepositoryBase => {
  const said = base.trim()
  if (remote !== undefined && said === remote) return { remote }
  if (remote !== undefined && said.startsWith(`${remote}/`)) {
    return { remote, baseBranch: said.slice(remote.length + 1) }
  }
  const slash = said.indexOf('/')
  return slash === -1
    ? { baseBranch: said }
    : { remote: said.slice(0, slash), baseBranch: said.slice(slash + 1) }
}

/** A line of the editor as the change it proposes, what the editor does not show kept from `was`. */
const proposalOfLine = (
  draft: Proposal,
  at: number,
  was: SetupCard['change'] | undefined,
): Schema.Json | null => {
  switch (draft.kind) {
    case 'repositories': {
      const item = draft.items[at]
      if (item === undefined) return null
      const remote = was?.kind === 'repository' ? was.remote : undefined
      return written({ kind: 'repository', path: item.path, ...baseOf(item.base, remote) })
    }
    case 'commands': {
      const item = draft.items[at]
      if (item === undefined) return null
      if (was?.kind === 'command') {
        const { replaces: _replaces, ...kept } = was
        return written({ ...kept, name: item.name, line: item.line })
      }
      return written({ kind: 'command', name: item.name, type: item.type, line: item.line })
    }
    case 'preparation': {
      const item = draft.items[at]
      if (item === undefined) return null
      if (was?.kind === 'step') {
        const field = was.path !== undefined ? 'path' : was.line !== undefined ? 'line' : 'command'
        return written({ ...was, [field]: item.what })
      }
      return written({
        kind: 'step',
        step: item.kind,
        repository: item.place === '.' ? undefined : item.place,
        [item.kind === 'run' ? 'line' : 'path']: item.what,
      })
    }
    case 'variables': {
      const item = draft.items[at]
      // A value left empty keeps the one the card holds: the engine knows it, the page does not.
      return item === undefined
        ? null
        : { kind: 'variable', name: item.key.trim(), value: item.value }
    }
    case 'specLanguage': {
      const item = draft.items[at]
      if (item === undefined) return null
      return written({ kind: 'specLanguage', language: item.tag, source: item.source })
    }
    case 'never':
      return null
  }
}

const readProposal = Schema.decodeUnknownOption(SetupProposal)

/**
 * A kind's edit as the engine takes it: its waiting cards, replaced by the editor's lines. A line
 * that was a decided card is left alone; one the editor left without what it needs is said.
 */
export function editedChangesOf(cards: ReadonlyArray<SetupCard>, draft: Proposal): EditedCards {
  const waiting = pendingOf(cards, draft.kind)
  const byId = new Map(cards.map((card) => [card.id, card]))
  const changes: EditedChange[] = []
  for (const [at, item] of draft.items.entries()) {
    // The scripts listed apart are not edited: they stay as they are.
    if ('other' in item && item.other === true) continue
    const card = byId.get(item.id)
    if (card !== undefined && card.state !== 'pending') continue
    const proposal = readProposal(proposalOfLine(draft, at, card?.change))
    if (Option.isNone(proposal)) return { refused: LINE_MISSING }
    changes.push({ from: card?.id ?? null, proposal: proposal.value })
  }
  return { cardIds: waiting.map((card) => card.id), changes }
}
