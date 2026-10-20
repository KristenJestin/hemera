/**
 * The team's comments from the forge (R8): what the Planner in team-comment mode returns of each.
 * Its reading and its reply draft stay internal: Hemera stores them for the user, never sends
 * them anywhere, and never posts on the forge.
 */

import { Schema } from 'effect'

const Bounded = (maximum: number, description: string) =>
  Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(maximum)).annotate({ description })

/** What `team_comment_draft` carries. */
export const TeamCommentDraft = Schema.Struct({
  comment: Bounded(80, 'The team comment, by the id your brief gives it.'),
  reading: Bounded(
    4000,
    'What the comment asks or reports, in the user’s language, and whether it agrees or conflicts with the Spec.',
  ),
  reply: Bounded(
    4000,
    'A reply the user may send themselves, in the comment’s language, short and factual. Never promise a change.',
  ),
}).annotate({
  description:
    'Store your reading of one team comment and a reply draft, both internal: nothing is sent anywhere. Call it once per comment of your brief.',
})
export type TeamCommentDraft = typeof TeamCommentDraft.Type
