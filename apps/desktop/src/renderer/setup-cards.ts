/**
 * The setup agent's cards (#44) as the new-Project page draws them (#53), plain values and no
 * React. The engine proposes one card per change; the page shows one card per kind (the
 * repositories, the commands, the preparation, the variables), holding that kind's changes. A
 * kind's Accept and Decline go to its changes still waiting, in the order proposed.
 */

import type { SetupCard, SetupStanding } from '@hemera/ipc'
import type { CardStatus, Proposal, SetupAgent, SetupCardEntry, SetupKind } from '@hemera/ui'

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
                  base: `${change.remote ?? 'origin'}/${change.baseBranch ?? 'main'}`,
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
