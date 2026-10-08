/**
 * What the Planning page calls (#103): the user's side of Planning, each gesture stored first and
 * then delivered to the Planner (the vision, answers and waiting marks as inputs, #86), and the
 * Spec as it changes.
 */

import { Effect, Stream } from 'effect'

import { DomainEvents } from '../domain-events.ts'
import { SpecBoard } from './board.ts'
import { prepareDeliveries } from './handover.ts'
import { recordAnswer, recordWaiting } from './questions.ts'
import { addVision, keepAfterTriage, readSpec } from './store.ts'
import { PlannerWake } from './wake.ts'

/** Hands every received input of the mission to its Planner, which starts if none lives. */
export const deliverInputs = (missionId: string) =>
  Effect.gen(function* () {
    const deliveries = yield* prepareDeliveries(missionId)
    for (const one of deliveries) {
      yield* PlannerWake.use((wake) => wake.deliver(missionId, one.kind, one.body, one.id))
    }
  })

/** The user's vision: stored, then delivered to the Planner, which starts if none lives. */
export const giveVision = (missionId: string, text: string) =>
  Effect.andThen(addVision(missionId, text), deliverInputs(missionId))

/** The user answers a question; a new answer or version is delivered to the Planner. */
export const answerQuestion = (
  missionId: string,
  questionId: string,
  given: { readonly optionId?: string | undefined; readonly text?: string | undefined },
) =>
  Effect.gen(function* () {
    if (yield* recordAnswer(missionId, questionId, given)) yield* deliverInputs(missionId)
  })

/** The user says a question waits on someone; the Planner is told. */
export const waitOnSomeone = (missionId: string, questionId: string, note: string | null) =>
  Effect.gen(function* () {
    if (yield* recordWaiting(missionId, questionId, note)) yield* deliverInputs(missionId)
  })

/** What the Planner is told when the user keeps planning a mission it triaged. */
export const TRIAGE_KEPT =
  'The user read your triage answer and chose to keep planning this mission: plan it.'

/** The user keeps planning a triaged mission: its Planner is told once, however often it is asked. */
export const keepPlanning = (missionId: string) =>
  Effect.gen(function* () {
    const kept = yield* keepAfterTriage(missionId)
    if (kept) yield* PlannerWake.use((wake) => wake.deliver(missionId, 'triage-kept', TRIAGE_KEPT))
  })

/** The Spec now, then again after each change of it or of its mission, while the caller listens. */
export const specChanges = (missionId: string) =>
  Stream.unwrap(
    Effect.gen(function* () {
      const written = yield* SpecBoard.use((board) => board.changes)
      const committed = yield* DomainEvents.use((events) => events.subscribe)
      const changes = Stream.merge(
        written.pipe(Stream.filter((changed) => changed === missionId)),
        committed.pipe(
          Stream.filter((event) => event.entityKind === 'mission' && event.entityId === missionId),
        ),
      )
      return Stream.concat(
        Stream.fromEffect(readSpec(missionId)),
        changes.pipe(Stream.mapEffect(() => readSpec(missionId))),
      )
    }),
  )
