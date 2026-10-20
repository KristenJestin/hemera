/**
 * The comments of a pull request on its forge (R8), read through the port's `operate` and its
 * registered reads only: Hemera never posts, edits, reacts to or resolves anything on a forge.
 *
 * - **GitHub**: `gh api --paginate --slurp` on the pull request's review comments (inline, with
 *   their path, lines, side and the commit they were made on), its issue comments (general) and its
 *   reviews (their summaries); `gh api graphql` with one fixed query for the review threads and
 *   whether each is resolved. A review that only holds inline comments says nothing of its own and
 *   is left out.
 * - **Bitbucket Cloud and Data Center**: `bkt pr comments <n> --json`, bkt's own list, as read in
 *   its source at `5068ddc` (Cloud's API comments; Data Center's from the activities, its replies
 *   flattened). Neither gives the commit a comment was made on, nor a range: one line.
 *
 * The forge's answers are data written by people: they are read with schemas and handed on as
 * text, never interpreted. The runner has masked what the CLI printed already.
 */

import type { LineRange } from '@hemera/core/domain'
import type { ForgeRefused } from '@hemera/ipc'
import { Effect, Option, Schema } from 'effect'

import { type ForgeFailure, ForgePort, type ForgeTarget, forgeError } from './port.ts'
import type { ForgeAnswer } from './runner.ts'
import { THREADS_QUERY } from './shapes.ts'

export { THREADS_QUERY }

/** Where an inline comment points, as the forge gives it. */
export interface ForgeAnchor {
  readonly path: string
  readonly side: 'new' | 'old'
  readonly lines: LineRange | null
  /** The commit it was made on; null when the forge does not say (Bitbucket). */
  readonly commit: string | null
}

/** One comment of a pull request, as Hemera keeps it. */
export interface ForgeComment {
  /** The forge's id, unique within the pull request (`issue-` and `review-` on GitHub's others). */
  readonly id: string
  readonly kind: 'inline' | 'general' | 'review'
  /** The id of the thread's first comment; null for a comment outside any thread. */
  readonly thread: string | null
  readonly author: string
  readonly body: string
  readonly createdAt: string
  readonly updatedAt: string
  /** What changes when the comment is edited: its updated date, or its version (Data Center). */
  readonly revision: string
  readonly url: string | null
  /** A review summary's verdict; null for a comment. */
  readonly review: 'approved' | 'changes-requested' | 'commented' | null
  readonly anchor: ForgeAnchor | null
  /** The forge's resolved state of its thread. */
  readonly resolved: boolean
  /** Deleted on the forge, and still listed by it (Bitbucket Cloud). */
  readonly removed: boolean
}

const Login = Schema.Struct({ login: Schema.String })
const Line = Schema.optionalKey(Schema.NullOr(Schema.Number))

const GhReviewComment = Schema.Struct({
  id: Schema.Number,
  user: Schema.NullOr(Login),
  body: Schema.String,
  created_at: Schema.String,
  updated_at: Schema.String,
  path: Schema.String,
  line: Line,
  start_line: Line,
  original_line: Line,
  original_start_line: Line,
  side: Schema.optionalKey(Schema.NullOr(Schema.String)),
  commit_id: Schema.optionalKey(Schema.NullOr(Schema.String)),
  original_commit_id: Schema.optionalKey(Schema.NullOr(Schema.String)),
  in_reply_to_id: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  html_url: Schema.optionalKey(Schema.String),
})
const GhIssueComment = Schema.Struct({
  id: Schema.Number,
  user: Schema.NullOr(Login),
  body: Schema.NullOr(Schema.String),
  created_at: Schema.String,
  updated_at: Schema.String,
  html_url: Schema.optionalKey(Schema.String),
})
const GhReview = Schema.Struct({
  id: Schema.Number,
  user: Schema.NullOr(Login),
  body: Schema.NullOr(Schema.String),
  state: Schema.String,
  submitted_at: Schema.optionalKey(Schema.NullOr(Schema.String)),
  html_url: Schema.optionalKey(Schema.String),
})
const GhThreads = Schema.Struct({
  data: Schema.Struct({
    repository: Schema.NullOr(
      Schema.Struct({
        pullRequest: Schema.NullOr(
          Schema.Struct({
            reviewThreads: Schema.Struct({
              nodes: Schema.Array(
                Schema.Struct({
                  isResolved: Schema.Boolean,
                  comments: Schema.Struct({
                    nodes: Schema.Array(
                      Schema.Struct({ databaseId: Schema.NullOr(Schema.Number) }),
                    ),
                  }),
                }),
              ),
            }),
          }),
        ),
      }),
    ),
  }),
})

/** Pages as `--slurp` prints them: a list of each page's list. */
const readReviewComments = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Array(Schema.Array(GhReviewComment))),
)
const readIssueComments = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Array(Schema.Array(GhIssueComment))),
)
const readReviews = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Array(Schema.Array(GhReview))),
)
const readThreads = Schema.decodeUnknownOption(Schema.fromJsonString(GhThreads))

const BktCloudComment = Schema.Struct({
  id: Schema.Number,
  content: Schema.Struct({ raw: Schema.NullOr(Schema.String) }),
  user: Schema.optionalKey(
    Schema.NullOr(
      Schema.Struct({
        nickname: Schema.optionalKey(Schema.String),
        display_name: Schema.optionalKey(Schema.String),
      }),
    ),
  ),
  created_on: Schema.String,
  updated_on: Schema.optionalKey(Schema.NullOr(Schema.String)),
  deleted: Schema.optionalKey(Schema.Boolean),
  resolution: Schema.optionalKey(Schema.NullOr(Schema.Struct({}))),
  parent: Schema.optionalKey(Schema.NullOr(Schema.Struct({ id: Schema.Number }))),
  inline: Schema.optionalKey(
    Schema.NullOr(
      Schema.Struct({
        path: Schema.String,
        from: Schema.optionalKey(Schema.NullOr(Schema.Number)),
        to: Schema.optionalKey(Schema.NullOr(Schema.Number)),
      }),
    ),
  ),
  links: Schema.optionalKey(
    Schema.Struct({ html: Schema.optionalKey(Schema.Struct({ href: Schema.String })) }),
  ),
})
const BktDcComment = Schema.Struct({
  id: Schema.Number,
  version: Schema.optionalKey(Schema.Number),
  text: Schema.String,
  createdDate: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  updatedDate: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  author: Schema.Struct({
    name: Schema.optionalKey(Schema.String),
    displayName: Schema.optionalKey(Schema.String),
  }),
  threadResolved: Schema.optionalKey(Schema.Boolean),
  parent: Schema.optionalKey(Schema.NullOr(Schema.Struct({ id: Schema.Number }))),
  anchor: Schema.optionalKey(
    Schema.NullOr(
      Schema.Struct({
        path: Schema.String,
        line: Schema.optionalKey(Schema.Number),
        lineType: Schema.optionalKey(Schema.String),
        fileType: Schema.optionalKey(Schema.String),
      }),
    ),
  ),
})
const readBktCloud = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ comments: Schema.NullOr(Schema.Array(BktCloudComment)) })),
)
const readBktDc = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ comments: Schema.NullOr(Schema.Array(BktDcComment)) })),
)

const VERDICTS: ReadonlyMap<string, NonNullable<ForgeComment['review']>> = new Map([
  ['APPROVED', 'approved'],
  ['CHANGES_REQUESTED', 'changes-requested'],
  ['COMMENTED', 'commented'],
])

/** The answer of a call that ran, or the forge's own failure. */
const answered = (target: ForgeTarget, answer: ForgeAnswer) =>
  answer.code === 0 ? Effect.succeed(answer) : Effect.fail(forgeError(target, answer))

const unreadable = (target: ForgeTarget, answer: ForgeAnswer) =>
  forgeError(target, { ...answer, stderr: 'its answer could not be read' })

/** A range from its first line and its last, either missing. */
const rangeOf = (start: number | null, end: number | null): LineRange | null => {
  const last = end ?? start
  if (last === null) return null
  return { start: start ?? last, end: last }
}

const isoOf = (millis: number | null | undefined): string =>
  millis === null || millis === undefined ? '' : new Date(millis).toISOString()

/** GitHub's comments, general comments and reviews, each list read in pages, and its threads. */
const fromGithub = (
  target: ForgeTarget,
  number: number,
  run: (args: ReadonlyArray<string>) => Effect.Effect<ForgeAnswer, ForgeFailure | ForgeRefused>,
) =>
  Effect.gen(function* () {
    const { host, owner, slug } = target.identity
    const repository = `repos/${owner ?? ''}/${slug ?? ''}`
    const list = (path: string) =>
      Effect.flatMap(run(['api', '--hostname', host, path, '--paginate', '--slurp']), (answer) =>
        answered(target, answer),
      )
    const inline = yield* list(`${repository}/pulls/${String(number)}/comments`)
    const general = yield* list(`${repository}/issues/${String(number)}/comments`)
    const reviews = yield* list(`${repository}/pulls/${String(number)}/reviews`)
    const threads = yield* Effect.flatMap(
      run([
        'api',
        '--hostname',
        host,
        'graphql',
        '-f',
        `query=${THREADS_QUERY}`,
        '-F',
        `owner=${owner ?? ''}`,
        '-F',
        `name=${slug ?? ''}`,
        '-F',
        `number=${String(number)}`,
      ]),
      (answer) => answered(target, answer),
    )
    const inlineRead = readReviewComments(inline.stdout)
    const generalRead = readIssueComments(general.stdout)
    const reviewsRead = readReviews(reviews.stdout)
    const threadsRead = readThreads(threads.stdout)
    if (Option.isNone(inlineRead)) return yield* unreadable(target, inline)
    if (Option.isNone(generalRead)) return yield* unreadable(target, general)
    if (Option.isNone(reviewsRead)) return yield* unreadable(target, reviews)
    if (Option.isNone(threadsRead)) return yield* unreadable(target, threads)
    const resolved = new Set(
      (threadsRead.value.data.repository?.pullRequest?.reviewThreads.nodes ?? [])
        .filter((one) => one.isResolved)
        .flatMap((one) => one.comments.nodes.flatMap((node) => node.databaseId ?? [])),
    )
    const comments: ForgeComment[] = []
    for (const one of inlineRead.value.flat()) {
      const start = one.original_start_line ?? one.start_line ?? null
      const end = one.original_line ?? one.line ?? null
      comments.push({
        id: String(one.id),
        kind: 'inline',
        thread: String(one.in_reply_to_id ?? one.id),
        author: one.user?.login ?? '',
        body: one.body,
        createdAt: one.created_at,
        updatedAt: one.updated_at,
        revision: one.updated_at,
        url: one.html_url ?? null,
        review: null,
        anchor: {
          path: one.path,
          side: one.side === 'LEFT' ? 'old' : 'new',
          lines: rangeOf(start, end),
          commit: one.original_commit_id ?? one.commit_id ?? null,
        },
        resolved: resolved.has(one.id),
        removed: false,
      })
    }
    for (const one of generalRead.value.flat()) {
      comments.push({
        id: `issue-${String(one.id)}`,
        kind: 'general',
        thread: null,
        author: one.user?.login ?? '',
        body: one.body ?? '',
        createdAt: one.created_at,
        updatedAt: one.updated_at,
        revision: one.updated_at,
        url: one.html_url ?? null,
        review: null,
        anchor: null,
        resolved: false,
        removed: false,
      })
    }
    for (const one of reviewsRead.value.flat()) {
      const verdict = VERDICTS.get(one.state)
      const body = one.body ?? ''
      // A pending review is the reviewer's draft; a comment-only one without text holds only inline comments.
      if (verdict === undefined || (verdict === 'commented' && body.trim() === '')) continue
      const at = one.submitted_at ?? ''
      comments.push({
        id: `review-${String(one.id)}`,
        kind: 'review',
        thread: null,
        author: one.user?.login ?? '',
        body,
        createdAt: at,
        updatedAt: at,
        revision: at,
        url: one.html_url ?? null,
        review: verdict,
        anchor: null,
        resolved: false,
        removed: false,
      })
    }
    return comments
  })

/** Bitbucket Cloud's comments as bkt prints them. */
const fromCloud = (
  rows: ReadonlyArray<typeof BktCloudComment.Type>,
): ReadonlyArray<ForgeComment> => {
  const parents = new Map(rows.map((one) => [one.id, one.parent?.id ?? null]))
  const rootOf = (id: number): number => {
    let at = id
    for (let depth = 0; depth < rows.length; depth += 1) {
      const up = parents.get(at) ?? null
      if (up === null) return at
      at = up
    }
    return at
  }
  const resolvedRoots = new Set(rows.filter((one) => one.resolution != null).map((one) => one.id))
  return rows.map((one) => {
    const inline = one.inline ?? null
    const line = inline === null ? null : (inline.to ?? inline.from ?? null)
    const root = rootOf(one.id)
    return {
      id: String(one.id),
      kind: inline === null ? 'general' : 'inline',
      thread: inline === null && one.parent == null ? null : String(root),
      author: one.user?.nickname ?? one.user?.display_name ?? '',
      body: one.content.raw ?? '',
      createdAt: one.created_on,
      updatedAt: one.updated_on ?? one.created_on,
      revision: one.updated_on ?? one.created_on,
      url: one.links?.html?.href ?? null,
      review: null,
      anchor:
        inline === null
          ? null
          : {
              path: inline.path,
              side: inline.to == null && inline.from != null ? 'old' : 'new',
              lines: rangeOf(line, line),
              commit: null,
            },
      resolved: resolvedRoots.has(root),
      removed: one.deleted === true,
    }
  })
}

/** Bitbucket Data Center's comments as bkt prints them, its replies flattened after their thread. */
const fromDataCenter = (
  rows: ReadonlyArray<typeof BktDcComment.Type>,
): ReadonlyArray<ForgeComment> =>
  rows.map((one) => {
    const anchor = one.anchor ?? null
    const line = anchor?.line ?? null
    const created = isoOf(one.createdDate)
    const updated = one.updatedDate == null ? created : isoOf(one.updatedDate)
    return {
      id: String(one.id),
      kind: anchor === null ? 'general' : 'inline',
      thread: anchor === null && one.parent == null ? null : String(one.parent?.id ?? one.id),
      author: one.author.name ?? one.author.displayName ?? '',
      body: one.text,
      createdAt: created,
      updatedAt: updated,
      revision: String(one.version ?? 0),
      url: null,
      review: null,
      anchor:
        anchor === null
          ? null
          : {
              path: anchor.path,
              side: anchor.lineType === 'REMOVED' || anchor.fileType === 'FROM' ? 'old' : 'new',
              lines: rangeOf(line, line),
              commit: null,
            },
      resolved: one.threadResolved === true,
      removed: false,
    }
  })

/** The comments of a pull request, read now: every comment the forge lists, in its order. */
export const readComments = (repositoryId: string, number: number) =>
  ForgePort.use((port) =>
    port.operate(repositoryId, (target, run) =>
      Effect.gen(function* () {
        if (target.cli === 'gh') return yield* fromGithub(target, number, run)
        const answer = yield* answered(
          target,
          yield* run(['pr', 'comments', String(number), ...target.place, '--json']),
        )
        if (target.forge === 'bitbucket-cloud') {
          const read = readBktCloud(answer.stdout)
          if (Option.isNone(read)) return yield* unreadable(target, answer)
          return fromCloud(read.value.comments ?? [])
        }
        const read = readBktDc(answer.stdout)
        if (Option.isNone(read)) return yield* unreadable(target, answer)
        return fromDataCenter(read.value.comments ?? [])
      }),
    ),
  )
