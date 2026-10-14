/**
 * Review's checkpoints, feedback and comment anchors (#341, R1).
 *
 * - **Checkpoints.** When a mission enters Review (from Building, after the end of B9), a Review
 *   checkpoint of every repository is taken through #140 and recorded with the round it closes:
 *   round 0 on the first entry, round N when "Building · round N" comes back. They are the archive
 *   of what the user reviewed, read from the database alone. A stop between the move and its
 *   checkpoint is caught up at the next start.
 * - **Rounds.** A round collects feedback, is grilled and built by R2, is answered, and closes:
 *   forward only, at most one `collecting` and one running. Adding feedback starts nothing and
 *   reaches no agent. An `answered` round closes when all its feedback is resolved or withdrawn,
 *   when the next round's Fix starts, or at Ship (open question 35).
 * - **Feedback.** A remark, a comment on the code, or a question; its body masked, each edit a new
 *   version while it waits, read-only once a Fix took it. Only its author resolves it, once the
 *   agent addressed it; an unsatisfying answer gets a follow-up in the next round.
 * - **Anchors.** A comment on the code records its repository, path, side, lines, the tree it was
 *   written on (a snapshot held for the comment) and its lines' fingerprint; the anchored side's
 *   content is copied into the content store. Each read of the Review maps it onto the live diff:
 *   `current`, `moved`, or `outdated` with its excerpt. A comment is never dropped: an anchor that
 *   cannot be followed is `outdated`, or `unread` when the Workspace cannot be read.
 * - **Images** go to the mission's evidence (A8), which owns their checks.
 * - **A refused manual proof** (B6) becomes a remark of the collecting round, once.
 */

import { join } from 'node:path'

import {
  type AnchorAsked,
  type FeedbackKind,
  type FeedbackState,
  type LineRange,
  RUNNING_ROUND_STATES,
  type RoundState,
  type Stage,
  evidenceExtension,
  feedbackRefusal,
  imagePixels,
  missionKey,
  rangeRefusal,
  roundMoveRefusal,
  sniffImage,
  waitsForFix,
} from '@hemera/core/domain'
import {
  AnchorCurrent,
  AnchorMoved,
  AnchorOutdated,
  AnchorUnread,
  type AnchorLive,
  type AnchorView,
  CodeAnchorView,
  type CommentedVersion,
  DiffBinary,
  type DiffSide,
  DiffText,
  DiffWithheld,
  type ExcerptView,
  type FeedbackAuthor,
  FeedbackForge,
  FeedbackRefused,
  FeedbackUser,
  type FeedbackView,
  ImageRefused,
  type ImageAdded,
  type ReviewChange,
  type ReviewCheckpointView,
  type ReviewStateView,
  SpecAnchorView,
  StaleVersion,
  UnknownFeedback,
  UnknownMission,
  UserAuthor,
} from '@hemera/ipc'
import { and, asc, eq, inArray, ne } from 'drizzle-orm'
import {
  Context,
  Effect,
  Layer,
  Option,
  Predicate,
  Schedule,
  Schema,
  Semaphore,
  Stream,
} from 'effect'

import type { Log } from '../../main/diagnostic.ts'
import { ImageBlock, type PromptBlock, TextBlock } from '../agents/client.ts'
import { Checkpoints } from '../building/checkpoints.ts'
import { OutsideChanges } from '../building/outside.ts'
import { type FileSide, Snapshots } from '../building/snapshots.ts'
import { DomainEvents } from '../domain-events.ts'
import { type DomainEvent, type EventPayload, type NewEvent, eventOf } from '../journal.ts'
import { Evidence } from '../memory/index.ts'
import { missionFolder } from '../memory/files.ts'
import { ProfileHome } from '../profile-home.ts'
import { Secrets } from '../secrets.ts'
import {
  Database,
  type DatabaseError,
  type EngineTransaction,
  refusedWhile,
} from '../storage/database.ts'
import {
  checkpointRepositories,
  checkpoints,
  domainEvents,
  fileContents,
  memoryEvidence,
  missions,
  reviewCheckpoints,
  reviewFeedback,
  reviewFeedbackImages,
  reviewFeedbackVersions,
  reviewRounds,
  specRequirements,
  specScenarios,
} from '../storage/schema.ts'
import { mutate } from '../transaction.ts'
import { excerptOf, fingerprintOf, linesOf, reanchor } from './anchors.ts'
import { Diffs, type RepositoryNow } from './diffs.ts'

/** Where a suite holds the service: an anchor's tree taken, a checkpoint about to be, a proof's remark. */
export type ReviewHold = (at: 'anchor' | 'checkpoint' | 'proof' | 'reanchor') => Effect.Effect<void>

export interface ReviewSettings {
  readonly log: Log
  readonly hold?: ReviewHold | undefined
}

/** A feedback as the user writes it. */
export interface FeedbackAsked {
  readonly kind: FeedbackKind
  readonly body: string
  readonly anchor: AnchorAsked | null
  readonly images: ReadonlyArray<string>
}

type Refusals = FeedbackRefused | UnknownFeedback | DatabaseError

export interface ReviewService {
  readonly state: (
    missionId: string,
  ) => Effect.Effect<ReviewStateView, UnknownMission | DatabaseError>
  readonly feedbackAdd: (
    missionId: string,
    asked: FeedbackAsked,
    author: FeedbackAuthor,
  ) => Effect.Effect<FeedbackView, UnknownMission | FeedbackRefused | DatabaseError>
  readonly feedbackEdit: (
    feedbackId: string,
    body: string,
    version: number,
    by: FeedbackAuthor,
  ) => Effect.Effect<FeedbackView, Refusals | StaleVersion>
  readonly feedbackWithdraw: (
    feedbackId: string,
    by: FeedbackAuthor,
  ) => Effect.Effect<FeedbackView, Refusals>
  readonly feedbackResolve: (
    feedbackId: string,
    by: FeedbackAuthor,
  ) => Effect.Effect<FeedbackView, Refusals>
  readonly feedbackFollowUp: (
    feedbackId: string,
    body: string,
    images: ReadonlyArray<string>,
    by: FeedbackAuthor,
  ) => Effect.Effect<FeedbackView, Refusals>
  readonly imageAdd: (
    missionId: string,
    name: string,
    bytes: Uint8Array,
  ) => Effect.Effect<ImageAdded, UnknownMission | ImageRefused | DatabaseError>
  readonly commentedVersion: (feedbackId: string) => Effect.Effect<CommentedVersion, Refusals>
  /** Each change of the mission's Review, from where its sequence stands. */
  readonly changes: (
    missionId: string,
  ) => Stream.Stream<ReviewChange, UnknownMission | DatabaseError>
  /** Moves a round forward (R2): Fix takes the waiting feedback, and closes the answered round. */
  readonly moveRound: (
    missionId: string,
    number: number,
    to: RoundState,
  ) => Effect.Effect<void, FeedbackRefused | DatabaseError>
  /** The agent's answer to a feedback of a round (R2's `feedback_answer`): addressed. */
  readonly answer: (feedbackId: string, text: string) => Effect.Effect<void, Refusals>
  /** What an agent is handed of feedback: image blocks when it takes images, their paths otherwise. */
  readonly blocks: (
    feedbackIds: ReadonlyArray<string>,
    images: boolean,
  ) => Effect.Effect<ReadonlyArray<PromptBlock>, Refusals>
  /** What a stop left undone, then each committed event of the stream, for as long as it lasts. */
  readonly follow: (events: Stream.Stream<DomainEvent>) => Effect.Effect<void>
}

export class Review extends Context.Service<Review, ReviewService>()('Review') {}

type FeedbackRow = typeof reviewFeedback.$inferSelect

const now = () => new Date().toISOString()

const readRound = Schema.decodeUnknownOption(Schema.Number)

/** A Review checkpoint Git refused is tried again after 1 s, 2 s, 4 s…, this many times. */
const CHECKPOINT_RETRY = '1 second'
const CHECKPOINT_TRIES = 6

const USER: FeedbackAuthor = FeedbackUser.make({})

const authorOf = (row: FeedbackRow): FeedbackAuthor =>
  row.authorKind === 'forge' ? FeedbackForge.make({ login: row.authorLogin ?? '' }) : USER

const sameAuthor = (left: FeedbackAuthor, right: FeedbackAuthor) =>
  Predicate.isTagged(left, 'Forge')
    ? Predicate.isTagged(right, 'Forge') && left.login === right.login
    : Predicate.isTagged(right, 'User')

const STATES: ReadonlyArray<FeedbackState> = [
  'waiting',
  'in_round',
  'addressed',
  'resolved',
  'withdrawn',
]
const stateOf = (row: FeedbackRow): FeedbackState =>
  STATES.find((one) => one === row.state) ?? 'waiting'
const KINDS: ReadonlyArray<FeedbackKind> = ['remark', 'code', 'question']
const kindOf = (row: FeedbackRow): FeedbackKind => KINDS.find((one) => one === row.kind) ?? 'remark'
const ROUNDS: ReadonlyArray<RoundState> = [
  'collecting',
  'grilling',
  'building',
  'answered',
  'closed',
]
const roundStateOf = (state: string): RoundState =>
  ROUNDS.find((one) => one === state) ?? 'collecting'

/** A state as a sentence says it. */
const STATE_WORDS: Record<FeedbackState, string> = {
  waiting: 'waiting',
  in_round: 'in a round',
  addressed: 'addressed',
  resolved: 'resolved',
  withdrawn: 'withdrawn',
}

/** Who did it, as the Journal says it. */
const rangeSaid = (start: number | null, end: number | null) =>
  start === null || end === null
    ? ''
    : start === end
      ? `, line ${String(start)}`
      : `, lines ${String(start)}–${String(end)}`

const placeOf = (repository: string | null, path: string | null) =>
  repository === null || repository === '' || repository === '.'
    ? (path ?? '')
    : `${repository}/${path ?? ''}`

/** What one feedback was, as its event's payload carries it for the Journal. */
const feedbackPayload = (row: FeedbackRow) => ({
  feedbackId: row.id,
  round: row.round,
  kind: row.kind,
  body: row.body,
  authorKind: row.authorKind,
  authorLogin: row.authorLogin,
  repository: row.anchorRepository,
  path: row.anchorPath,
  start: row.anchorStart,
  end: row.anchorEnd,
  item: row.anchorItem,
})

const reviewEvent = (
  missionId: string,
  type: string,
  payload: EventPayload,
  author: FeedbackAuthor | null,
): NewEvent => ({
  type,
  entityKind: 'mission',
  entityId: missionId,
  source: author === null ? 'system' : 'ui',
  author: author === null ? 'hemera' : 'human',
  payload,
})

/** One side of a file as the window receives it, from its kept content. */
const sideViewOf = (
  side: { sha256: string | null; size: number | null; withheld: string | null },
  bytes: Buffer | null,
): DiffSide => {
  if (side.withheld !== null || bytes === null) {
    return DiffWithheld.make({ reason: side.withheld ?? 'content withheld', size: side.size ?? 0 })
  }
  if (bytes.includes(0)) return DiffBinary.make({ size: side.size ?? bytes.length })
  return DiffText.make({
    text: bytes.toString('utf8'),
    encoding: 'utf-8',
    size: side.size ?? bytes.length,
  })
}

/** The lines of a kept side, null for a binary or a withheld one. */
const textLines = (bytes: Uint8Array | null) =>
  bytes === null || bytes.includes(0) ? null : linesOf(bytes)

export const reviewLayer = (settings: ReviewSettings) =>
  Layer.effect(
    Review,
    Effect.gen(function* () {
      const database = yield* Database
      const events = yield* DomainEvents
      const diffs = yield* Diffs
      const snapshots = yield* Snapshots
      const checkpointsService = yield* Checkpoints
      const outside = yield* OutsideChanges
      const secrets = yield* Secrets
      const evidence = yield* Evidence
      const home = yield* ProfileHome
      const hold: ReviewHold = settings.hold ?? (() => Effect.void)
      const said = (line: string) => Effect.sync(() => settings.log(`review: ${line}`))
      const scope = yield* Effect.scope
      const turns = new Map<string, Semaphore.Semaphore>()
      const turnOf = (missionId: string) => {
        const found = turns.get(missionId) ?? Semaphore.makeUnsafe(1)
        turns.set(missionId, found)
        return found
      }
      const sequences = new Map<string, number>()
      const provided = <A, E>(effect: Effect.Effect<A, E, Database | DomainEvents>) =>
        effect.pipe(
          Effect.provideService(Database, database),
          Effect.provideService(DomainEvents, events),
        )

      const missionRow = (missionId: string) =>
        database
          .select({
            id: missions.id,
            stage: missions.stage,
            round: missions.round,
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

      const feedbackRow = (feedbackId: string) =>
        database
          .select()
          .from(reviewFeedback)
          .where(eq(reviewFeedback.id, feedbackId))
          .pipe(
            Effect.mapError(refusedWhile('reading a feedback')),
            Effect.flatMap(([row]) =>
              row === undefined
                ? Effect.fail(new UnknownFeedback({ id: feedbackId }))
                : Effect.succeed(row),
            ),
          )

      // --- rounds ---------------------------------------------------------------------------

      const roundsIn = (transaction: EngineTransaction, missionId: string) =>
        transaction
          .select()
          .from(reviewRounds)
          .where(eq(reviewRounds.missionId, missionId))
          .orderBy(asc(reviewRounds.number))
          .pipe(Effect.mapError(refusedWhile('reading the rounds')))

      /** The round that takes feedback now: the `collecting` one, created after the last. */
      const collectingIn = (
        transaction: EngineTransaction,
        missionId: string,
        author: FeedbackAuthor | null,
      ) =>
        Effect.gen(function* () {
          const rounds = yield* roundsIn(transaction, missionId)
          const open = rounds.find((one) => one.state === 'collecting')
          const none: NewEvent[] = []
          if (open !== undefined) return { number: open.number, events: none }
          const number = (rounds.at(-1)?.number ?? 0) + 1
          const at = now()
          yield* transaction
            .insert(reviewRounds)
            .values({ missionId, number, state: 'collecting', createdAt: at, movedAt: at })
            .pipe(Effect.mapError(refusedWhile('opening a round')))
          return {
            number,
            events: [reviewEvent(missionId, 'review.round_created', { round: number }, author)],
          }
        })

      const setRound = (
        transaction: EngineTransaction,
        missionId: string,
        number: number,
        from: string,
        to: RoundState,
      ) =>
        Effect.gen(function* () {
          yield* transaction
            .update(reviewRounds)
            .set({ state: to, movedAt: now() })
            .where(and(eq(reviewRounds.missionId, missionId), eq(reviewRounds.number, number)))
            .pipe(Effect.mapError(refusedWhile('moving a round')))
          return reviewEvent(missionId, 'review.round_moved', { round: number, from, to }, null)
        })

      /** Closes an `answered` round whose feedback is all resolved or withdrawn. */
      const closedIfSettled = (transaction: EngineTransaction, missionId: string, number: number) =>
        Effect.gen(function* () {
          const [round] = yield* transaction
            .select()
            .from(reviewRounds)
            .where(and(eq(reviewRounds.missionId, missionId), eq(reviewRounds.number, number)))
            .pipe(Effect.mapError(refusedWhile('reading a round')))
          if (round?.state !== 'answered') return []
          const rows = yield* transaction
            .select({ state: reviewFeedback.state })
            .from(reviewFeedback)
            .where(and(eq(reviewFeedback.missionId, missionId), eq(reviewFeedback.round, number)))
            .pipe(Effect.mapError(refusedWhile('reading a round')))
          if (!rows.every((one) => one.state === 'resolved' || one.state === 'withdrawn')) return []
          return [yield* setRound(transaction, missionId, number, 'answered', 'closed')]
        })

      // --- anchors --------------------------------------------------------------------------

      /** What a code anchor records, read from the Workspace before the feedback is written. */
      interface Recorded {
        readonly repository: string
        readonly path: string
        readonly side: 'new' | 'old'
        readonly lines: LineRange | null
        readonly tree: string
        readonly fingerprint: string | null
        readonly content: FileSide
      }

      const refuse = (reason: string) => Effect.fail(new FeedbackRefused({ reason }))

      const recordCode = (
        missionId: string,
        feedbackId: string,
        anchor: Extract<AnchorAsked, { _tag: 'Code' }>,
      ) =>
        Effect.gen(function* () {
          const places = yield* diffs.places(missionId)
          if (places === null)
            return yield* refuse('The Workspace is gone: the code can no longer be commented on.')
          const place = places.find((one) => one.name === anchor.repository)
          if (place === undefined) {
            return yield* refuse(
              `The Workspace has no repository ${anchor.repository}: it has ${places.map((one) => one.name).join(', ')}.`,
            )
          }
          const live = yield* diffs.at(missionId, anchor.repository)
          if (live === null)
            return yield* refuse(`${anchor.repository} could not be read now: try again.`)
          const repository = { name: place.name, folder: place.folder }
          const failed = (failure: { readonly message: string }) =>
            new FeedbackRefused({ reason: failure.message })
          /** The anchored side of the file in a tree, or the refusal that says why there is none. */
          const sideAt = (tree: string) =>
            Effect.gen(function* () {
              const [file] = yield* snapshots
                .diff(missionId, repository, live.base, tree, anchor.path)
                .pipe(Effect.mapError(failed))
              if (file === undefined || file.path !== anchor.path) {
                return yield* refuse(
                  `${anchor.path} is not in the changes of ${anchor.repository}.`,
                )
              }
              const side = anchor.side === 'new' ? file.after : file.before
              if (side === null) {
                return yield* refuse(
                  `${anchor.path} has no ${anchor.side === 'new' ? 'new' : 'old'} side: comment on the other one.`,
                )
              }
              return side
            })
          const linesAt = (side: FileSide) =>
            Effect.gen(function* () {
              const lines = textLines(side.withheld === null ? side.content : null)
              if (lines === null) {
                return yield* refuse(
                  `${anchor.path} has no lines to read: comment on the whole file.`,
                )
              }
              return lines
            })
          // What the user saw (the tree the window showed, or the live one) is checked first, before
          // any snapshot is held for the comment: a refused anchor leaves nothing behind.
          const seenTree = anchor.tree ?? live.tree
          const seen = yield* sideAt(seenTree)
          const seenLines = anchor.lines === null ? null : yield* linesAt(seen)
          if (anchor.lines !== null && seenLines !== null) {
            const wrong = rangeRefusal(anchor.lines, seenLines.length)
            if (wrong !== null) return yield* refuse(wrong)
          }
          const tree = yield* snapshots
            .take(repository, { kind: 'feedback', missionId, feedbackId })
            .pipe(Effect.mapError(failed))
          yield* hold('anchor')
          const content = yield* sideAt(tree)
          if (anchor.lines === null || seenLines === null) {
            const whole: Recorded = { ...anchor, tree, fingerprint: null, content }
            return whole
          }
          const lines = yield* linesAt(content)
          // The file may have moved on since it was shown: the comment goes on the lines seen.
          let range = anchor.lines
          if (tree !== seenTree) {
            const found = reanchor(seenLines, lines, range, fingerprintOf(seenLines, range))
            if (found.kind === 'outdated') {
              return yield* refuse('The lines changed while you wrote: select them again.')
            }
            range = found.range
          }
          const recorded: Recorded = {
            ...anchor,
            lines: range,
            tree,
            fingerprint: fingerprintOf(lines, range),
            content,
          }
          return recorded
        })

      const specItemExists = (missionId: string, item: string) =>
        Effect.gen(function* () {
          const requirements = yield* database
            .select({ id: specRequirements.id })
            .from(specRequirements)
            .where(
              and(
                eq(specRequirements.missionId, missionId),
                eq(specRequirements.id, item),
                eq(specRequirements.removed, false),
              ),
            )
          const scenarios = yield* database
            .select({ id: specScenarios.id })
            .from(specScenarios)
            .where(
              and(
                eq(specScenarios.missionId, missionId),
                eq(specScenarios.id, item),
                eq(specScenarios.removed, false),
              ),
            )
          return requirements.length + scenarios.length > 0
        }).pipe(Effect.mapError(refusedWhile('reading the Spec')))

      /** The images named, each an image of the mission's evidence. */
      const imagesChecked = (missionId: string, images: ReadonlyArray<string>) =>
        Effect.gen(function* () {
          if (images.length === 0) return
          if (new Set(images).size !== images.length) {
            return yield* refuse('An image is attached once: it was given twice.')
          }
          const rows = yield* database
            .select({ id: memoryEvidence.id, mediaType: memoryEvidence.mediaType })
            .from(memoryEvidence)
            .where(
              and(eq(memoryEvidence.missionId, missionId), inArray(memoryEvidence.id, [...images])),
            )
            .pipe(Effect.mapError(refusedWhile('reading the images')))
          const missing = images.find(
            (id) => !rows.some((row) => row.id === id && row.mediaType.startsWith('image/')),
          )
          if (missing !== undefined)
            return yield* refuse(`${missing} is not an image of this mission.`)
        })

      /** Where each comment stood on a live tree: computed once per comment and tree (#341). */
      const reanchored = new Map<string, AnchorLive>()
      const REANCHORED_MAX = 2_000

      const liveOf = (
        missionId: string,
        row: FeedbackRow,
        live: RepositoryNow | null,
        content: Buffer | null,
      ) => {
        if (live === null) {
          return Effect.succeed(AnchorUnread.make({ why: 'the Workspace cannot be read' }))
        }
        const key = [row.id, row.anchorTree, live.base, live.tree].join('\u0000')
        const known = reanchored.get(key)
        if (known !== undefined) return Effect.succeed(known)
        return computeLive(missionId, row, live, content).pipe(
          Effect.tap((found) =>
            Effect.sync(() => {
              // A failure to read is not kept: the next read tries again.
              if (Predicate.isTagged(found, 'Unread')) return
              if (reanchored.size >= REANCHORED_MAX) reanchored.clear()
              reanchored.set(key, found)
            }),
          ),
        )
      }

      const computeLive = (
        missionId: string,
        row: FeedbackRow,
        live: RepositoryNow,
        content: Buffer | null,
      ) =>
        Effect.gen(function* () {
          yield* hold('reanchor')
          const path = row.anchorPath ?? ''
          const lines: LineRange | null =
            row.anchorStart === null || row.anchorEnd === null
              ? null
              : { start: row.anchorStart, end: row.anchorEnd }
          const repository = { name: row.anchorRepository ?? '', folder: live.folder }
          let pathNow = path
          let sideNow: FileSide | null
          if (row.anchorSide === 'old') {
            const listed = live.files.find((one) => one.path === path || one.oldPath === path)
            if (listed === undefined)
              return AnchorOutdated.make({ why: 'the lines are no longer in the changes' })
            pathNow = listed.path
            const [file] = yield* snapshots.diff(
              missionId,
              repository,
              live.base,
              live.tree,
              listed.path,
            )
            sideNow = file?.before ?? null
            if (sideNow === null)
              return AnchorOutdated.make({ why: 'the lines are no longer in the changes' })
          } else {
            const changed = yield* snapshots.changed(
              missionId,
              repository,
              row.anchorTree,
              live.tree,
            )
            const moved = changed.find((one) => one.oldPath === path && one.status === 'R')
            const same = changed.find((one) => one.path === path)
            if (moved === undefined && same === undefined) {
              return AnchorCurrent.make({ path, lines })
            }
            if (moved === undefined && same?.status === 'D')
              return AnchorOutdated.make({ why: 'the file was deleted' })
            pathNow = moved?.path ?? path
            // A whole-file comment is outdated only when its file is gone: changed, it holds.
            if (lines === null) {
              return pathNow === path
                ? AnchorCurrent.make({ path, lines: null })
                : AnchorMoved.make({ path: pathNow, lines: null })
            }
            sideNow = yield* snapshots.read(missionId, repository, live.tree, pathNow)
            if (sideNow === null) return AnchorOutdated.make({ why: 'the file was deleted' })
          }
          if (lines === null) {
            return pathNow === path
              ? AnchorCurrent.make({ path, lines: null })
              : AnchorMoved.make({ path: pathNow, lines: null })
          }
          const before = textLines(content)
          const after = textLines(sideNow.withheld === null ? sideNow.content : null)
          if (before === null || after === null || row.anchorFingerprint === null) {
            return AnchorOutdated.make({ why: 'the file can no longer be read as lines' })
          }
          const found = reanchor(before, after, lines, row.anchorFingerprint)
          if (found.kind === 'outdated') return AnchorOutdated.make({ why: 'the lines changed' })
          if (found.kind === 'current' && pathNow === path)
            return AnchorCurrent.make({ path, lines: found.range })
          return AnchorMoved.make({ path: pathNow, lines: found.range })
        }).pipe(
          Effect.catch((failure) =>
            Effect.succeed<AnchorLive>(AnchorUnread.make({ why: failure.message })),
          ),
        )

      // --- views ----------------------------------------------------------------------------

      const contentOf = (sha256: string | null) =>
        sha256 === null
          ? Effect.succeed(null)
          : database
              .select({ bytes: fileContents.bytes })
              .from(fileContents)
              .where(eq(fileContents.sha256, sha256))
              .pipe(
                Effect.mapError(refusedWhile('reading a commented version')),
                Effect.map(([row]) => row?.bytes ?? null),
              )

      const excerptFor = (row: FeedbackRow, bytes: Buffer | null): ExcerptView | null => {
        const lines = textLines(row.anchorWithheld === null ? bytes : null)
        if (lines === null || row.anchorStart === null || row.anchorEnd === null) return null
        return excerptOf(lines, { start: row.anchorStart, end: row.anchorEnd })
      }

      const checkpointView = (missionId: string, round: number, checkpointId: string) =>
        Effect.gen(function* () {
          const [row] = yield* database
            .select()
            .from(checkpoints)
            .where(eq(checkpoints.id, checkpointId))
          const repositories = yield* database
            .select()
            .from(checkpointRepositories)
            .where(eq(checkpointRepositories.checkpointId, checkpointId))
            .orderBy(asc(checkpointRepositories.position))
          const view: ReviewCheckpointView = {
            id: checkpointId,
            round,
            kind: round === 0 ? 'review_entry' : 'round_end',
            takenAt: row?.takenAt ?? '',
            repositories: repositories.map((one) => ({
              repository: one.repository,
              head: one.head,
              tree: one.tree,
            })),
          }
          return view
        }).pipe(Effect.mapError(refusedWhile(`reading the checkpoints of ${missionId}`)))

      const viewsOf = (missionId: string, rows: ReadonlyArray<FeedbackRow>) =>
        Effect.gen(function* () {
          const ids = rows.map((row) => row.id)
          const versions =
            ids.length === 0
              ? []
              : yield* database
                  .select()
                  .from(reviewFeedbackVersions)
                  .where(inArray(reviewFeedbackVersions.feedbackId, ids))
                  .orderBy(asc(reviewFeedbackVersions.version))
                  .pipe(Effect.mapError(refusedWhile('reading the feedback')))
          const images =
            ids.length === 0
              ? []
              : yield* database
                  .select()
                  .from(reviewFeedbackImages)
                  .innerJoin(memoryEvidence, eq(memoryEvidence.id, reviewFeedbackImages.evidenceId))
                  .where(inArray(reviewFeedbackImages.feedbackId, ids))
                  .orderBy(asc(reviewFeedbackImages.position))
                  .pipe(Effect.mapError(refusedWhile('reading the feedback')))
          const followers = yield* database
            .select({ id: reviewFeedback.id, followsUp: reviewFeedback.followsUp })
            .from(reviewFeedback)
            .where(eq(reviewFeedback.missionId, missionId))
            .orderBy(asc(reviewFeedback.createdAt))
            .pipe(Effect.mapError(refusedWhile('reading the feedback')))
          const lives = new Map<string, RepositoryNow | null>()
          const liveRepository = (repository: string) =>
            Effect.gen(function* () {
              if (lives.has(repository)) return lives.get(repository) ?? null
              const found = yield* diffs
                .at(missionId, repository)
                .pipe(Effect.orElseSucceed(() => null))
              lives.set(repository, found)
              return found
            })
          const views: FeedbackView[] = []
          for (const row of rows) {
            let anchor: AnchorView | null = null
            if (row.anchorKind === 'spec')
              anchor = SpecAnchorView.make({ item: row.anchorItem ?? '' })
            if (row.anchorKind === 'code') {
              const bytes = yield* contentOf(row.anchorSha256)
              const live = yield* liveRepository(row.anchorRepository ?? '')
              anchor = CodeAnchorView.make({
                repository: row.anchorRepository ?? '',
                path: row.anchorPath ?? '',
                side: row.anchorSide === 'old' ? 'old' : 'new',
                lines:
                  row.anchorStart === null || row.anchorEnd === null
                    ? null
                    : { start: row.anchorStart, end: row.anchorEnd },
                tree: row.anchorTree ?? '',
                excerpt: excerptFor(row, bytes),
                live: yield* liveOf(missionId, row, live, bytes),
              })
            }
            views.push({
              id: row.id,
              missionId,
              round: row.round,
              author: authorOf(row),
              kind: kindOf(row),
              state: stateOf(row),
              body: row.body,
              version: row.version,
              versions: versions
                .filter((one) => one.feedbackId === row.id)
                .map((one) => ({ version: one.version, body: one.body, writtenAt: one.writtenAt })),
              images: images
                .filter((one) => one.review_feedback_images.feedbackId === row.id)
                .map(({ memory_evidence: item }) => ({
                  evidenceId: item.id,
                  name: item.name,
                  sha256: item.sha256,
                  size: item.size,
                  mediaType: item.mediaType,
                })),
              anchor,
              followsUp: row.followsUp,
              followedBy: followers.filter((one) => one.followsUp === row.id).map((one) => one.id),
              answer: row.answer,
              createdAt: row.createdAt,
              updatedAt: row.updatedAt,
            })
          }
          return views
        })

      const state = (missionId: string) =>
        Effect.gen(function* () {
          yield* missionRow(missionId)
          const rounds = yield* database
            .select()
            .from(reviewRounds)
            .where(eq(reviewRounds.missionId, missionId))
            .orderBy(asc(reviewRounds.number))
            .pipe(Effect.mapError(refusedWhile('reading the rounds')))
          const kept = yield* database
            .select()
            .from(reviewCheckpoints)
            .where(eq(reviewCheckpoints.missionId, missionId))
            .orderBy(asc(reviewCheckpoints.round))
            .pipe(Effect.mapError(refusedWhile('reading the checkpoints')))
          const rows = yield* database
            .select()
            .from(reviewFeedback)
            .where(eq(reviewFeedback.missionId, missionId))
            .orderBy(asc(reviewFeedback.round), asc(reviewFeedback.createdAt))
            .pipe(Effect.mapError(refusedWhile('reading the feedback')))
          const feedback = yield* viewsOf(missionId, rows)
          const view: ReviewStateView = {
            missionId,
            checkpoints: yield* Effect.forEach(kept, (one) =>
              checkpointView(missionId, one.round, one.checkpointId),
            ),
            rounds: rounds.map((one) => ({
              number: one.number,
              state: roundStateOf(one.state),
              createdAt: one.createdAt,
              movedAt: one.movedAt,
            })),
            feedback,
            waits: waitsForFix(feedback),
          }
          return view
        })

      const oneView = (feedbackId: string) =>
        Effect.gen(function* () {
          const row = yield* feedbackRow(feedbackId)
          const [view] = yield* viewsOf(row.missionId, [row])
          if (view === undefined) return yield* new UnknownFeedback({ id: feedbackId })
          return view
        })

      // --- writing feedback -----------------------------------------------------------------

      interface Written {
        readonly missionId: string
        readonly author: FeedbackAuthor
        readonly kind: FeedbackKind
        readonly body: string
        readonly images: ReadonlyArray<string>
        readonly code: Recorded | null
        readonly item: string | null
        readonly followsUp: string | null
        readonly source: string | null
        /** An anchor copied from the feedback followed up. */
        readonly copied: FeedbackRow | null
      }

      /** Writes a feedback in the collecting round, with its first version and its images. */
      const writeIn = (
        transaction: EngineTransaction,
        id: string,
        written: Written,
        type: string,
      ) =>
        Effect.gen(function* () {
          const round = yield* collectingIn(transaction, written.missionId, written.author)
          const at = now()
          const body = secrets.mask(written.body.trim())
          const { code, copied } = written
          if (code?.content.content != null) {
            yield* transaction
              .insert(fileContents)
              .values({
                sha256: code.content.sha256,
                bytes: Buffer.from(code.content.content),
                size: code.content.size,
                masked: code.content.masked,
              })
              .onConflictDoNothing()
              .pipe(Effect.mapError(refusedWhile('keeping a commented version')))
          }
          const row: FeedbackRow = {
            id,
            missionId: written.missionId,
            round: round.number,
            authorKind: Predicate.isTagged(written.author, 'Forge') ? 'forge' : 'user',
            authorLogin: Predicate.isTagged(written.author, 'Forge') ? written.author.login : null,
            kind: written.kind,
            state: 'waiting',
            body,
            version: 1,
            anchorKind:
              code !== null
                ? 'code'
                : written.item !== null
                  ? 'spec'
                  : (copied?.anchorKind ?? null),
            anchorRepository: code?.repository ?? copied?.anchorRepository ?? null,
            anchorPath: code?.path ?? copied?.anchorPath ?? null,
            anchorSide: code?.side ?? copied?.anchorSide ?? null,
            anchorStart:
              code === null ? (copied?.anchorStart ?? null) : (code.lines?.start ?? null),
            anchorEnd: code === null ? (copied?.anchorEnd ?? null) : (code.lines?.end ?? null),
            anchorTree: code?.tree ?? copied?.anchorTree ?? null,
            anchorFingerprint:
              code === null ? (copied?.anchorFingerprint ?? null) : code.fingerprint,
            anchorSha256: code?.content.sha256 ?? copied?.anchorSha256 ?? null,
            anchorSize: code?.content.size ?? copied?.anchorSize ?? null,
            anchorWithheld:
              code === null ? (copied?.anchorWithheld ?? null) : code.content.withheld,
            anchorItem: written.item ?? copied?.anchorItem ?? null,
            followsUp: written.followsUp,
            source: written.source,
            answer: null,
            createdAt: at,
            updatedAt: at,
          }
          yield* transaction
            .insert(reviewFeedback)
            .values(row)
            .pipe(Effect.mapError(refusedWhile('writing a feedback')))
          yield* transaction
            .insert(reviewFeedbackVersions)
            .values({ feedbackId: id, version: 1, body, writtenAt: at })
            .pipe(Effect.mapError(refusedWhile('writing a feedback')))
          for (const [position, evidenceId] of written.images.entries()) {
            yield* transaction
              .insert(reviewFeedbackImages)
              .values({ feedbackId: id, position, evidenceId })
              .pipe(Effect.mapError(refusedWhile('writing a feedback')))
          }
          return [
            ...round.events,
            reviewEvent(written.missionId, type, feedbackPayload(row), written.author),
          ]
        })

      const feedbackAdd = (missionId: string, asked: FeedbackAsked, author: FeedbackAuthor) =>
        Effect.gen(function* () {
          const mission = yield* missionRow(missionId)
          // SAFETY: the column only ever holds a Stage, written by moveIn.
          const stage = mission.stage as Stage
          const wrong = feedbackRefusal({ stage, round: mission.round }, asked.body)
          if (wrong !== null) return yield* refuse(wrong)
          const anchor = asked.anchor
          if (asked.kind === 'code' && (anchor === null || !Predicate.isTagged(anchor, 'Code'))) {
            return yield* refuse('A comment on the code is anchored on a file, a line or a range.')
          }
          if (asked.kind === 'remark' && anchor !== null && Predicate.isTagged(anchor, 'Code')) {
            return yield* refuse(
              'A remark is anchored on a requirement or a scenario of the Spec, or on nothing.',
            )
          }
          yield* imagesChecked(missionId, asked.images)
          const id = crypto.randomUUID()
          let code: Recorded | null = null
          let item: string | null = null
          if (anchor !== null && Predicate.isTagged(anchor, 'Code'))
            code = yield* recordCode(missionId, id, anchor)
          if (anchor !== null && Predicate.isTagged(anchor, 'Spec')) {
            if (!(yield* specItemExists(missionId, anchor.item))) {
              return yield* refuse(
                `${anchor.item} is not a requirement or a scenario of the frozen Spec.`,
              )
            }
            item = anchor.item
          }
          const written: Written = {
            missionId,
            author,
            kind: asked.kind,
            body: asked.body,
            images: asked.images,
            code,
            item,
            followsUp: null,
            source: null,
            copied: null,
          }
          yield* provided(
            mutate('writing a feedback', (transaction) =>
              Effect.map(writeIn(transaction, id, written, 'review.feedback_added'), (added) => ({
                result: undefined,
                events: added,
              })),
            ),
          )
          return yield* oneView(id).pipe(
            Effect.catchTag('UnknownFeedback', () => Effect.die(`feedback ${id} vanished`)),
          )
        })

      /** A gesture on a feedback by its author, in one transaction. */
      const gesture = <E>(
        feedbackId: string,
        by: FeedbackAuthor,
        doing: string,
        verb: string,
        body: (
          row: FeedbackRow,
          transaction: EngineTransaction,
        ) => Effect.Effect<ReadonlyArray<NewEvent>, E>,
      ) =>
        Effect.gen(function* () {
          yield* provided(
            mutate(doing, (transaction) =>
              Effect.gen(function* () {
                const [row] = yield* transaction
                  .select()
                  .from(reviewFeedback)
                  .where(eq(reviewFeedback.id, feedbackId))
                  .pipe(Effect.mapError(refusedWhile(doing)))
                if (row === undefined) return yield* new UnknownFeedback({ id: feedbackId })
                if (!sameAuthor(authorOf(row), by)) {
                  return yield* new FeedbackRefused({
                    reason: `Only its author ${verb} a feedback.`,
                  })
                }
                return { result: undefined, events: yield* body(row, transaction) }
              }),
            ),
          )
          return yield* oneView(feedbackId)
        })

      const setState = (
        transaction: EngineTransaction,
        row: FeedbackRow,
        to: FeedbackState,
        type: string,
        by: FeedbackAuthor | null,
      ) =>
        Effect.gen(function* () {
          yield* transaction
            .update(reviewFeedback)
            .set({ state: to, updatedAt: now() })
            .where(eq(reviewFeedback.id, row.id))
            .pipe(Effect.mapError(refusedWhile('moving a feedback')))
          const closed = yield* closedIfSettled(transaction, row.missionId, row.round)
          return [reviewEvent(row.missionId, type, feedbackPayload(row), by), ...closed]
        })

      const service: ReviewService = {
        state,
        feedbackAdd,
        feedbackEdit: (feedbackId, body, version, by) =>
          gesture(feedbackId, by, 'editing a feedback', 'edits', (row, transaction) =>
            Effect.gen(function* () {
              const standing = stateOf(row)
              if (standing === 'withdrawn')
                return yield* refuse('This feedback was withdrawn: it is read-only now.')
              if (standing !== 'waiting')
                return yield* refuse('This feedback was taken by a Fix: it is read-only now.')
              if (body.trim() === '')
                return yield* refuse('a feedback is never empty: write what you found')
              if (row.version !== version) {
                return yield* new StaleVersion({
                  entity: 'feedback',
                  id: row.id,
                  expected: version,
                })
              }
              const masked = secrets.mask(body.trim())
              const at = now()
              yield* transaction
                .update(reviewFeedback)
                .set({ body: masked, version: version + 1, updatedAt: at })
                .where(and(eq(reviewFeedback.id, row.id), eq(reviewFeedback.version, version)))
                .pipe(Effect.mapError(refusedWhile('editing a feedback')))
              yield* transaction
                .insert(reviewFeedbackVersions)
                .values({ feedbackId: row.id, version: version + 1, body: masked, writtenAt: at })
                .pipe(Effect.mapError(refusedWhile('editing a feedback')))
              return [
                reviewEvent(
                  row.missionId,
                  'review.feedback_edited',
                  { ...feedbackPayload(row), body: masked, version: version + 1 },
                  by,
                ),
              ]
            }),
          ),
        feedbackWithdraw: (feedbackId, by) =>
          gesture(feedbackId, by, 'withdrawing a feedback', 'withdraws', (row, transaction) =>
            Effect.gen(function* () {
              const standing = stateOf(row)
              if (standing === 'resolved' || standing === 'withdrawn') {
                return yield* refuse(
                  `This feedback is ${STATE_WORDS[standing]}: it can no longer be withdrawn.`,
                )
              }
              return yield* setState(transaction, row, 'withdrawn', 'review.feedback_withdrawn', by)
            }),
          ),
        feedbackResolve: (feedbackId, by) =>
          gesture(feedbackId, by, 'resolving a feedback', 'resolves', (row, transaction) =>
            Effect.gen(function* () {
              const standing = stateOf(row)
              if (standing !== 'addressed') {
                return yield* refuse(
                  `This feedback is ${STATE_WORDS[standing]}: it is resolved once the agent addressed it.`,
                )
              }
              return yield* setState(transaction, row, 'resolved', 'review.feedback_resolved', by)
            }),
          ),
        feedbackFollowUp: (feedbackId, body, images, by) =>
          Effect.gen(function* () {
            const original = yield* feedbackRow(feedbackId)
            if (stateOf(original) !== 'addressed') {
              return yield* refuse(
                `This feedback is ${STATE_WORDS[stateOf(original)]}: only an addressed one is followed up.`,
              )
            }
            const mission = yield* missionRow(original.missionId).pipe(Effect.orDie)
            // SAFETY: the column only ever holds a Stage, written by moveIn.
            const stage = mission.stage as Stage
            const wrong = feedbackRefusal({ stage, round: mission.round }, body)
            if (wrong !== null) return yield* refuse(wrong)
            yield* imagesChecked(original.missionId, images)
            const id = crypto.randomUUID()
            const written: Written = {
              missionId: original.missionId,
              author: by,
              kind: kindOf(original),
              body,
              images,
              code: null,
              item: null,
              followsUp: original.id,
              source: null,
              copied: original,
            }
            yield* provided(
              mutate('following up a feedback', (transaction) =>
                Effect.map(
                  writeIn(transaction, id, written, 'review.feedback_followed_up'),
                  (added) => ({ result: undefined, events: added }),
                ),
              ),
            )
            return yield* oneView(id)
          }),
        imageAdd: (missionId, name, bytes) =>
          Effect.gen(function* () {
            yield* missionRow(missionId)
            // A8 refuses what is no image it takes; a text it would keep as text is no image here.
            if (sniffImage(bytes) === null) {
              return yield* new ImageRefused({
                reason: 'this file is not a png, jpeg or webp image',
              })
            }
            const item = yield* evidence
              .put({
                missionId,
                content: { bytes },
                name,
                about: 'feedback image',
                author: UserAuthor.make({}),
              })
              .pipe(
                Effect.catchTag('EvidenceRefused', (refused) =>
                  Effect.fail(new ImageRefused({ reason: refused.reason })),
                ),
                Effect.catchTag('UnknownMission', (unknown) => Effect.fail(unknown)),
                Effect.mapError((failure) =>
                  Predicate.isTagged(failure, 'ImageRefused') ||
                  Predicate.isTagged(failure, 'UnknownMission')
                    ? failure
                    : refusedWhile('keeping an image')(failure),
                ),
              )
            const pixels = imagePixels(bytes)
            yield* provided(
              mutate('keeping an image', () =>
                Effect.succeed({
                  result: undefined,
                  events: [
                    reviewEvent(
                      missionId,
                      'review.image_added',
                      { evidenceId: item.id, name: item.name, sha256: item.sha256 },
                      USER,
                    ),
                  ],
                }),
              ),
            )
            const added: ImageAdded = {
              evidenceId: item.id,
              sha256: item.sha256,
              size: item.size,
              width: pixels?.width ?? null,
              height: pixels?.height ?? null,
            }
            return added
          }),
        commentedVersion: (feedbackId) =>
          Effect.gen(function* () {
            const row = yield* feedbackRow(feedbackId)
            if (row.anchorKind !== 'code')
              return yield* refuse('This feedback is not a comment on the code.')
            const bytes = yield* contentOf(row.anchorSha256)
            const version: CommentedVersion = {
              feedbackId,
              repository: row.anchorRepository ?? '',
              path: row.anchorPath ?? '',
              tree: row.anchorTree ?? '',
              excerpt: excerptFor(row, bytes),
              content: sideViewOf(
                { sha256: row.anchorSha256, size: row.anchorSize, withheld: row.anchorWithheld },
                bytes,
              ),
            }
            return version
          }),
        changes: (missionId) =>
          Stream.unwrap(
            Effect.gen(function* () {
              yield* missionRow(missionId)
              const committed = yield* events.subscribe
              const bump = Effect.sync(() => {
                const sequence = (sequences.get(missionId) ?? 0) + 1
                sequences.set(missionId, sequence)
                return { missionId, sequence }
              })
              const reasons = Stream.mergeAll(
                [
                  committed.pipe(
                    Stream.filter(
                      (event) =>
                        event.entityId === missionId &&
                        (event.type.startsWith('review.') || event.type === 'mission.moved'),
                    ),
                    Stream.as(missionId),
                  ),
                  diffs.changes(missionId).pipe(
                    Stream.as(missionId),
                    Stream.catch(() => Stream.empty),
                  ),
                  outside.changes.pipe(Stream.filter((id) => id === missionId)),
                ],
                { concurrency: 'unbounded' },
              )
              return Stream.concat(
                Stream.succeed({ missionId, sequence: sequences.get(missionId) ?? 0 }),
                reasons.pipe(Stream.mapEffect(() => bump)),
              )
            }),
          ),
        moveRound: (missionId, number, to) =>
          provided(
            mutate('moving a round', (transaction) =>
              Effect.gen(function* () {
                const rounds = yield* roundsIn(transaction, missionId)
                const round = rounds.find((one) => one.number === number)
                if (round === undefined)
                  return yield* refuse(`There is no round ${String(number)}.`)
                const from = roundStateOf(round.state)
                const wrong = roundMoveRefusal(number, from, to)
                if (wrong !== null) return yield* refuse(wrong)
                const closing: NewEvent[] = []
                if (to === 'grilling') {
                  for (const other of rounds) {
                    if (other.number === number) continue
                    if (other.state === 'answered') {
                      // The next round's Fix closes the answered one (open question 35).
                      closing.push(
                        yield* setRound(transaction, missionId, other.number, 'answered', 'closed'),
                      )
                    } else if (RUNNING_ROUND_STATES.some((running) => running === other.state)) {
                      return yield* refuse(
                        `round ${String(other.number)} is ${other.state}: round ${String(number)} waits for it to be answered`,
                      )
                    }
                  }
                  yield* transaction
                    .update(reviewFeedback)
                    .set({ state: 'in_round', updatedAt: now() })
                    .where(
                      and(
                        eq(reviewFeedback.missionId, missionId),
                        eq(reviewFeedback.round, number),
                        eq(reviewFeedback.state, 'waiting'),
                      ),
                    )
                    .pipe(Effect.mapError(refusedWhile('moving a round')))
                }
                const moved = yield* setRound(transaction, missionId, number, from, to)
                // Answered with every feedback already settled: it closes now (open question 35).
                const settled =
                  to === 'answered' ? yield* closedIfSettled(transaction, missionId, number) : []
                return { result: undefined, events: [...closing, moved, ...settled] }
              }),
            ),
          ),
        answer: (feedbackId, text) =>
          provided(
            mutate('answering a feedback', (transaction) =>
              Effect.gen(function* () {
                const [row] = yield* transaction
                  .select()
                  .from(reviewFeedback)
                  .where(eq(reviewFeedback.id, feedbackId))
                  .pipe(Effect.mapError(refusedWhile('answering a feedback')))
                if (row === undefined) return yield* new UnknownFeedback({ id: feedbackId })
                if (row.state !== 'in_round') {
                  return yield* refuse(
                    `This feedback is ${STATE_WORDS[stateOf(row)]}: only one in a round is answered.`,
                  )
                }
                const answer = secrets.mask(text.trim())
                yield* transaction
                  .update(reviewFeedback)
                  .set({ state: 'addressed', answer, updatedAt: now() })
                  .where(eq(reviewFeedback.id, feedbackId))
                  .pipe(Effect.mapError(refusedWhile('answering a feedback')))
                return {
                  result: undefined,
                  events: [
                    reviewEvent(
                      row.missionId,
                      'review.feedback_answered',
                      { ...feedbackPayload(row), answer },
                      null,
                    ),
                  ],
                }
              }),
            ),
          ),
        blocks: (feedbackIds, images) =>
          Effect.gen(function* () {
            const blocks: PromptBlock[] = []
            for (const feedbackId of feedbackIds) {
              const row = yield* feedbackRow(feedbackId)
              const view = yield* oneView(feedbackId)
              const mission = yield* missionRow(row.missionId).pipe(Effect.orDie)
              const folder = join(
                missionFolder(home.dataFolder, missionKey(mission.prefix, mission.number)),
                'evidence',
              )
              let where = ''
              if (row.anchorKind === 'code')
                where = ` on ${placeOf(row.anchorRepository, row.anchorPath)}${rangeSaid(row.anchorStart, row.anchorEnd)}`
              if (row.anchorKind === 'spec') where = ` on ${row.anchorItem ?? ''}`
              const paths = images
                ? []
                : view.images.map(
                    (one) =>
                      `Image: ${join(folder, `${one.sha256}.${evidenceExtension(one.mediaType)}`)}`,
                  )
              blocks.push(
                TextBlock.make({
                  text: [
                    `A ${view.kind} of round ${String(view.round)}${where}:`,
                    view.body,
                    ...paths,
                  ].join('\n'),
                }),
              )
              if (!images) continue
              for (const image of view.images) {
                const file = yield* evidence
                  .read(row.missionId, image.evidenceId)
                  .pipe(
                    Effect.mapError((failure) => new FeedbackRefused({ reason: failure.message })),
                  )
                blocks.push(
                  ImageBlock.make({
                    mimeType: image.mediaType,
                    data: Buffer.from(file.bytes).toString('base64'),
                  }),
                )
              }
            }
            return blocks
          }),
        follow: (stream) =>
          Effect.gen(function* () {
            yield* catchUp.pipe(
              Effect.catchCause((cause) =>
                said(`what a stop left was not caught up: ${String(cause)}`),
              ),
            )
            yield* Stream.runForEach(stream, (event) =>
              handle(event).pipe(
                Effect.catchCause((cause) =>
                  said(`${event.type} was not followed: ${String(cause)}`),
                ),
              ),
            )
          }),
      }

      // --- what Review follows --------------------------------------------------------------

      /**
       * The Review checkpoint of a round, unless it is recorded: the current one while the mission
       * is in Review (`round` null), or the round a move out of Review just left.
       */
      const recordCheckpoint = (missionId: string, left: number | null = null) =>
        Effect.gen(function* () {
          const mission = yield* missionRow(missionId)
          if (left === null && mission.stage !== 'review') return
          const round = left ?? mission.round
          const [kept] = yield* database
            .select()
            .from(reviewCheckpoints)
            .where(
              and(eq(reviewCheckpoints.missionId, missionId), eq(reviewCheckpoints.round, round)),
            )
          if (kept !== undefined) return
          const places = yield* diffs.places(missionId)
          if (places === null) {
            return yield* refuse(`${missionId} is in Review without a Workspace: no checkpoint`)
          }
          yield* hold('checkpoint')
          const checkpointId = yield* checkpointsService.take(
            missionId,
            round === 0 ? 'review_entry' : 'round_end',
            places,
          )
          yield* provided(
            mutate('recording a Review checkpoint', (transaction) =>
              Effect.gen(function* () {
                const written = yield* transaction
                  .insert(reviewCheckpoints)
                  .values({ missionId, round, checkpointId })
                  .onConflictDoNothing()
                  .returning({ round: reviewCheckpoints.round })
                  .pipe(Effect.mapError(refusedWhile('recording a Review checkpoint')))
                return {
                  result: undefined,
                  events:
                    written.length === 0
                      ? []
                      : [
                          reviewEvent(
                            missionId,
                            'review.checkpoint_recorded',
                            { round, checkpointId },
                            null,
                          ),
                        ],
                }
              }),
            ),
          )
        }).pipe(Semaphore.withPermits(turnOf(missionId), 1))

      /** A refused manual proof (B6) as a remark of the collecting round, once per refusal. */
      const proofRemark = (event: DomainEvent) =>
        Effect.gen(function* () {
          const source = `proof:${String(event.sequence)}`
          const [written] = yield* database
            .select({ id: reviewFeedback.id })
            .from(reviewFeedback)
            .where(eq(reviewFeedback.source, source))
          if (written !== undefined) return
          const mission = yield* missionRow(event.entityId)
          if (mission.stage === 'done' || mission.stage === 'cancelled') return
          yield* hold('proof')
          const scenario = String(event.payload.scenario ?? '')
          const note = String(event.payload.note ?? '').trim()
          const id = crypto.randomUUID()
          yield* provided(
            mutate('writing a refused proof as a remark', (transaction) =>
              Effect.gen(function* () {
                const [again] = yield* transaction
                  .select({ id: reviewFeedback.id })
                  .from(reviewFeedback)
                  .where(eq(reviewFeedback.source, source))
                  .pipe(Effect.mapError(refusedWhile('writing a refused proof')))
                if (again !== undefined) return { result: undefined, events: [] }
                const added = yield* writeIn(
                  transaction,
                  id,
                  {
                    missionId: event.entityId,
                    author: USER,
                    kind: 'remark',
                    body: note === '' ? `${scenario} was refused when verified by hand.` : note,
                    images: [],
                    code: null,
                    item: scenario === '' ? null : scenario,
                    followsUp: null,
                    source,
                    copied: null,
                  },
                  'review.feedback_added',
                )
                return { result: undefined, events: added }
              }),
            ),
          )
        }).pipe(Semaphore.withPermits(turnOf(event.entityId), 1))

      /** Every round not closed, closed: at Ship. */
      const closeAll = (missionId: string) =>
        provided(
          mutate('closing the rounds at Ship', (transaction) =>
            Effect.gen(function* () {
              const rounds = yield* roundsIn(transaction, missionId)
              const closed: NewEvent[] = []
              for (const round of rounds) {
                if (round.state !== 'closed')
                  closed.push(
                    yield* setRound(transaction, missionId, round.number, round.state, 'closed'),
                  )
              }
              return { result: undefined, events: closed }
            }),
          ),
        )

      const handle = (event: DomainEvent) =>
        Effect.gen(function* () {
          if (event.type === 'proof.manual_refused') return yield* proofRemark(event)
          if (event.type !== 'mission.moved') return
          if (event.payload.to === 'review') {
            // Tried again, apart, while the mission stays in Review; the move out takes it at last.
            yield* recordCheckpoint(event.entityId).pipe(
              Effect.tapError((failure) =>
                said(`the checkpoint of ${event.entityId} failed, tried again: ${failure.message}`),
              ),
              Effect.retry({
                schedule: Schedule.exponential(CHECKPOINT_RETRY),
                times: CHECKPOINT_TRIES,
              }),
              Effect.catchCause((cause) =>
                said(`the checkpoint of ${event.entityId} was not taken: ${String(cause)}`),
              ),
              Effect.forkIn(scope),
            )
            return
          }
          if (event.payload.from === 'review') {
            // Never out of Review without the archive of the round it leaves.
            const round = Option.getOrElse(readRound(event.payload.round), () => 0)
            yield* recordCheckpoint(
              event.entityId,
              event.payload.move === 'fix' ? round - 1 : round,
            )
          }
          if (event.payload.move === 'ship') return yield* closeAll(event.entityId)
        })

      /** What a stop left: a mission in Review without its round's checkpoint, a refusal unwritten. */
      const catchUp = Effect.gen(function* () {
        const reviewing = yield* database
          .select({ id: missions.id })
          .from(missions)
          .where(eq(missions.stage, 'review'))
        for (const one of reviewing) {
          yield* recordCheckpoint(one.id).pipe(
            Effect.catchCause((cause) =>
              said(`the checkpoint of ${one.id} was not taken: ${String(cause)}`),
            ),
          )
        }
        // Shipped or over, its rounds still open: Ship's closing was cut by a stop.
        const shipped = yield* database
          .selectDistinct({ id: reviewRounds.missionId })
          .from(reviewRounds)
          .innerJoin(missions, eq(missions.id, reviewRounds.missionId))
          .where(
            and(ne(reviewRounds.state, 'closed'), inArray(missions.stage, ['shipping', 'done'])),
          )
        for (const one of shipped) {
          yield* closeAll(one.id).pipe(
            Effect.catchCause((cause) =>
              said(`the rounds of ${one.id} were not closed: ${String(cause)}`),
            ),
          )
        }
        const refusals = yield* database
          .select()
          .from(domainEvents)
          .where(eq(domainEvents.type, 'proof.manual_refused'))
          .orderBy(asc(domainEvents.sequence))
        for (const event of refusals.map(eventOf)) {
          yield* proofRemark(event).pipe(
            Effect.catchCause((cause) => said(`a refused proof was not written: ${String(cause)}`)),
          )
        }
      })

      return service
    }),
  )
