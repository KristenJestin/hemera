/**
 * What the Project's start field shows, with no React: the stream of `start.search` folded into the
 * results the field draws (the Project's missions, then the remote tickets, "Create a mission"
 * always last), the creation each choice asks of the engine, and the opening of the mission it
 * creates.
 */

import { type ProviderHit, canonicalTicket } from '@hemera/core/domain'
import type {
  CreateChoice as CreateChoiceSchema,
  MissionFound as MissionFoundSchema,
  StartCreate,
  StartResult,
  TicketFound as TicketFoundSchema,
} from '@hemera/ipc'
import type { StartResultView } from '@hemera/ui'
import { Match } from 'effect'

import type { Link } from './link.ts'

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

/** What the search for the text typed has said, and whether its stream ended. */
export interface Search {
  for: string
  fold: StartFold
  /** The stream ended without failing. */
  done: boolean
  /** The words of the failure that stopped the stream, if one did. */
  ended: string | null
}

/** Whether the search for `typed` still goes on: nothing said yet, or its stream is still open. */
export function searchPending(search: Search | null, typed: string): boolean {
  return search?.for !== typed || (!search.done && search.ended === null)
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

/**
 * Starts the mission a choice asks for and opens it at once, under its key: the Planner's triage
 * answer then stands on the mission's own page, not in the field. A refusal opens nothing.
 */
export function startAndOpen(
  link: Pick<Link, 'createStart'>,
  made: StartCreate,
  then: { opened: (key: string) => void; refused: (sentence: string) => void },
): Promise<void> {
  return link.createStart(made).then(
    (mission) => then.opened(mission.key),
    (failure: Error) => then.refused(`The mission could not be started: ${failure.message}`),
  )
}

/**
 * What the start field opens with when a mission is started from a feedback ("Start a mission
 * from this"): its words, the mission and the feedback it comes from, and how that origin is said.
 */
export interface StartSeed {
  readonly text: string
  readonly origin: string
  readonly originFeedback: string
  /** `Started from ACME-12, round 2`. */
  readonly said: string
}

/** A creation started from a feedback carries its origin: the remark closes once it is created. */
export const seededCreate = (made: StartCreate, seed: StartSeed | undefined): StartCreate =>
  seed === undefined ? made : { ...made, origin: seed.origin, originFeedback: seed.originFeedback }
