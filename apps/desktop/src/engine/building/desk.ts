/**
 * Where the gate reaches the Building (#141): the Builder's six tools, and the file claims as a
 * mandatory guard of the writing tools. The Builder's service stands on the sessions, above the
 * gate; it puts its work here once it runs, and a call made before waits for it, as the Probes'
 * desk does.
 */

import type { ToolArguments } from '@hemera/core/domain'
import { Context, Deferred, Effect, Layer } from 'effect'

import type { Grant } from '../tools/access.ts'
import type { ToolAnswer } from '../tools/files.ts'
import { GateGuards, type Guard, type GuardedCall } from '../tools/ports.ts'

export interface BuildWork {
  readonly read: (grant: Grant, args: ToolArguments<'build_read'>) => Effect.Effect<ToolAnswer>
  readonly start: (grant: Grant, args: ToolArguments<'task_start'>) => Effect.Effect<ToolAnswer>
  readonly finished: (
    grant: Grant,
    args: ToolArguments<'task_finished'>,
  ) => Effect.Effect<ToolAnswer>
  readonly blocked: (grant: Grant, args: ToolArguments<'task_blocked'>) => Effect.Effect<ToolAnswer>
  readonly need: (grant: Grant, args: ToolArguments<'report_need'>) => Effect.Effect<ToolAnswer>
  readonly summary: (
    grant: Grant,
    args: ToolArguments<'build_summary'>,
  ) => Effect.Effect<ToolAnswer>
  /** A write's claim: refused when another running task holds the file, recorded when outside. */
  readonly claim: Guard
}

export class BuildDesk extends Context.Service<
  BuildDesk,
  BuildWork & { readonly serve: (work: BuildWork) => Effect.Effect<void> }
>()('BuildDesk') {}

/** The tools whose path a claim guards. */
const WRITES: ReadonlyArray<GuardedCall['tool']> = ['fs_write', 'fs_edit']

export const buildDeskLayer = Layer.effect(
  BuildDesk,
  Effect.gen(function* () {
    const served = yield* Deferred.make<BuildWork>()
    const work = Deferred.await(served)
    return {
      read: (grant, args) => Effect.flatMap(work, (one) => one.read(grant, args)),
      start: (grant, args) => Effect.flatMap(work, (one) => one.start(grant, args)),
      finished: (grant, args) => Effect.flatMap(work, (one) => one.finished(grant, args)),
      blocked: (grant, args) => Effect.flatMap(work, (one) => one.blocked(grant, args)),
      need: (grant, args) => Effect.flatMap(work, (one) => one.need(grant, args)),
      summary: (grant, args) => Effect.flatMap(work, (one) => one.summary(grant, args)),
      // Only a mission's write to a path is a claim's business: nothing else waits for the desk.
      claim: (call) =>
        call.session.missionId === null || call.path === null || !WRITES.includes(call.tool)
          ? Effect.succeed(null)
          : Effect.flatMap(work, (one) => one.claim(call)),
      serve: (one) => Effect.asVoid(Deferred.succeed(served, one)),
    }
  }),
)

/** The gate's guards: the claims of a Building. */
export const claimGuards = Layer.effect(
  GateGuards,
  Effect.map(BuildDesk, (desk) => [desk.claim]),
)
