/**
 * Where the gate reaches the team comments (R8): the Planner's draft in team-comment mode. The team
 * comments' service stands on the sessions, above the gate; it puts its work here once it runs, and
 * a call made before waits for it, as the rounds' desk does.
 */

import type { ToolArguments } from '@hemera/core/domain'
import { Context, Deferred, Effect, Layer } from 'effect'

import type { Grant } from '../tools/access.ts'
import type { ToolAnswer } from '../tools/files.ts'

export interface TeamCommentWork {
  readonly draft: (
    grant: Grant,
    args: ToolArguments<'team_comment_draft'>,
  ) => Effect.Effect<ToolAnswer>
}

export class TeamCommentDesk extends Context.Service<
  TeamCommentDesk,
  TeamCommentWork & { readonly serve: (work: TeamCommentWork) => Effect.Effect<void> }
>()('TeamCommentDesk') {}

export const teamCommentDeskLayer = Layer.effect(
  TeamCommentDesk,
  Effect.gen(function* () {
    const served = yield* Deferred.make<TeamCommentWork>()
    const work = Deferred.await(served)
    return {
      draft: (grant, args) => Effect.flatMap(work, (one) => one.draft(grant, args)),
      serve: (one) => Effect.asVoid(Deferred.succeed(served, one)),
    }
  }),
)
