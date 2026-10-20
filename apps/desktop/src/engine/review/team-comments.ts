/**
 * The team's comments from the forge (R8, CT-45).
 *
 * - **Fetching.** For each open or merged pull request of a mission in Review or Shipping (R6's
 *   pushes), the forge's inline comments, general comments and review summaries are read through
 *   the forge port, by reads only (`forges/comments.ts`). A fetch runs every 5 minutes, when the
 *   window regains the focus, at each start once automations may run (comments written while
 *   Hemera was stopped are read then), and right after each push of the mission. A mission's
 *   fetches go one at a time; one asked while another runs waits for the next. A CLI not ready makes
 *   the fetch wait behind the port's Project need, without error. Nothing is fetched outside Review
 *   and Shipping.
 * - **Identity, versions, states.** A comment is one row by forge, host, `owner/repo`, pull
 *   request number and comment id. Its body is masked before it is written. An edit makes a new
 *   version; a comment taken into a round and edited after is "edited after integration". A comment
 *   gone from the forge is "removed on forge"; nothing is deleted. The forge's resolved state is a
 *   field of its own: it never resolves the feedback the comment became.
 * - **Mine or not.** The author's account as the forge keys it (the login on GitHub, the account
 *   id on Bitbucket Cloud, the user slug on Data Center), never a name the author chose, is compared
 *   with the signed-in account, read again at each fetch, for every comment not yet taken in. When
 *   Cloud's account cannot be read, no comment is mine. Mine, in Review, becomes my feedback in
 *   the collecting round at once and starts nothing.
 * - **Someone else's** is a team comment, not feedback: one short session of the Planner in
 *   team-comment mode per fetch that brings new ones drafts a reading and a reply for each, both
 *   internal, counted in the Project's cap. No agent that steers the mission sees it until the user
 *   adds it to a round, with their take.
 * - **During Shipping** a comment is recorded the same way and blocks nothing: its event goes to
 *   Since you left and to a notification, never to a need. "Start a mission from this" answers what
 *   the start field opens with.
 *
 * Hemera never posts, edits, reacts to or resolves anything on the forge.
 */

import { type Stage, missionKey } from '@hemera/core/domain'
import type { ToolArguments } from '@hemera/core/domain'
import {
  FeedbackForge,
  FeedbackUser,
  PullRequestStatus,
  type TeamCommentKind,
  TeamCommentRefused,
  type TeamCommentSource,
  type TeamCommentState,
  type TeamCommentView,
  type TeamCommentsChange,
  UnknownMission,
  UnknownTeamComment,
} from '@hemera/ipc'
import { and, asc, eq, inArray } from 'drizzle-orm'
import {
  Cause,
  Context,
  Deferred,
  Duration,
  Effect,
  Fiber,
  Layer,
  Option,
  PubSub,
  Schedule,
  Schema,
  Stream,
} from 'effect'

import type { Log } from '../../main/diagnostic.ts'
import { DomainEvents } from '../domain-events.ts'
import { type ForgeComment, isMine, readComments, signedInAccount } from '../forges/comments.ts'
import { ForgePort } from '../forges/port.ts'
import { AutomationGate } from '../gate.ts'
import type { NewEvent } from '../journal.ts'
import { Secrets } from '../secrets.ts'
import { Cap } from '../sessions/cap.ts'
import { SessionPost } from '../sessions/post.ts'
import { Sessions } from '../sessions/service.ts'
import { getSession, sessionsOfLineage } from '../sessions/store.ts'
import { Database, type DatabaseError, refusedWhile } from '../storage/database.ts'
import {
  deliveryPushes,
  missions,
  teamCommentPushes,
  teamCommentRuns,
  teamCommentVersions,
  teamComments,
} from '../storage/schema.ts'
import { answered, failure, refusal } from '../tools/files.ts'
import type { Grant } from '../tools/access.ts'
import { mutate } from '../transaction.ts'
import { Review, type StoredAnchor } from './feedback.ts'
import { workspaceFolderIn } from './round-store.ts'
import { TeamCommentDesk } from './team-comment-desk.ts'
import { type TeamCommentRunRow, teamRunOfLineage } from './team-comment-role.ts'

/** How often the comments of a mission in Review or Shipping are read (open question 36). */
export const TEAM_COMMENTS_EVERY = Duration.minutes(5)

/** What a suite may set: how often the comments are read. */
export interface TeamCommentsParts {
  readonly every?: Duration.Input | undefined
}

export interface TeamCommentsSettings extends TeamCommentsParts {
  readonly log: Log
}

/** What a session that ended a turn without every draft is told, once. */
export const END_WITH_TEAM_COMMENT_DRAFTS =
  'End with team_comment_draft, once per comment of your brief: your drafts are the only thing you return.'

/** Why a run that ended two turns without its drafts failed. */
export const NO_TEAM_COMMENT_DRAFT = 'ended without a draft for every comment'

type Gesture = UnknownTeamComment | TeamCommentRefused | DatabaseError

export interface TeamCommentsService {
  readonly list: (
    missionId: string,
  ) => Effect.Effect<ReadonlyArray<TeamCommentView>, UnknownMission | DatabaseError>
  readonly take: (id: string, myTake: string) => Effect.Effect<TeamCommentView, Gesture>
  readonly addToRound: (id: string) => Effect.Effect<TeamCommentView, Gesture>
  readonly dismiss: (id: string) => Effect.Effect<TeamCommentView, Gesture>
  readonly startMissionFrom: (id: string) => Effect.Effect<TeamCommentSource, Gesture>
  readonly changes: (
    missionId: string,
  ) => Stream.Stream<TeamCommentsChange, UnknownMission | DatabaseError>
  /** Reads the mission's comments now, after the fetch that runs; nothing outside Review and Shipping. */
  readonly fetch: (missionId: string) => Effect.Effect<void>
  /** The window regained the focus: the comments of every mission in Review or Shipping are read. */
  readonly focused: Effect.Effect<void>
}

export class TeamComments extends Context.Service<TeamComments, TeamCommentsService>()(
  'TeamComments',
) {}

type CommentRow = typeof teamComments.$inferSelect

const FETCHED: ReadonlyArray<Stage> = ['review', 'shipping']
const KINDS: ReadonlyArray<TeamCommentKind> = ['inline', 'general', 'review']
const STATES: ReadonlyArray<TeamCommentState> = ['received', 'feedback', 'dismissed']

/** A mission's fetch that runs, and the one asked while it runs, if any. */
interface Fetching {
  again: Deferred.Deferred<void> | null
}
const LIVE_SESSION = ['starting', 'working', 'idle', 'stuck'] as const

const readPullRequest = Schema.decodeUnknownOption(Schema.fromJsonString(PullRequestStatus))
const readText = Schema.decodeUnknownOption(Schema.String)

const now = (): string => new Date().toISOString()

const stageOf = (stage: string): Stage | null => FETCHED.find((one) => one === stage) ?? null

/** A comment's text quoted under who wrote it, as the feedback taken from it says it. */
const quotedBy = (row: CommentRow): string =>
  [
    `${row.author} wrote on pull request #${String(row.number)} of ${row.repository}:`,
    ...row.body.split(/\r?\n/).map((line) => (line === '' ? '>' : `> ${line}`)),
  ].join('\n')

const teamEvent = (
  row: Pick<
    CommentRow,
    'id' | 'missionId' | 'commentId' | 'author' | 'mine' | 'repository' | 'kind'
  >,
  type: string,
  stage: string,
  by: 'hemera' | 'human',
): NewEvent => ({
  type,
  entityKind: 'mission',
  entityId: row.missionId,
  source: by === 'human' ? 'ui' : 'system',
  author: by,
  payload: {
    teamCommentId: row.id,
    commentId: row.commentId,
    author: row.author,
    mine: row.mine,
    repository: row.repository,
    kind: row.kind,
    stage,
  },
})

type Needs = Database | DomainEvents | Secrets | Sessions | Cap | SessionPost | AutomationGate

export const teamCommentsLayer = (settings: TeamCommentsSettings) =>
  Layer.effect(
    TeamComments,
    Effect.gen(function* () {
      const context = yield* Effect.context<Needs | ForgePort | Review>()
      const run = <A, E>(effect: Effect.Effect<A, E, Needs | ForgePort | Review>) =>
        Effect.provide(effect, context)
      const scope = yield* Effect.scope
      const database = yield* Database
      const secrets = yield* Secrets
      const review = yield* Review
      const sessions = yield* Sessions
      const cap = yield* Cap
      const log = (line: string) => Effect.sync(() => settings.log(`team comments: ${line}`))
      const changed = yield* PubSub.unbounded<string>()
      const told = (missionId: string) => PubSub.publish(changed, missionId)

      const missionOf = (missionId: string) =>
        database
          .select({
            id: missions.id,
            stage: missions.stage,
            projectId: missions.projectId,
            prefix: missions.keyPrefix,
            number: missions.keyNumber,
          })
          .from(missions)
          .where(eq(missions.id, missionId))
          .pipe(
            Effect.mapError(refusedWhile('reading the mission')),
            Effect.flatMap(([row]) =>
              row === undefined
                ? Effect.fail(new UnknownMission({ id: missionId }))
                : Effect.succeed(row),
            ),
          )

      const rowOf = (id: string) =>
        database
          .select()
          .from(teamComments)
          .where(eq(teamComments.id, id))
          .pipe(
            Effect.mapError(refusedWhile('reading a team comment')),
            Effect.flatMap(([row]) =>
              row === undefined ? Effect.fail(new UnknownTeamComment({ id })) : Effect.succeed(row),
            ),
          )

      const storedOf = (row: CommentRow): StoredAnchor | null =>
        row.anchorPath === null
          ? null
          : {
              repository: row.repository,
              path: row.anchorPath,
              side: row.anchorSide === 'old' ? 'old' : 'new',
              lines:
                row.anchorStart === null || row.anchorEnd === null
                  ? null
                  : { start: row.anchorStart, end: row.anchorEnd },
              tree: row.anchorTree,
              fingerprint: row.anchorFingerprint,
              sha256: row.anchorSha256,
              size: row.anchorSize,
              withheld: row.anchorWithheld,
            }

      // --- views ------------------------------------------------------------------------------

      const viewsOf = (rows: ReadonlyArray<CommentRow>) =>
        Effect.gen(function* () {
          const ids = rows.map((row) => row.id)
          const versions =
            ids.length === 0
              ? []
              : yield* database
                  .select()
                  .from(teamCommentVersions)
                  .where(inArray(teamCommentVersions.commentId, ids))
                  .orderBy(asc(teamCommentVersions.version))
                  .pipe(Effect.mapError(refusedWhile('reading the team comments')))
          const views: TeamCommentView[] = []
          for (const row of rows) {
            const stored = storedOf(row)
            const known = stored !== null && stored.tree !== null
            const followed =
              stored !== null && known
                ? yield* review.forgeAnchorLive(row.missionId, `team:${row.id}`, stored)
                : null
            views.push({
              id: row.id,
              missionId: row.missionId,
              repository: row.repository,
              // SAFETY: the column only ever holds a ForgeName, read from the port's target.
              forge: row.forge as TeamCommentView['forge'],
              host: row.host,
              slug: row.slug,
              number: row.number,
              commentId: row.commentId,
              kind: KINDS.find((one) => one === row.kind) ?? 'general',
              review: row.review,
              thread: row.thread,
              author: row.author,
              mine: row.mine,
              body: row.body,
              version: row.version,
              versions: versions
                .filter((one) => one.commentId === row.id)
                .map((one) => ({ version: one.version, body: one.body, at: one.writtenAt })),
              createdAt: row.createdAt,
              updatedAt: row.updatedAt,
              url: row.url,
              anchor:
                stored === null
                  ? null
                  : {
                      repository: stored.repository,
                      path: stored.path,
                      side: stored.side,
                      lines: stored.lines,
                      commit: row.anchorCommit,
                      known,
                      excerpt: followed?.excerpt ?? null,
                      live: followed?.live ?? null,
                    },
              forgeResolved: row.forgeResolved,
              removedOnForge: row.removedOnForge,
              state: STATES.find((one) => one === row.state) ?? 'received',
              arrivedIn: row.arrivedIn === 'shipping' ? 'shipping' : 'review',
              reading: row.reading,
              reply: row.reply,
              myTake: row.myTake,
              feedbackId: row.feedbackId,
              editedAfterIntegration:
                row.integratedVersion !== null && row.version > row.integratedVersion,
            })
          }
          return views
        })

      const list = (missionId: string) =>
        Effect.gen(function* () {
          yield* missionOf(missionId)
          const rows = yield* database
            .select()
            .from(teamComments)
            .where(eq(teamComments.missionId, missionId))
            .orderBy(asc(teamComments.createdAt), asc(teamComments.receivedAt))
            .pipe(Effect.mapError(refusedWhile('reading the team comments')))
          return yield* viewsOf(rows)
        })

      const oneView = (id: string) =>
        Effect.gen(function* () {
          const [view] = yield* viewsOf([yield* rowOf(id)])
          if (view === undefined) return yield* new UnknownTeamComment({ id })
          return view
        })

      // --- fetching ---------------------------------------------------------------------------

      /** The pull requests of a mission to read: open or merged, with the commit and tree pushed. */
      const pullRequestsOf = (missionId: string) =>
        Effect.gen(function* () {
          const rows = yield* database
            .select()
            .from(deliveryPushes)
            .where(eq(deliveryPushes.missionId, missionId))
            .pipe(Effect.mapError(refusedWhile('reading the pushes')))
          return rows.flatMap((row) => {
            const status = Option.getOrNull(readPullRequest(row.pullRequest))
            if (status === null || status.state === 'closed') return []
            return [{ row, status }]
          })
        })

      /** Each commit Hemera pushed for the mission, with its tree, kept for the anchors. */
      const recordPushes = (missionId: string) =>
        Effect.gen(function* () {
          const rows = yield* database
            .select()
            .from(deliveryPushes)
            .where(eq(deliveryPushes.missionId, missionId))
            .pipe(Effect.mapError(refusedWhile('reading the pushes')))
          for (const row of rows) {
            if (row.commit === null || row.tree === null) continue
            yield* database
              .insert(teamCommentPushes)
              .values({ missionId, repository: row.repository, commit: row.commit, tree: row.tree })
              .onConflictDoNothing()
              .pipe(Effect.mapError(refusedWhile('recording a push')))
          }
        })

      /** One comment as the forge gives it, recorded new or compared with the row it is. */
      const recordOne = (
        mission: { readonly id: string; readonly stage: Stage },
        place: {
          readonly repositoryId: string
          readonly repository: string
          readonly forge: string
          readonly host: string
          readonly slug: string
          readonly number: number
        },
        comment: ForgeComment,
        kept: CommentRow | undefined,
        trees: ReadonlyMap<string, string>,
        account: string | null,
      ) =>
        Effect.gen(function* () {
          const body = secrets.mask(comment.body)
          const at = now()
          if (kept === undefined) {
            const anchor =
              comment.anchor === null
                ? null
                : yield* review.forgeAnchor(mission.id, {
                    repository: place.repository,
                    path: comment.anchor.path,
                    side: comment.anchor.side,
                    lines: comment.anchor.lines,
                    tree:
                      comment.anchor.commit === null
                        ? null
                        : (trees.get(comment.anchor.commit) ?? null),
                  })
            const row: CommentRow = {
              id: crypto.randomUUID(),
              missionId: mission.id,
              repositoryId: place.repositoryId,
              repository: place.repository,
              forge: place.forge,
              host: place.host,
              slug: place.slug,
              number: place.number,
              commentId: comment.id,
              kind: comment.kind,
              review: comment.review,
              thread: comment.thread,
              author: comment.author,
              authorId: comment.authorId,
              mine: isMine(comment, account),
              body,
              version: 1,
              revision: comment.revision,
              createdAt: comment.createdAt,
              updatedAt: comment.updatedAt,
              url: comment.url,
              anchorPath: anchor?.path ?? null,
              anchorSide: anchor?.side ?? null,
              anchorStart: anchor?.lines?.start ?? null,
              anchorEnd: anchor?.lines?.end ?? null,
              anchorCommit: comment.anchor?.commit ?? null,
              anchorTree: anchor?.tree ?? null,
              anchorFingerprint: anchor?.fingerprint ?? null,
              anchorSha256: anchor?.sha256 ?? null,
              anchorSize: anchor?.size ?? null,
              anchorWithheld: anchor?.withheld ?? null,
              forgeResolved: comment.resolved,
              removedOnForge: comment.removed,
              state: 'received',
              arrivedIn: mission.stage,
              reading: null,
              reply: null,
              myTake: null,
              feedbackId: null,
              integratedVersion: null,
              runId: null,
              receivedAt: at,
            }
            return { row, fresh: true, version: true, events: ['team_comment.received'] }
          }
          const edited = kept.revision !== comment.revision || kept.body !== body
          const removed = comment.removed && !kept.removedOnForge
          const row: CommentRow = {
            ...kept,
            body: edited ? body : kept.body,
            version: edited ? kept.version + 1 : kept.version,
            revision: comment.revision,
            updatedAt: comment.updatedAt,
            review: comment.review,
            forgeResolved: comment.resolved,
            removedOnForge: comment.removed,
          }
          return {
            row,
            fresh: false,
            version: edited,
            events: [
              ...(edited ? ['team_comment.edited_on_forge'] : []),
              ...(removed ? ['team_comment.removed_on_forge'] : []),
            ],
          }
        })

      /** One fetch of a mission: every pull request read, every comment recorded. */
      const fetchOnce = (missionId: string) =>
        Effect.gen(function* () {
          const mission = yield* missionOf(missionId)
          const stage = stageOf(mission.stage)
          if (stage === null) return
          yield* recordPushes(missionId)
          for (const { row: push, status } of yield* pullRequestsOf(missionId)) {
            yield* readPullRequestComments(missionId, stage, push, status).pipe(
              Effect.catchCause((cause) =>
                Cause.hasInterruptsOnly(cause)
                  ? Effect.failCause(cause)
                  : log(
                      `the comments of pull request #${String(status.number)} of ${push.repository} were not read: ${String(cause)}`,
                    ),
              ),
            )
          }
          yield* settleMine(missionId, stage)
          yield* askDrafts(missionId)
          yield* told(missionId)
        })

      /** One pull request of a mission read, and its comments recorded. */
      const readPullRequestComments = (
        missionId: string,
        stage: Stage,
        push: typeof deliveryPushes.$inferSelect,
        status: PullRequestStatus,
      ) =>
        Effect.gen(function* () {
          const account = yield* signedInAccount(push.repositoryId)
          const read = yield* readComments(push.repositoryId, status.number)
          const trees = new Map(
            (yield* database
              .select()
              .from(teamCommentPushes)
              .where(
                and(
                  eq(teamCommentPushes.missionId, missionId),
                  eq(teamCommentPushes.repository, push.repository),
                ),
              )
              .pipe(Effect.mapError(refusedWhile('reading the pushes')))).map((one) => [
              one.commit,
              one.tree,
            ]),
          )
          const place = {
            repositoryId: push.repositoryId,
            repository: push.repository,
            forge: status.forge,
            host: status.host,
            slug: read.slug,
            number: status.number,
          }
          const kept = yield* database
            .select()
            .from(teamComments)
            .where(
              and(
                eq(teamComments.missionId, missionId),
                eq(teamComments.forge, place.forge),
                eq(teamComments.host, place.host),
                eq(teamComments.slug, place.slug),
                eq(teamComments.number, place.number),
              ),
            )
            .pipe(Effect.mapError(refusedWhile('reading the team comments')))
          const recorded = yield* Effect.forEach(read.comments, (comment) =>
            recordOne(
              { id: missionId, stage },
              place,
              comment,
              kept.find((one) => one.commentId === comment.id),
              trees,
              account,
            ),
          )
          // Gone from what the forge lists: removed there, kept here.
          const gone = kept
            .filter(
              (one) =>
                !one.removedOnForge && !read.comments.some((each) => each.id === one.commentId),
            )
            .map((one) => ({
              row: { ...one, removedOnForge: true },
              fresh: false,
              version: false,
              events: ['team_comment.removed_on_forge'],
            }))
          const all = [...recorded, ...gone]
          yield* mutate('recording the team comments', (transaction) =>
            Effect.gen(function* () {
              const events: NewEvent[] = []
              for (const one of all) {
                const { row } = one
                if (one.fresh) {
                  yield* transaction
                    .insert(teamComments)
                    .values(row)
                    .pipe(Effect.mapError(refusedWhile('recording a team comment')))
                } else {
                  // What the forge says only: what the user did with it stays.
                  yield* transaction
                    .update(teamComments)
                    .set({
                      body: row.body,
                      version: row.version,
                      revision: row.revision,
                      updatedAt: row.updatedAt,
                      review: row.review,
                      forgeResolved: row.forgeResolved,
                      removedOnForge: row.removedOnForge,
                    })
                    .where(eq(teamComments.id, row.id))
                    .pipe(Effect.mapError(refusedWhile('recording a team comment')))
                  // Mine is read again for what the user did not take in yet.
                  yield* transaction
                    .update(teamComments)
                    .set({ mine: account !== null && row.authorId === account })
                    .where(and(eq(teamComments.id, row.id), eq(teamComments.state, 'received')))
                    .pipe(Effect.mapError(refusedWhile('recording a team comment')))
                }
                if (one.version) {
                  yield* transaction
                    .insert(teamCommentVersions)
                    .values({
                      commentId: row.id,
                      version: row.version,
                      body: row.body,
                      writtenAt: row.updatedAt,
                    })
                    .onConflictDoNothing()
                    .pipe(Effect.mapError(refusedWhile('recording a team comment')))
                }
                for (const type of one.events) events.push(teamEvent(row, type, stage, 'hemera'))
              }
              return { result: undefined, events }
            }),
          )
        })

      /** My comments not taken in yet become my feedback, in Review: each once, by its source. */
      const settleMine = (missionId: string, stage: Stage) =>
        Effect.gen(function* () {
          if (stage !== 'review') return
          const mine = yield* database
            .select()
            .from(teamComments)
            .where(
              and(
                eq(teamComments.missionId, missionId),
                eq(teamComments.mine, true),
                eq(teamComments.state, 'received'),
              ),
            )
            .orderBy(asc(teamComments.createdAt))
            .pipe(Effect.mapError(refusedWhile('reading the team comments')))
          for (const row of mine) {
            const feedback = yield* review.forgeFeedback(missionId, {
              author: FeedbackUser.make({}),
              kind: row.kind === 'inline' ? 'code' : 'remark',
              body: row.body,
              source: `forge:${row.id}`,
              anchor: storedOf(row),
            })
            yield* database
              .update(teamComments)
              .set({ state: 'feedback', feedbackId: feedback.id, integratedVersion: row.version })
              .where(and(eq(teamComments.id, row.id), eq(teamComments.state, 'received')))
              .pipe(Effect.mapError(refusedWhile('taking in a team comment')))
          }
        })

      // Fetches go one at a time per mission; one asked while another runs waits for the next.
      const fetching = new Map<string, Fetching>()

      const fetch = (missionId: string): Effect.Effect<void> =>
        Effect.suspend(() => {
          const going = fetching.get(missionId)
          if (going !== undefined) {
            const next = going.again ?? Deferred.makeUnsafe<void>()
            going.again = next
            return Deferred.await(next)
          }
          const state: Fetching = { again: null }
          fetching.set(missionId, state)
          const done = Deferred.makeUnsafe<void>()
          const once = fetchOnce(missionId).pipe(
            run,
            Effect.catchCause((cause) =>
              Cause.hasInterruptsOnly(cause)
                ? Effect.void
                : log(`the comments of ${missionId} were not read: ${String(cause)}`),
            ),
          )
          const loop = Effect.gen(function* () {
            yield* once
            yield* Deferred.succeed(done, undefined)
            for (;;) {
              const next = yield* Effect.sync(() => {
                const asked = state.again
                state.again = null
                if (asked === null) fetching.delete(missionId)
                return asked
              })
              if (next === null) return
              yield* once
              yield* Deferred.succeed(next, undefined)
            }
          })
          return Effect.andThen(Effect.forkIn(loop, scope), Deferred.await(done))
        })

      /** Every mission in Review or Shipping with a pull request, its fetch started. */
      const fetchAll = Effect.gen(function* () {
        const rows = yield* database
          .selectDistinct({ id: missions.id })
          .from(missions)
          .innerJoin(deliveryPushes, eq(deliveryPushes.missionId, missions.id))
          .where(inArray(missions.stage, [...FETCHED]))
          .pipe(Effect.mapError(refusedWhile('reading the missions')))
        for (const row of rows) yield* Effect.forkIn(fetch(row.id), scope)
      }).pipe(Effect.catchCause((cause) => log(`the missions were not read: ${String(cause)}`)))

      // --- the drafting runs ------------------------------------------------------------------

      const liveIn = (lineage: string) =>
        Effect.map(sessionsOfLineage(lineage), (rows) =>
          rows.some((one) => LIVE_SESSION.some((state) => state === one.state)),
        )

      const runsOf = (missionId: string | null, states: ReadonlyArray<string>) =>
        database
          .select()
          .from(teamCommentRuns)
          .where(
            and(
              inArray(teamCommentRuns.state, [...states]),
              missionId === null ? undefined : eq(teamCommentRuns.missionId, missionId),
            ),
          )
          .orderBy(asc(teamCommentRuns.askedAt))
          .pipe(Effect.mapError(refusedWhile('reading the team-comment runs')))

      /** Someone else's comments with no draft and no run: one run for all of them. */
      const askDrafts = (missionId: string) =>
        Effect.gen(function* () {
          const asked = yield* mutate('asking the team comments’ drafts', (transaction) =>
            Effect.gen(function* () {
              const waiting = yield* transaction
                .select({ id: teamComments.id })
                .from(teamComments)
                .where(
                  and(
                    eq(teamComments.missionId, missionId),
                    eq(teamComments.mine, false),
                    eq(teamComments.state, 'received'),
                  ),
                )
                .pipe(Effect.mapError(refusedWhile('reading the team comments')))
              const rows = yield* transaction
                .select()
                .from(teamComments)
                .where(
                  inArray(
                    teamComments.id,
                    waiting.map((one) => one.id),
                  ),
                )
                .pipe(Effect.mapError(refusedWhile('reading the team comments')))
              const fresh = rows.filter((one) => one.runId === null && one.reading === null)
              if (fresh.length === 0) return { result: null, events: [] }
              const runId = crypto.randomUUID()
              yield* transaction
                .insert(teamCommentRuns)
                .values({
                  id: runId,
                  missionId,
                  lineage: crypto.randomUUID(),
                  state: 'waiting_for_slot',
                  reminded: false,
                  askedAt: now(),
                })
                .pipe(Effect.mapError(refusedWhile('asking a team-comment run')))
              yield* transaction
                .update(teamComments)
                .set({ runId })
                .where(
                  inArray(
                    teamComments.id,
                    fresh.map((one) => one.id),
                  ),
                )
                .pipe(Effect.mapError(refusedWhile('asking a team-comment run')))
              return { result: runId, events: [] }
            }),
          )
          if (asked !== null) yield* next(missionId)
        })

      const starting = new Map<string, Fiber.Fiber<void>>()

      /** A run's slot, then its session in the Workspace, read-only. */
      const slotThenSession = (row: TeamCommentRunRow) =>
        Effect.gen(function* () {
          const mission = yield* missionOf(row.missionId)
          yield* cap.acquire({
            projectId: mission.projectId,
            lineage: row.lineage,
            missionId: row.missionId,
            requestedBy: 'hemera',
          })
          const [fresh] = yield* database
            .update(teamCommentRuns)
            .set({ state: 'running', startedAt: row.startedAt ?? now() })
            .where(
              and(
                eq(teamCommentRuns.id, row.id),
                inArray(teamCommentRuns.state, ['waiting_for_slot', 'running']),
              ),
            )
            .returning()
            .pipe(Effect.mapError(refusedWhile('starting a team-comment run')))
          if (fresh === undefined) return yield* cap.release(row.lineage)
          if (yield* liveIn(row.lineage)) return
          const folder = yield* workspaceFolderIn(database, row.missionId)
          if (folder === null) return yield* ending(row, 'the mission has no Workspace', true)
          yield* sessions.reopen(
            row.lineage,
            {
              owner: { kind: 'mission', missionId: row.missionId },
              role: 'team-comment',
              folder,
              requestedBy: 'hemera',
            },
            'the drafts of the team comments start again',
          )
        }).pipe(
          run,
          Effect.catchCause((cause) => {
            if (Cause.hasInterruptsOnly(cause)) return Effect.void
            return Effect.andThen(
              log(`run ${row.id} did not start: ${String(cause)}`),
              ending(row, 'its session did not open', true),
            ).pipe(Effect.catchCause(() => Effect.void))
          }),
        )

      /** The mission's oldest run waiting or running, started once; one run goes at a time. */
      const next = (missionId: string): Effect.Effect<void> =>
        Effect.gen(function* () {
          const [first] = yield* runsOf(missionId, ['waiting_for_slot', 'running'])
          if (first === undefined || starting.has(first.id)) return
          if (first.state === 'running' && (yield* liveIn(first.lineage))) return
          const fiber = yield* slotThenSession(first).pipe(
            Effect.ensuring(Effect.sync(() => starting.delete(first.id))),
            Effect.forkIn(scope),
          )
          starting.set(first.id, fiber)
        }).pipe(
          run,
          Effect.catchCause((cause) => log(`the next run was not started: ${String(cause)}`)),
        )

      /** A run ended, done or failed: its session ended, its slot freed, the mission's next run. */
      const ending = (
        row: Pick<TeamCommentRunRow, 'id' | 'lineage' | 'missionId'>,
        why: string | null,
        fromWithin: boolean,
      ) =>
        Effect.gen(function* () {
          const background = starting.get(row.id)
          if (background !== undefined && !fromWithin) yield* Fiber.interrupt(background)
          const [ended] = yield* database
            .update(teamCommentRuns)
            .set({
              state: why === null ? 'done' : 'failed',
              failure: why === null ? null : secrets.mask(why),
              endedAt: now(),
            })
            .where(
              and(
                eq(teamCommentRuns.id, row.id),
                inArray(teamCommentRuns.state, ['waiting_for_slot', 'running']),
              ),
            )
            .returning()
            .pipe(Effect.mapError(refusedWhile('ending a team-comment run')))
          if (ended === undefined) return
          if (why !== null) yield* log(`run ${row.id} failed: ${why}`)
          yield* sessions.end(row.lineage, why ?? 'every team comment has its draft')
          yield* cap.release(row.lineage)
          yield* next(row.missionId).pipe(Effect.forkIn(scope))
        }).pipe(run)

      const draft = (grant: Grant, args: ToolArguments<'team_comment_draft'>) =>
        Effect.gen(function* () {
          const session = yield* getSession(grant.sessionId)
          const found = yield* teamRunOfLineage(session.lineage)
          if (found?.state !== 'running') return refusal('this session drafts no team comment now')
          const id = args.comment.trim()
          const [row] = yield* database
            .select()
            .from(teamComments)
            .where(and(eq(teamComments.id, id), eq(teamComments.runId, found.id)))
            .pipe(Effect.mapError(refusedWhile('reading a team comment')))
          if (row === undefined) return refusal(`${id} is no comment of your brief.`)
          yield* database
            .update(teamComments)
            .set({ reading: secrets.mask(args.reading), reply: secrets.mask(args.reply) })
            .where(eq(teamComments.id, id))
            .pipe(Effect.mapError(refusedWhile('storing a draft')))
          yield* told(row.missionId)
          const left = (yield* database
            .select({ id: teamComments.id, reading: teamComments.reading })
            .from(teamComments)
            .where(eq(teamComments.runId, found.id))
            .pipe(Effect.mapError(refusedWhile('reading the team comments')))).filter(
            (one) => one.reading === null,
          )
          if (left.length > 0) {
            return answered(
              `Stored, for the user only. Left to draft: ${left.map((one) => one.id).join(', ')}.`,
            )
          }
          yield* ending(found, null, false).pipe(Effect.forkIn(scope))
          return answered(
            'Stored, for the user only. Every comment has its draft: your session ends.',
          )
        }).pipe(
          run,
          Effect.catch((failed) => Effect.succeed(failure(`the call failed: ${failed.message}`))),
        )

      yield* TeamCommentDesk.use((desk) => desk.serve({ draft }))

      // --- the user's gestures ----------------------------------------------------------------

      const refuse = (reason: string) => Effect.fail(new TeamCommentRefused({ reason }))

      const gesture = (
        id: string,
        doing: string,
        body: (
          row: CommentRow,
        ) => Effect.Effect<
          { readonly set: Partial<CommentRow>; readonly event: string | null },
          Gesture
        >,
      ) =>
        Effect.gen(function* () {
          const row = yield* rowOf(id)
          const { set, event } = yield* body(row)
          const mission = yield* missionOf(row.missionId).pipe(
            Effect.catchTag('UnknownMission', () => Effect.fail(new UnknownTeamComment({ id }))),
          )
          yield* mutate(doing, (transaction) =>
            Effect.map(
              transaction
                .update(teamComments)
                .set(set)
                .where(eq(teamComments.id, id))
                .pipe(Effect.mapError(refusedWhile(doing))),
              () => ({
                result: undefined,
                events: event === null ? [] : [teamEvent(row, event, mission.stage, 'human')],
              }),
            ),
          ).pipe(run)
          yield* told(row.missionId)
          return yield* oneView(id)
        })

      const open = (row: CommentRow) => {
        if (row.state === 'feedback')
          return refuse('This team comment is in a round already: its feedback is there.')
        if (row.state === 'dismissed') return refuse('This team comment was dismissed.')
        return Effect.void
      }

      const take = (id: string, myTake: string) =>
        gesture(id, 'writing my take', (row) =>
          Effect.gen(function* () {
            yield* open(row)
            if (row.mine) return yield* refuse('This comment is yours: it needs no take.')
            const text = myTake.trim()
            return { set: { myTake: text === '' ? null : secrets.mask(text) }, event: null }
          }),
        )

      const addToRound = (id: string) =>
        gesture(id, 'adding a team comment to the round', (row) =>
          Effect.gen(function* () {
            yield* open(row)
            const mission = yield* missionOf(row.missionId).pipe(
              Effect.catchTag('UnknownMission', () => Effect.fail(new UnknownTeamComment({ id }))),
            )
            if (mission.stage !== 'review') {
              return yield* refuse(
                'A team comment joins a round in Review only: start a mission from it instead.',
              )
            }
            const body = [
              quotedBy(row),
              ...(row.myTake === null ? [] : ['', `My take: ${row.myTake}`]),
            ].join('\n')
            const feedback = yield* review
              .forgeFeedback(row.missionId, {
                author: row.mine
                  ? FeedbackUser.make({})
                  : FeedbackForge.make({ login: row.author }),
                kind: row.kind === 'inline' && row.anchorPath !== null ? 'code' : 'remark',
                body,
                source: `forge:${row.id}`,
                anchor: storedOf(row),
              })
              .pipe(
                Effect.catchTags({
                  UnknownMission: () => Effect.fail(new UnknownTeamComment({ id })),
                  FeedbackRefused: (refused) => refuse(refused.reason),
                }),
              )
            return {
              set: { state: 'feedback', feedbackId: feedback.id, integratedVersion: row.version },
              event: 'team_comment.added_to_round',
            }
          }),
        )

      const dismiss = (id: string) =>
        gesture(id, 'dismissing a team comment', (row) =>
          Effect.map(open(row), () => ({
            set: { state: 'dismissed' },
            event: 'team_comment.dismissed',
          })),
        )

      const startMissionFrom = (id: string) =>
        Effect.gen(function* () {
          const row = yield* rowOf(id)
          if (row.state === 'dismissed') return yield* refuse('This team comment was dismissed.')
          const mission = yield* missionOf(row.missionId).pipe(
            Effect.catchTag('UnknownMission', () => Effect.fail(new UnknownTeamComment({ id }))),
          )
          const source: TeamCommentSource = {
            commentId: row.id,
            text: row.body,
            origin: row.missionId,
            originSaid: `Started from ${missionKey(mission.prefix, mission.number)}, a team comment`,
            url: row.url,
          }
          return source
        })

      const changes = (missionId: string) =>
        Stream.unwrap(
          Effect.gen(function* () {
            yield* missionOf(missionId)
            return Stream.fromPubSub(changed).pipe(
              Stream.filter((one) => one === missionId),
              Stream.map((one): TeamCommentsChange => ({ missionId: one })),
            )
          }),
        )

      // --- what the team comments follow ------------------------------------------------------

      const textOf = (value: Schema.Json | undefined): string | null =>
        Option.getOrNull(readText(value))

      const events = yield* DomainEvents.use((domain) => domain.subscribe)
      const follow = Effect.gen(function* () {
        yield* events.pipe(
          Stream.runForEach((event) =>
            Effect.gen(function* () {
              // Right after a push of the mission.
              if (event.type === 'delivery.pushed') {
                yield* Effect.forkIn(fetch(event.entityId), scope)
              }
              const ended =
                (event.type === 'mission.moved' &&
                  (event.payload['to'] === 'done' || event.payload['to'] === 'planning')) ||
                event.type === 'mission.cancelled'
              if (ended) {
                for (const row of yield* runsOf(event.entityId, ['waiting_for_slot', 'running'])) {
                  yield* ending(row, 'the mission left Review and Shipping', false)
                }
              }
              if (event.type === 'session.stopped' && event.payload['role'] === 'team-comment') {
                const lineage = textOf(event.payload['lineage'])
                if (lineage === null || textOf(event.payload['state']) === 'replaced') return
                const row = yield* teamRunOfLineage(lineage)
                if (row?.state !== 'running' || (yield* liveIn(lineage))) return
                yield* ending(row, 'its session stopped', false)
              }
            }).pipe(
              run,
              Effect.catchCause((cause) => log(`an event was not followed: ${String(cause)}`)),
            ),
          ),
        )
      })

      // A turn that ended without every draft: told once, then failed.
      const post = yield* SessionPost
      const silentEnd = (sessionId: string) =>
        Effect.gen(function* () {
          const session = yield* getSession(sessionId)
          if (session.role !== 'team-comment') return
          const found = yield* teamRunOfLineage(session.lineage)
          if (found?.state !== 'running') return
          yield* sessions.settled(sessionId)
          if ((yield* getSession(sessionId)).state !== 'idle') return
          const [row] = yield* database
            .select()
            .from(teamCommentRuns)
            .where(eq(teamCommentRuns.id, found.id))
            .pipe(Effect.mapError(refusedWhile('reading a team-comment run')))
          if (row?.state !== 'running') return
          if (row.reminded) return yield* ending(row, NO_TEAM_COMMENT_DRAFT, false)
          yield* database
            .update(teamCommentRuns)
            .set({ reminded: true })
            .where(eq(teamCommentRuns.id, row.id))
            .pipe(Effect.mapError(refusedWhile('reminding a team-comment run')))
          yield* sessions.deliver({
            owner: session.owner,
            target: { lineage: row.lineage },
            kind: 'reminder',
            body: END_WITH_TEAM_COMMENT_DRAFTS,
          })
        }).pipe(
          run,
          Effect.catchCause((cause) => log(`a turn's end was not followed: ${String(cause)}`)),
        )

      // At every start: the runs a stop left go on, then every mission's comments are read.
      const reconcile = Effect.gen(function* () {
        const going = yield* runsOf(null, ['waiting_for_slot', 'running'])
        for (const row of going) {
          const [mission] = yield* database
            .select({ stage: missions.stage })
            .from(missions)
            .where(eq(missions.id, row.missionId))
            .pipe(Effect.mapError(refusedWhile('reading the mission')))
          if (stageOf(mission?.stage ?? '') === null) {
            yield* ending(row, 'the mission left Review and Shipping', false)
          }
        }
        for (const missionId of new Set(going.map((one) => one.missionId))) yield* next(missionId)
        for (const row of yield* runsOf(null, ['done', 'failed'])) {
          if (yield* liveIn(row.lineage)) {
            yield* sessions.end(row.lineage, 'it ended before a stop')
            yield* cap.release(row.lineage)
          }
        }
      }).pipe(
        run,
        Effect.catchCause((cause) => log(`the runs were not reconciled: ${String(cause)}`)),
      )

      const every = Duration.fromInputUnsafe(settings.every ?? TEAM_COMMENTS_EVERY)
      const gate = yield* AutomationGate
      yield* gate.pass.pipe(
        Effect.andThen(
          Effect.all(
            [
              follow,
              post.turns.pipe(
                Stream.filter((turn) => !turn.on),
                Stream.runForEach((turn) => Effect.forkIn(silentEnd(turn.sessionId), scope)),
              ),
              Effect.andThen(reconcile, fetchAll),
              fetchAll.pipe(Effect.delay(every), Effect.repeat(Schedule.spaced(every))),
            ],
            { concurrency: 'unbounded', discard: true },
          ),
        ),
        Effect.catchCause((cause) => log(`the team comments stopped: ${String(cause)}`)),
        Effect.forkIn(scope),
      )

      const service: TeamCommentsService = {
        list: (missionId) => list(missionId),
        take: (id, myTake) => take(id, myTake),
        addToRound: (id) => addToRound(id),
        dismiss: (id) => dismiss(id),
        startMissionFrom: (id) => startMissionFrom(id),
        changes,
        fetch,
        focused: fetchAll,
      }
      return service
    }),
  )
