/**
 * Where the gate reaches the helpers (#145): `helper_launch`, `helper_read` and `helper_result`.
 * The helpers' service stands on the sessions, above the gate; it puts its work here once it runs,
 * and a call made before waits for it, as the Builder's desk does. There is no stop.
 */

import type { ToolArguments } from '@hemera/core/domain'
import { Context, Deferred, Effect, Layer } from 'effect'

import type { Grant } from '../tools/access.ts'
import type { ToolAnswer } from '../tools/files.ts'

export interface HelperWork {
  readonly launch: (grant: Grant, args: ToolArguments<'helper_launch'>) => Effect.Effect<ToolAnswer>
  readonly read: (grant: Grant, args: ToolArguments<'helper_read'>) => Effect.Effect<ToolAnswer>
  readonly result: (grant: Grant, args: ToolArguments<'helper_result'>) => Effect.Effect<ToolAnswer>
}

export class HelperDesk extends Context.Service<
  HelperDesk,
  HelperWork & { readonly serve: (work: HelperWork) => Effect.Effect<void> }
>()('HelperDesk') {}

export const helperDeskLayer = Layer.effect(
  HelperDesk,
  Effect.gen(function* () {
    const served = yield* Deferred.make<HelperWork>()
    const work = Deferred.await(served)
    return {
      launch: (grant, args) => Effect.flatMap(work, (one) => one.launch(grant, args)),
      read: (grant, args) => Effect.flatMap(work, (one) => one.read(grant, args)),
      result: (grant, args) => Effect.flatMap(work, (one) => one.result(grant, args)),
      serve: (one) => Effect.asVoid(Deferred.succeed(served, one)),
    }
  }),
)
