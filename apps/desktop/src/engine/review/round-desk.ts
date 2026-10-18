/**
 * Where the gate reaches a Review round (#468): the Planner's tools in round mode and the
 * answers to the round's feedback. The rounds' service stands on the sessions, above the gate; it
 * puts its work here once it runs, and a call made before waits for it, as the reviewers' desk does.
 */

import type { ToolArguments } from '@hemera/core/domain'
import { Context, Deferred, Effect, Layer } from 'effect'

import type { Grant } from '../tools/access.ts'
import type { ToolAnswer } from '../tools/files.ts'

export interface RoundWork {
  readonly pointWrite: (
    grant: Grant,
    args: ToolArguments<'round_point_write'>,
  ) => Effect.Effect<ToolAnswer>
  readonly pointRemove: (
    grant: Grant,
    args: ToolArguments<'round_point_remove'>,
  ) => Effect.Effect<ToolAnswer>
  readonly tasksWrite: (
    grant: Grant,
    args: ToolArguments<'round_tasks_write'>,
  ) => Effect.Effect<ToolAnswer>
  readonly proposeMission: (
    grant: Grant,
    args: ToolArguments<'round_propose_mission'>,
  ) => Effect.Effect<ToolAnswer>
  readonly ready: (grant: Grant, args: ToolArguments<'round_ready'>) => Effect.Effect<ToolAnswer>
  readonly answer: (
    grant: Grant,
    args: ToolArguments<'feedback_answer'>,
  ) => Effect.Effect<ToolAnswer>
}

export class RoundDesk extends Context.Service<
  RoundDesk,
  RoundWork & { readonly serve: (work: RoundWork) => Effect.Effect<void> }
>()('RoundDesk') {}

export const roundDeskLayer = Layer.effect(
  RoundDesk,
  Effect.gen(function* () {
    const served = yield* Deferred.make<RoundWork>()
    const work = Deferred.await(served)
    return {
      pointWrite: (grant, args) => Effect.flatMap(work, (one) => one.pointWrite(grant, args)),
      pointRemove: (grant, args) => Effect.flatMap(work, (one) => one.pointRemove(grant, args)),
      tasksWrite: (grant, args) => Effect.flatMap(work, (one) => one.tasksWrite(grant, args)),
      proposeMission: (grant, args) =>
        Effect.flatMap(work, (one) => one.proposeMission(grant, args)),
      ready: (grant, args) => Effect.flatMap(work, (one) => one.ready(grant, args)),
      answer: (grant, args) => Effect.flatMap(work, (one) => one.answer(grant, args)),
      serve: (one) => Effect.asVoid(Deferred.succeed(served, one)),
    }
  }),
)
