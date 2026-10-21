/**
 * Where the gate reaches the delivery (S1): the Delivery agent's `delivery_step_report`. The
 * delivery's Agent steps stand on the sessions, above the gate; they put their work here once they
 * run, and a call made before waits for it, as the team comments' desk does.
 */

import type { ToolArguments } from '@hemera/core/domain'
import { Context, Deferred, Effect, Layer } from 'effect'

import type { Grant } from '../tools/access.ts'
import type { ToolAnswer } from '../tools/files.ts'

export interface DeliveryWork {
  readonly report: (
    grant: Grant,
    args: ToolArguments<'delivery_step_report'>,
  ) => Effect.Effect<ToolAnswer>
}

export class DeliveryDesk extends Context.Service<
  DeliveryDesk,
  DeliveryWork & { readonly serve: (work: DeliveryWork) => Effect.Effect<void> }
>()('DeliveryDesk') {}

export const deliveryDeskLayer = Layer.effect(
  DeliveryDesk,
  Effect.gen(function* () {
    const served = yield* Deferred.make<DeliveryWork>()
    const work = Deferred.await(served)
    return {
      report: (grant, args) => Effect.flatMap(work, (one) => one.report(grant, args)),
      serve: (one) => Effect.asVoid(Deferred.succeed(served, one)),
    }
  }),
)
