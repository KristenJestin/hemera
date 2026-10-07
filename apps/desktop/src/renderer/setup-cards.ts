/**
 * The setup agent's cards (#44) as the new-Project page draws them (#53), plain values and no
 * React. The engine proposes one card per change; the page shows one card per kind (the
 * repositories, the commands, the preparation, the variables), holding that kind's changes. A
 * kind's Accept and Decline go to its changes still waiting, in the order proposed.
 */

import type { SetupCard, SetupStanding } from '@hemera/ipc'
import type {
  CardStatus,
  LiveGlance,
  Proposal,
  SetupAgent,
  SetupCardEntry,
  SetupKind,
} from '@hemera/ui'

import type { Route } from './navigation.ts'

/** The page's kind of each change the engine proposes, in the settings' order. */
const KINDS: ReadonlyArray<readonly [SetupCard['change']['kind'], SetupKind]> = [
  ['repository', 'repositories'],
  ['command', 'commands'],
  ['step', 'preparation'],
  ['variable', 'variables'],
]

const kindOf = (card: SetupCard): SetupKind | undefined =>
  KINDS.find(([change]) => change === card.change.kind)?.[1]

/** A kind's changes still waiting for the user, in the order proposed. */
export const pendingOf = (cards: ReadonlyArray<SetupCard>, kind: SetupKind): SetupCard[] =>
  cards
    .filter((card) => kindOf(card) === kind && card.state === 'pending')
    .toSorted((a, b) => a.createdAt.localeCompare(b.createdAt))

const statusOf = (cards: ReadonlyArray<SetupCard>): CardStatus => {
  const waiting = cards.filter((card) => card.state === 'pending')
  if (waiting.length > 0) {
    const refused = waiting.findLast((card) => card.refusal !== null)?.refusal ?? undefined
    return { state: 'proposed', refused }
  }
  return cards.some((card) => card.state === 'accepted')
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
        items: cards.flatMap(({ id, change }) =>
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
    case 'never':
      return { kind, items: [] }
  }
}

/** One card per kind the agent proposed something for, in the settings' order. */
export function setupEntriesOf(cards: ReadonlyArray<SetupCard>): SetupCardEntry[] {
  return KINDS.flatMap(([, kind]) => {
    const ofKind = cards
      .filter((card) => kindOf(card) === kind)
      .toSorted((a, b) => a.createdAt.localeCompare(b.createdAt))
    return ofKind.length === 0
      ? []
      : [{ kind, status: statusOf(ofKind), proposal: proposalOf(kind, ofKind) }]
  })
}

/** What the header says of the setup agent; one never asked for has nothing more to do. */
export const setupAgentOf = (standing: SetupStanding): SetupAgent =>
  standing.state === 'none' ? 'done' : standing.state

/**
 * A new Project's setup, once the dialog has created it: the proposal asked for, then its page,
 * which reads the agent under way rather than one never asked. A proposal the engine refuses
 * leads to the Project's page.
 */
export const startSetup = (
  propose: (projectId: string) => Promise<void>,
  projectId: string,
  go: (route: Route) => void,
): Promise<void> =>
  propose(projectId).then(
    () => go({ kind: 'projectSetup', id: projectId }),
    () => go({ kind: 'project', id: projectId }),
  )

/** The agent ended with nothing for the user to answer: the setup page has nothing to show. */
export const nothingProposed = (standing: SetupStanding, cards: ReadonlyArray<SetupCard>) =>
  standing.state === 'done' && cards.length === 0

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

/** What setting a Project up again asks of the link. */
export interface SetUpTools {
  readonly setupStanding: (projectId: string) => Promise<SetupStanding>
  readonly setupCards: (projectId: string) => Promise<ReadonlyArray<SetupCard>>
  readonly proposeSetup: (projectId: string) => Promise<void>
}

/**
 * Sets a Project up again from its settings: an agent still at work, or a card still waiting,
 * opens what it proposed; otherwise a new proposal is asked for, then its page opens.
 */
export async function setUpAgain(
  tools: SetUpTools,
  projectId: string,
  go: (route: Route) => void,
): Promise<void> {
  const [standing, cards] = await Promise.all([
    tools.setupStanding(projectId),
    tools.setupCards(projectId),
  ])
  const going = standing.state === 'waiting' || standing.state === 'working'
  if (going || cards.some((card) => card.state === 'pending')) {
    go({ kind: 'projectSetup', id: projectId })
    return
  }
  await startSetup(tools.proposeSetup, projectId, go)
}
