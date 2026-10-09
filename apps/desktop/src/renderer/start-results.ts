/**
 * What the Project's start field shows, with no React: the stream of `start.search` folded into the
 * results the field draws (the Project's missions, then the remote tickets, "Create a mission"
 * always last), the creation each choice asks of the engine, and the triage answer a created
 * mission carries, turned into the field's words.
 */

import { type ProviderHit, canonicalTicket } from '@hemera/core/domain'
import type {
  CreateChoice as CreateChoiceSchema,
  Mission,
  MissionFound as MissionFoundSchema,
  MissionsChange,
  StartCreate,
  StartResult,
  TicketFound as TicketFoundSchema,
} from '@hemera/ipc'
import type { StartResultView, StartTriage } from '@hemera/ui'
import { Match, Predicate } from 'effect'

type MissionFound = typeof MissionFoundSchema.Type
type TicketFound = typeof TicketFoundSchema.Type
type CreateChoice = typeof CreateChoiceSchema.Type

/** What one search has said so far, in the order it said it. */
export interface StartFold {
  missions: ReadonlyArray<MissionFound>
  tickets: ReadonlyArray<TicketFound>
  create: CreateChoice | null
  notice: string | null
}

export const EMPTY_FOLD: StartFold = { missions: [], tickets: [], create: null, notice: null }

const replacing = <A>(
  list: ReadonlyArray<A>,
  one: A,
  same: (other: A) => boolean,
): ReadonlyArray<A> =>
  list.some(same) ? list.map((other) => (same(other) ? one : other)) : [...list, one]

/** One more answer of the search: a second create choice replaces the first, the others add. */
export function foldStart(fold: StartFold, result: StartResult): StartFold {
  return Match.value(result).pipe(
    Match.tagsExhaustive({
      MissionFound: (one): StartFold => ({
        ...fold,
        missions: replacing(fold.missions, one, (other) => other.mission.id === one.mission.id),
      }),
      TicketFound: (one): StartFold => ({
        ...fold,
        tickets: replacing(fold.tickets, one, (other) => other.hit.canonical === one.hit.canonical),
      }),
      CreateChoice: (one): StartFold => ({ ...fold, create: one }),
      SearchNotice: (one): StartFold => ({ ...fold, notice: one.sentence }),
    }),
  )
}

/** The ticket the create choice would start from, as the row says it. */
function ticketWords(fold: StartFold, choice: CreateChoice): string | null {
  if (choice.ticket === null) return null
  const canonical = canonicalTicket(choice.ticket)
  return fold.tickets.find((found) => found.hit.canonical === canonical)?.hit.key ?? canonical
}

/** The results in the order the field draws them: missions, tickets, then the create choice. */
export function viewsOf(fold: StartFold): StartResultView[] {
  const views: StartResultView[] = [
    ...fold.missions.map((found): StartResultView => ({
      kind: 'mission',
      key: found.mission.key,
      title: found.mission.title,
      done: found.mission.stage === 'done',
      open: found.open,
    })),
    ...fold.tickets.map((found): StartResultView => ({
      kind: 'ticket',
      key: found.hit.key,
      title: found.hit.title,
      linkedMission: found.hit.linkedMission,
    })),
  ]
  if (fold.create !== null)
    views.push({
      kind: 'create',
      title: fold.create.title,
      ticket: ticketWords(fold, fold.create),
    })
  return views
}

/** The creation "Create a mission" asks: the ticket when the text is one, the sentence otherwise. */
export function createOf(
  projectId: string,
  text: string,
  fold: StartFold,
  idempotencyKey: string,
): StartCreate {
  const ticket = fold.create?.ticket ?? null
  if (ticket === null) return { projectId, text, idempotencyKey }
  const canonical = canonicalTicket(ticket)
  const title = fold.tickets.find((found) => found.hit.canonical === canonical)?.hit.title
  return {
    projectId,
    ticket: title === undefined ? { reference: ticket } : { reference: ticket, title },
    idempotencyKey,
  }
}

/** The creation a ticket of the results asks. */
export function createFromTicket(
  projectId: string,
  hit: ProviderHit,
  idempotencyKey: string,
): StartCreate {
  return { projectId, ticket: { reference: hit.reference, title: hit.title }, idempotencyKey }
}

/** The field's triage answer for a mission, or none when the Planner said nothing or it was kept. */
export function triageOf(mission: Mission): StartTriage | undefined {
  const answer = mission.triage
  if (answer === null || answer.state === 'kept') return undefined
  const key = answer.ref ?? mission.key
  switch (answer.kind) {
    case 'existing_mission':
      return { kind: 'belongs', key }
    case 'delivered':
      return { kind: 'delivered', key, proposed: answer.basedOnProposed }
    case 'too_small':
      return { kind: 'small' }
  }
}

/** What a change of the created mission settles: the Planner's answer, or that there is none. */
export type StartSettled =
  | { kind: 'answer'; triage: StartTriage }
  | { kind: 'planning'; key: string }

/**
 * The first change of the mission just created: the Planner answered that it is not new work, or
 * it went on planning, and the mission opens. A change of another mission settles nothing.
 */
export function settleStart(change: MissionsChange, missionId: string): StartSettled | null {
  if (!Predicate.isTagged(change, 'MissionChanged') || change.mission.id !== missionId) return null
  const triage = triageOf(change.mission)
  return triage === undefined
    ? { kind: 'planning', key: change.mission.key }
    : { kind: 'answer', triage }
}
