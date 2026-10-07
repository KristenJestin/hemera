/**
 * What the Planning page calls (#103): the user's side of Planning, each gesture stored first and
 * then delivered to the Planner, and the Spec as it changes.
 */

import { Effect, Stream } from 'effect'

import { DomainEvents } from '../domain-events.ts'
import { SpecBoard } from './board.ts'
import { addVision, keepAfterTriage, readSpec } from './store.ts'
import { PlannerWake } from './wake.ts'

/** The vision, as the Planner is handed it. */
export const visionDelivered = (text: string, at: string): string =>
  [
    `The user's vision, given ${at}:`,
    text,
    'Check it against the code before you use it; never copy it into the Spec as a decision unchecked.',
  ].join('\n\n')

/** What the Planner is told when the user keeps planning a mission it triaged. */
export const TRIAGE_KEPT =
  'The user read your triage answer and chose to keep planning this mission: plan it.'

/** The user's vision: stored, then delivered to the Planner, which starts if none lives. */
export const giveVision = (missionId: string, text: string) =>
  Effect.gen(function* () {
    const vision = yield* addVision(missionId, text)
    yield* PlannerWake.use((wake) =>
      wake.deliver(missionId, 'vision', visionDelivered(vision.text, vision.at)),
    )
  })

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
