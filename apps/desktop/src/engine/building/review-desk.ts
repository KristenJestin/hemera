/**
 * Where the gate reaches the reviewers of the automatic review (#147): `review_report`,
 * `checkpoint_read` and `evidence_read`. The reviewers' service stands on the sessions, above the
 * gate; it puts its work here once it runs, and a call made before waits for it, as the
 * documenter's desk does.
 */

import type { ToolArguments } from '@hemera/core/domain'
import { Context, Deferred, Effect, Layer } from 'effect'

import type { Grant } from '../tools/access.ts'
import type { ToolAnswer } from '../tools/files.ts'

export interface ReviewWork {
  readonly report: (grant: Grant, args: ToolArguments<'review_report'>) => Effect.Effect<ToolAnswer>
  readonly checkpoint: (
    grant: Grant,
    args: ToolArguments<'checkpoint_read'>,
  ) => Effect.Effect<ToolAnswer>
  readonly evidence: (
    grant: Grant,
    args: ToolArguments<'evidence_read'>,
  ) => Effect.Effect<ToolAnswer>
}

export class ReviewDesk extends Context.Service<
  ReviewDesk,
  ReviewWork & { readonly serve: (work: ReviewWork) => Effect.Effect<void> }
>()('ReviewDesk') {}

export const reviewDeskLayer = Layer.effect(
  ReviewDesk,
  Effect.gen(function* () {
    const served = yield* Deferred.make<ReviewWork>()
    const work = Deferred.await(served)
    return {
      report: (grant, args) => Effect.flatMap(work, (one) => one.report(grant, args)),
      checkpoint: (grant, args) => Effect.flatMap(work, (one) => one.checkpoint(grant, args)),
      evidence: (grant, args) => Effect.flatMap(work, (one) => one.evidence(grant, args)),
      serve: (one) => Effect.asVoid(Deferred.succeed(served, one)),
    }
  }),
)
