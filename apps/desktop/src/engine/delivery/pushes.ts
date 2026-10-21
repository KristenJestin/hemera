/**
 * The pushes and pull requests of a mission (R6): the preparation's actions, run by Hemera from the
 * rules the user saved, never by an agent.
 *
 * - **When.** As the mission enters Review, and each time it comes back from "Building · round N",
 *   every repository of the Workspace with changes (since its base, or since its last push) whose
 *   preparation stack pushes or opens a pull request runs that stack, in its order. A stack with an
 *   action on a click waits, whole, for one decision need on the mission (Push / Not now); "not now"
 *   leaves it unrun until the next return to Review. The first time it acts, the mission copies the
 *   preparation (CT-47), and every later push reads that copy.
 * - **At Ship** (R9): every repository whose stack pushes or opens a pull request and that changed
 *   since its last push, whatever the round, runs it once Ship froze the mission, in Shipping. Ship
 *   hands them over in the freeze's own transaction, so a stop between the two is pushed at the
 *   next start; Ship is the click, so none asks. A failure holds its need in Shipping. Nothing
 *   leaves but the tree Ship froze: a Workspace changed since stops the push with an error need.
 * - **Hemera commits** (`commit-by-hemera`): a checkpoint of the repository first (#140), what this
 *   push pushes; then the whole working tree is committed (untracked non-ignored files included)
 *   with the commit template, as the user's Git identity, which Hemera reads and never sets. The
 *   commit's tree must equal the checkpoint's, or the Workspace changed meanwhile: tried once more
 *   from a new checkpoint. Never an amend, never `--no-verify`. A file in a sensitive place (A5's
 *   list) the commit would add or change, untracked or staged, stops it first with a decision
 *   need: push it anyway, or keep it out (unstaged, never deleted).
 * - **The push** (`push`): `git push <remote> <commit>:refs/heads/<branch>` to the repository's
 *   delivery remote, the branch the Workspace recorded, never forced, through the engine's own Git
 *   in the user's environment (the agents' is the one where pushing is neutralised). No `-u`: the
 *   upstream is recorded here, so the repository's configuration is never written. A file in a
 *   sensitive place that any commit the push publishes adds or changes (since the base, or what
 *   the remote holds) asks first too; kept out, it stops the push, since no history is rewritten.
 * - **The branch.** Nothing is committed unless the worktree's HEAD names the branch the
 *   Workspace recorded: an agent's `git symbolic-ref` stops the sequence with an error need.
 * - **The pull request** (`pull-request`): an open one from the branch into the base is found
 *   first, and is the mission's; otherwise one is opened from the templates and the reviewers. Its
 *   description is written once.
 * - **Intent and outcome** (CT-09). Each commit, push and create is an effectful action. A Retry, a
 *   restart, or a stop halfway checks each post-condition first (the commit's tree, the remote's
 *   branch, the open pull request) and does only what is not true, recording what it found of an
 *   intent left without outcome. A create whose outcome could not be read stays indeterminate,
 *   never done, until a find can say; it is never created again blind.
 * - **Failures** are an error need on the mission with Git's or the forge's message verbatim
 *   (masked) and Retry; one repository failing stops none of the others.
 * - **Images** (R7, `./images.ts`): where GitHub on github.com hosts them (gh 2.99.0 or later, an
 *   account that may push), `{images}` becomes Markdown images uploaded with the pull request
 *   (`--attach`, 50 at most per call, the rest by `gh pr edit`); anywhere else, a list of file
 *   names and why. A public repository asks first: the pull request opens with the list, and is
 *   edited once the user answers Publish; the answer is kept for the mission. The description is
 *   read back and each copy's URL recorded next to its evidence (CT-54); an image not found there
 *   is "not published" with the CLI's message, the step failed, and Retry sends only what is
 *   missing: an image whose URL is in the description is never sent again. Images added once the
 *   pull request is open are not added to it, since its description is written once.
 */

import { join } from 'node:path'
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'

import {
  DecisionFields,
  type DeliveryAction,
  EnvironmentFields,
  ErrorFields,
  IMAGES_SLOT,
  MissionOwner,
  NeedFields,
  type PreparationCopy,
  type TemplateFields,
  buildingBranchName,
  renderTemplate,
  sensitivePlace,
} from '@hemera/core/domain'
import {
  type DeliveryRulesUnreadable,
  type Mission,
  type MissionPushes,
  NotPublishable,
  NothingToRetry,
  type Project,
  PullRequestStatus,
  type PushImage,
  type PushState,
  type RepositoryPush,
  UnknownEvidence,
  UnknownMission,
} from '@hemera/ipc'
import { and, asc, desc, eq, inArray, isNotNull, ne, or } from 'drizzle-orm'
import {
  Context,
  Deferred,
  Effect,
  Fiber,
  Layer,
  Option,
  Predicate,
  Result,
  Schema,
  Semaphore,
  Stream,
} from 'effect'

import type { Log } from '../../main/diagnostic.ts'
import { Checkpoints } from '../building/checkpoints.ts'
import { readTrees } from '../building/proof-store.ts'
import { copySection, missionCopies } from '../delivery-rules.ts'
import { DomainEvents } from '../domain-events.ts'
import { ForgePort } from '../forges/port.ts'
import {
  attachToPullRequest,
  createPullRequest,
  findPullRequest,
  pullRequestBody,
  pullRequestStatus,
  repositoryAccess,
} from '../forges/pull-requests.ts'
import { GITHUB_HOST } from '../forges/identity.ts'
import type { GitBytesSpawn, GitRefusal } from '../git.ts'
import type { DomainEvent, NewEvent } from '../journal.ts'
import { missionFolder, missionKeyOf } from '../memory/files.ts'
import { type MissionActivity, getMission } from '../missions.ts'
import {
  DeliveryFailed,
  type NeedHandler,
  createNeedIn,
  needService,
  withdrawNeed,
} from '../needs.ts'
import { ProfileHome } from '../profile-home.ts'
import { getProject } from '../projects.ts'
import { Diffs, type Place } from '../review/diffs.ts'
import { Secrets } from '../secrets.ts'
import {
  Database,
  type DatabaseError,
  type EngineTransaction,
  refusedWhile,
} from '../storage/database.ts'
import {
  buildings,
  checkpointRepositories,
  deliveryImages,
  deliveryPushes,
  effectfulActions,
  memoryEvidence,
  missionShips,
  missions,
  needs,
} from '../storage/schema.ts'
import { beginAction, settleActionIn } from '../tools/actions.ts'
import { mutate } from '../transaction.ts'
import {
  ATTACH_AT_ONCE,
  type ChosenImage,
  IMAGE_TYPES,
  chosenImages,
  copyIn,
  imageLines,
  nameList,
  unreadable,
} from './images.ts'

/** The service the pushes' needs belong to. */
export const DELIVERY_NEEDS = needService('delivery')

/**
 * Where a suite holds a repository's sequence: after an intent, after its outcome; and, with no
 * repository, once what a stop left is caught up.
 */
export type PushMoment =
  | 'committing'
  | 'committed'
  | 'pushing'
  | 'pushed'
  | 'creating'
  | 'opened'
  | 'caught-up'

export type PushesHold = (at: PushMoment, repository: string) => Effect.Effect<void>

export type PushesFailure = UnknownMission | DeliveryRulesUnreadable | DatabaseError

export interface PushesService {
  /** Per repository of the mission: its last push, its pull request and where its step stands. */
  readonly pushes: (missionId: string) => Effect.Effect<MissionPushes, PushesFailure>
  /** Runs a failed or indeterminate repository again, doing only what is not already true. */
  readonly retry: (
    missionId: string,
    repository: string,
  ) => Effect.Effect<MissionPushes, PushesFailure | NothingToRetry>
  /** The mission's pushes now, then after each change. */
  readonly changes: (missionId: string) => Stream.Stream<MissionPushes, PushesFailure>
  /** The user's mark on an image of a mission's evidence: sent in its pull requests, or not (R7). */
  readonly setPublishable: (
    evidenceId: string,
    publishable: boolean,
  ) => Effect.Effect<void, UnknownEvidence | NotPublishable | DatabaseError>
  /** What a stop left, then each committed event of the stream, for as long as it lasts. */
  readonly follow: (events: Stream.Stream<DomainEvent>) => Effect.Effect<void>
  /**
   * Ship's push (R9): the repositories whose preparation pushes or opens a pull request and that
   * changed since their last push (or their base), read now, before Ship freezes the mission.
   */
  readonly atShip: (missionId: string) => Effect.Effect<ShipPush, PushesFailure>
}

/** What Ship hands to the pushes, and how it pushes it. */
export interface ShipPush {
  /**
   * Within the transaction that freezes the mission: each repository running, so a stop between
   * the freeze and the push leaves it for the next start to push. Ship is the click: none asks.
   */
  readonly handIn: (transaction: EngineTransaction) => Effect.Effect<void, DatabaseError>
  /**
   * Once the freeze is committed: each repository's sequence, ended when every one has ended,
   * stopped, or waits for a forge CLI that is not ready; those go on in the pushes' scope.
   */
  readonly push: Effect.Effect<void>
}

export class Pushes extends Context.Service<Pushes, PushesService>()('Pushes') {}

export interface PushesSettings {
  readonly log: Log
  /** The pushes' Git: the machine's, in the user's own environment. */
  readonly git: GitBytesSpawn
  readonly hold?: PushesHold | undefined
}

/** The answers the needs offer. */
const PUSH = 'Push'
const NOT_NOW = 'Not now'
const RETRY = 'Retry'
/** A path Git reads as written, never as a pattern. */
const literal = (path: string) => `:(literal)${path}`

const PUSH_ANYWAY = 'Push them anyway'
const KEEP_OUT = 'Keep them out'

/** The answers of a public repository's question on images (R7). */
const PUBLISH = 'Publish'
const LIST_NAMES = 'List the file names instead'
/**
 * Where a public repository's question stands on a row: `ask` asked and unanswered (asked again
 * when the need was let go), `publish`, or `list`.
 */
type ImagesAnswer = 'ask' | 'publish' | 'list'

/** The line a missing identity's need shows: Hemera never sets it. */
const IDENTITY_FIX: Readonly<Record<IdentityKey, string>> = {
  'user.name': 'git config --global user.name "Your Name"',
  'user.email': 'git config --global user.email "you@example.com"',
}
type IdentityKey = 'user.name' | 'user.email'

type Row = typeof deliveryPushes.$inferSelect

/** Where a row stands. `waiting` waits on a need of the user's. */
type RowState = 'waiting' | 'running' | 'done' | 'failed' | 'indeterminate' | 'declined'

/** A step that did not end done: how the row stands, why, and the need it puts to the user. */
class PushStopped extends Schema.TaggedError<PushStopped>()('PushStopped', {
  state: Schema.Literals(['waiting', 'failed', 'indeterminate']),
  message: Schema.String,
  need: Schema.NullOr(NeedFields),
}) {}

const stopped = (state: PushStopped['state'], message: string, need: PushStopped['need'] = null) =>
  new PushStopped({ state, message, need })

/** What the pushes' events carry. */
const pushEvent = (
  missionId: string,
  type: string,
  payload: Record<string, string | number | null>,
): NewEvent => ({
  type,
  entityKind: 'mission',
  entityId: missionId,
  source: 'system',
  author: 'hemera',
  payload,
})

const readStrings = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Array(Schema.String)))
const readStatus = Schema.decodeUnknownOption(Schema.fromJsonString(PullRequestStatus))
const writeStatus = Schema.encodeSync(Schema.fromJsonString(PullRequestStatus))
const ActionDetails = Schema.fromJsonString(Schema.Struct({ repository: Schema.String }))
const readDetails = Schema.decodeUnknownOption(ActionDetails)

const readMissionId = (payload: DomainEvent['payload']) =>
  Option.map(
    Schema.decodeUnknownOption(Schema.Struct({ missionId: Schema.String }))(payload),
    (read) => read.missionId,
  )

const now = () => new Date().toISOString()

/** The words of a step's kind, as a sentence names it. */
const STEP_WORDS = new Map([
  ['commit-by-hemera', 'commit'],
  ['push', 'push'],
  ['pull-request', 'pull request'],
])

/** Where an image of a pull request may stand, as recorded. */
const IMAGE_STATES: ReadonlyArray<PushImage['state']> = [
  'pending',
  'published',
  'listed',
  'not-published',
]

/** Whether a stack pushes or opens a pull request: what this ticket runs it for. */
const delivers = (steps: ReadonlyArray<DeliveryAction>) =>
  steps.some((step) => step.kind === 'push' || step.kind === 'pull-request')

/** Whether a mission's stage runs its pushes: Review's, and in Shipping, Ship's own push (R9). */
const pushing = (stage: Mission['stage']) => stage === 'review' || stage === 'shipping'

/** The repositories' names, as a sentence lists them. */
const listed = (names: ReadonlyArray<string>) => names.join(', ')

export const pushesLayer = (settings: PushesSettings) => {
  let deliver: NeedHandler['deliver'] | null = null
  let recheck: NonNullable<NeedHandler['recheck']> | null = null
  const handler: NeedHandler = {
    deliver: (need, transaction) =>
      deliver === null
        ? Effect.fail(new DeliveryFailed({ reason: 'the pushes are not running yet' }))
        : deliver(need, transaction),
    recheck: (need, retried) => (recheck === null ? Effect.succeed(true) : recheck(need, retried)),
  }
  const layer = Layer.effect(
    Pushes,
    Effect.gen(function* () {
      const database = yield* Database
      const events = yield* DomainEvents
      const secrets = yield* Secrets
      const diffs = yield* Diffs
      const checkpoints = yield* Checkpoints
      const home = yield* ProfileHome
      const context = yield* Effect.context<
        | Database
        | DomainEvents
        | Secrets
        | ForgePort
        | Diffs
        | Checkpoints
        | MissionActivity
        | ProfileHome
      >()
      const provided = <A, E>(
        effect: Effect.Effect<
          A,
          E,
          | Database
          | DomainEvents
          | Secrets
          | ForgePort
          | Diffs
          | Checkpoints
          | MissionActivity
          | ProfileHome
        >,
      ) => Effect.provide(effect, context)
      const scope = yield* Effect.scope
      const said = (line: string) => Effect.sync(() => settings.log(`pushes: ${line}`))
      const hold = (at: PushMoment, repository: string) =>
        settings.hold?.(at, repository) ?? Effect.void
      const turns = new Map<string, Semaphore.Semaphore>()
      const turnOf = (key: string) => {
        const found = turns.get(key) ?? Semaphore.makeUnsafe(1)
        turns.set(key, found)
        return found
      }

      // --- Git ------------------------------------------------------------------------------

      const git = (folder: string, args: ReadonlyArray<string>, kind: 'read' | 'work' = 'read') =>
        settings.git(folder, args, kind).pipe(Effect.map((printed) => printed.toString('utf8')))
      const gitIn = (
        folder: string,
        args: ReadonlyArray<string>,
        env: Readonly<Record<string, string>>,
      ) =>
        settings
          .git(folder, args, 'work', { env })
          .pipe(Effect.map((printed) => printed.toString('utf8').trim()))
      /** Git's own words for a refusal, masked by the spawn. */
      const gitSaid = (refusal: GitRefusal) =>
        Predicate.isTagged(refusal, 'GitFailed') && refusal.stderr.trim() !== ''
          ? refusal.stderr.trim()
          : refusal.message
      const failedWith = (what: string) => (refusal: GitRefusal) =>
        stopped('failed', gitSaid(refusal), errorNeed(what, [{ what, output: gitSaid(refusal) }]))

      const headOf = (folder: string) =>
        Effect.map(git(folder, ['rev-parse', '--verify', '--quiet', 'HEAD']), (out) => out.trim())
      const treeOf = (folder: string) =>
        git(folder, ['rev-parse', '--verify', '--quiet', 'HEAD^{tree}']).pipe(
          Effect.map((out) => out.trim()),
          Effect.orElseSucceed(() => ''),
        )
      /** What `git config` resolves for that worktree, or null when nothing is set. */
      const configOf = (folder: string, key: IdentityKey) =>
        git(folder, ['config', '--get', key]).pipe(
          Effect.map((out) => out.trim()),
          Effect.map((value) => (value === '' ? null : value)),
          Effect.orElseSucceed(() => null),
        )
      /** The paths `git status` names: changed, staged, or untracked. */
      const changedPathsOf = (folder: string) =>
        Effect.map(git(folder, ['status', '--porcelain', '-z', '--untracked-files=all']), (out) =>
          out
            .split('\0')
            .filter((field) => field !== '')
            .map((field) => (/^[ MADRCU?!]{2} /.test(field) ? field.slice(3) : field)),
        )
      const dirtyOf = (folder: string) =>
        Effect.map(
          git(folder, ['status', '--porcelain', '-z', '--untracked-files=all']),
          (out) => out !== '',
        )
      const pathsOf = (folder: string, args: ReadonlyArray<string>) =>
        Effect.map(git(folder, args), (out) => out.split('\0').filter((path) => path !== ''))
      /**
       * What a commit of everything would add or change against HEAD: untracked, staged, or
       * changed in the working tree; never what it deletes.
       */
      const committablePathsOf = (folder: string) =>
        Effect.gen(function* () {
          const untracked = yield* pathsOf(folder, [
            'ls-files',
            '--others',
            '--exclude-standard',
            '-z',
          ])
          const tracked = yield* pathsOf(folder, [
            'diff',
            '--name-only',
            '-z',
            '--no-renames',
            '--diff-filter=d',
            'HEAD',
          ])
          return [...new Set([...tracked, ...untracked])]
        })
      /**
       * What each commit a push of `head` would publish adds or changes: every commit reachable
       * from it and neither from the Workspace's base nor from what the remote's branch already
       * holds, never their net diff (a file committed then deleted is in the history all the
       * same). A merge counts for what it changes against all of its parents (`-c`).
       */
      const publishedPathsOf = (
        folder: string,
        base: string | null,
        there: string | null,
        head: string,
      ) =>
        Effect.gen(function* () {
          if (base === null) return []
          // The remote's commit, when someone else pushed it, may not be here to stop at.
          const known =
            there === null
              ? false
              : yield* git(folder, ['cat-file', '-e', `${there}^{commit}`]).pipe(
                  Effect.as(true),
                  Effect.orElseSucceed(() => false),
                )
          const paths = yield* pathsOf(folder, [
            'log',
            '--name-only',
            '-z',
            '--no-renames',
            '--diff-filter=d',
            '-c',
            '--format=',
            head,
            '--not',
            base,
            ...(known && there !== null ? [there] : []),
          ])
          return [...new Set(paths)]
        })
      /** The commit `refs/heads/<branch>` is at on the push URL of `remote`, or null. */
      const remoteHeadOf = (folder: string, remote: string, branch: string) =>
        Effect.gen(function* () {
          const url = (yield* git(folder, ['remote', 'get-url', '--push', remote])).trim()
          const printed = yield* git(folder, [
            'ls-remote',
            '--end-of-options',
            url,
            `refs/heads/${branch}`,
          ])
          const [line] = printed.split('\n').filter((one) => one.trim() !== '')
          return line === undefined ? null : (line.split('\t')[0] ?? null)
        })
      /**
       * The tree of the working tree as a commit of everything would have it, and the same less
       * `kept`, in one read of the disk: a copy of the worktree's index, never the user's own.
       */
      const treesWithout = (folder: string, kept: ReadonlyArray<string>) =>
        Effect.acquireUseRelease(
          Effect.sync(() => mkdtempSync(join(tmpdir(), 'hemera-push-'))),
          (scratch) =>
            Effect.gen(function* () {
              const index = (yield* git(folder, [
                'rev-parse',
                '--path-format=absolute',
                '--git-path',
                'index',
              ])).trim()
              const copy = join(scratch, 'index')
              if (existsSync(index)) copyFileSync(index, copy)
              const env = { GIT_INDEX_FILE: copy }
              yield* gitIn(folder, ['add', '--all'], env)
              const whole = yield* gitIn(folder, ['write-tree'], env)
              if (kept.length === 0) return { whole, kept: whole }
              yield* gitIn(folder, ['reset', '--quiet', 'HEAD', '--', ...kept.map(literal)], env)
              return { whole, kept: yield* gitIn(folder, ['write-tree'], env) }
            }),
          (scratch) => Effect.sync(() => rmSync(scratch, { recursive: true, force: true })),
        )

      // --- rows -----------------------------------------------------------------------------

      const rowsOf = (missionId: string) =>
        database
          .select()
          .from(deliveryPushes)
          .where(eq(deliveryPushes.missionId, missionId))
          .pipe(Effect.mapError(refusedWhile('reading the pushes')))
      const rowOf = (missionId: string, repositoryId: string) =>
        database
          .select()
          .from(deliveryPushes)
          .where(
            and(
              eq(deliveryPushes.missionId, missionId),
              eq(deliveryPushes.repositoryId, repositoryId),
            ),
          )
          .pipe(
            Effect.mapError(refusedWhile('reading a push')),
            Effect.map(([row]) => row ?? null),
          )
      const setIn = (
        transaction: EngineTransaction,
        row: Pick<Row, 'missionId' | 'repositoryId'>,
        set: Partial<Row>,
      ) =>
        transaction
          .update(deliveryPushes)
          .set({ ...set, updatedAt: now() })
          .where(
            and(
              eq(deliveryPushes.missionId, row.missionId),
              eq(deliveryPushes.repositoryId, row.repositoryId),
            ),
          )
          .pipe(Effect.mapError(refusedWhile('writing a push')), Effect.asVoid)
      const setRow = (
        row: Pick<Row, 'missionId' | 'repositoryId'>,
        set: Partial<Row>,
        written: ReadonlyArray<NewEvent> = [],
      ) =>
        provided(
          mutate('writing a push', (transaction) =>
            Effect.map(setIn(transaction, row, set), () => ({
              result: undefined,
              events: written,
            })),
          ),
        )

      // --- effectful actions ------------------------------------------------------------------

      const owner = (missionId: string) => ({
        kind: 'mission' as const,
        missionId,
        taskId: null,
      })
      /** The actions of a kind a stop left for this repository without an outcome. */
      const leftOf = (missionId: string, kind: string, repository: string) =>
        Effect.map(
          database
            .select()
            .from(effectfulActions)
            .where(
              and(
                eq(effectfulActions.ownerId, missionId),
                eq(effectfulActions.kind, kind),
                inArray(effectfulActions.state, ['started', 'indeterminate']),
              ),
            )
            .pipe(Effect.mapError(refusedWhile('reading the actions left'))),
          (rows) =>
            rows
              .filter((row) =>
                Option.match(readDetails(row.details), {
                  onNone: () => false,
                  onSome: (details) => details.repository === repository,
                }),
              )
              .map((row) => row.id),
        )
      /** What each action left without an outcome was found to be, recorded. */
      const settleLeft = (
        missionId: string,
        kind: string,
        repository: string,
        found: 'done' | 'failed',
      ) =>
        Effect.gen(function* () {
          const left = yield* leftOf(missionId, kind, repository)
          if (left.length === 0) return
          yield* provided(
            mutate('recording what an action left was found to be', (transaction) =>
              Effect.map(
                Effect.forEach(left, (id) =>
                  settleActionIn(
                    transaction,
                    id,
                    found,
                    secrets.mask(`found ${found} on checking`),
                  ),
                ),
                (written) => ({ result: undefined, events: written.flat() }),
              ),
            ),
          )
        })
      /** An action's outcome, with what the row records and the events it says. */
      const settle = (
        id: string,
        state: 'done' | 'failed' | 'indeterminate',
        outcome: string,
        row: Pick<Row, 'missionId' | 'repositoryId'>,
        set: Partial<Row> = {},
        written: ReadonlyArray<NewEvent> = [],
      ) =>
        provided(
          mutate('recording the outcome of a push step', (transaction) =>
            Effect.gen(function* () {
              const settled = yield* settleActionIn(transaction, id, state, secrets.mask(outcome))
              yield* setIn(transaction, row, set)
              return { result: undefined, events: [...settled, ...written] }
            }),
          ),
        )
      const begin = (missionId: string, kind: string, details: Schema.JsonObject) =>
        provided(beginAction(kind, owner(missionId), details))

      // --- what the templates are rendered with ------------------------------------------------

      const valuesOf = (mission: Mission, branch: string) =>
        Effect.gen(function* () {
          const [building] = yield* database
            .select({ summary: buildings.summary })
            .from(buildings)
            .where(eq(buildings.missionId, mission.id))
            .orderBy(desc(buildings.startedAt))
            .limit(1)
            .pipe(Effect.mapError(refusedWhile('reading the Builder’s summary')))
          // Masked as everything the forge is sent.
          const images = yield* provided(chosenImages(mission.id, secrets.mask))
          const values: TemplateFields = {
            key: mission.key,
            title: mission.title,
            slug: buildingBranchName(mission.key, mission.title),
            branch,
            summary: building?.summary ?? '',
          }
          // `{images}` is the chosen images' names unless told what the forge shows of them.
          return {
            images,
            render: (template: string, shown: string = nameList(images)) =>
              renderTemplate(template, values).text.replaceAll(IMAGES_SLOT, shown),
          }
        })

      // --- needs ---------------------------------------------------------------------------------

      const errorNeed = (
        failed: string,
        attempts: ReadonlyArray<{ what: string; output: string }>,
      ) => ErrorFields.make({ failed, attempts, proposals: [RETRY] })

      // --- one repository's sequence ------------------------------------------------------------

      /** What a repository's sequence stands on. */
      interface Run {
        readonly mission: Mission
        readonly project: Project
        readonly place: Place
        readonly repositoryId: string
        readonly name: string
        readonly entry: PreparationCopy['repositories'][number]
        /** A template rendered, `{images}` as given (the images' names otherwise). */
        readonly render: (template: string, images?: string) => string
        /** The mission's images chosen for its pull requests (R7). */
        readonly images: ReadonlyArray<ChosenImage>
        readonly branch: string
        readonly remote: string | null
        readonly base: string
      }

      const reread = (one: Pick<Run, 'mission' | 'repositoryId'>) =>
        Effect.flatMap(rowOf(one.mission.id, one.repositoryId), (row) =>
          row === null
            ? Effect.fail(stopped('failed', 'The push was removed.'))
            : Effect.succeed(row),
        )

      /** Stops, committing and pushing nothing, unless the worktree's HEAD is the mission's branch. */
      const onBranch = (one: Run) =>
        Effect.gen(function* () {
          const ref = `refs/heads/${one.branch}`
          const named = (yield* git(one.place.folder, ['symbolic-ref', '--quiet', 'HEAD']).pipe(
            Effect.orElseSucceed(() => ''),
          )).trim()
          if (named === ref) return
          const until = 'Hemera commits and pushes nothing until it is back on it.'
          const output =
            named === ''
              ? `The HEAD of ${one.name} is detached, not on the mission’s branch ${one.branch}: ${until}`
              : `The HEAD of ${one.name} names ${named.replace(/^refs\/heads\//, '')}, not the mission’s branch ${one.branch}: ${until}`
          return yield* stopped(
            'failed',
            output,
            errorNeed(output, [{ what: 'git symbolic-ref HEAD', output }]),
          )
        })

      /**
       * Files in sensitive places this push would carry, asked once with a decision need: `fresh`
       * the commit would add, `committed` the branch already holds. Answers what to keep out of
       * the commit; kept out, a committed one stops the push, since no history is rewritten.
       */
      const screened = (one: Run, fresh: ReadonlyArray<string>, committed: ReadonlyArray<string>) =>
        Effect.gen(function* () {
          const sensitive = [...new Set([...fresh, ...committed])]
          if (sensitive.length === 0) return []
          const row = yield* reread(one)
          const answered = Option.getOrElse(
            readStrings(row.sensitive ?? ''),
            (): ReadonlyArray<string> => [],
          )
          if (row.sensitiveAnswer === null || sensitive.some((path) => !answered.includes(path))) {
            yield* setRow(row, { sensitive: JSON.stringify(sensitive), sensitiveAnswer: null })
            const held = [
              ...(fresh.length === 0 ? [] : [`files in sensitive places: ${fresh.join(', ')}`]),
              ...(committed.length === 0
                ? []
                : [
                    `files in sensitive places already committed on the branch: ${committed.join(', ')}`,
                  ]),
            ]
            return yield* stopped(
              'waiting',
              `Files in sensitive places: ${sensitive.join(', ')}.`,
              DecisionFields.make({
                question: `${one.name} holds ${held.join('; and ')}. Push them with the rest of the Workspace?`,
                options: [PUSH_ANYWAY, KEEP_OUT],
                recommended: {
                  option: KEEP_OUT,
                  reason: `Such a file often holds a secret. Kept out, it stays uncommitted and nothing is added to .gitignore.${committed.length === 0 ? '' : ' One already committed cannot be kept out: the push stops instead.'}`,
                },
              }),
            )
          }
          if (row.sensitiveAnswer === 'push') return []
          if (committed.length > 0) {
            // Asked again at the Retry, once the branch's commits are changed or the answer is.
            yield* setRow(row, { sensitiveAnswer: null })
            const output = `${committed.join(', ')} ${committed.length === 1 ? 'is' : 'are'} already committed on the branch: Hemera rewrites no history, so nothing is pushed. Take ${committed.length === 1 ? 'it' : 'them'} out of the branch’s commits, then Retry.`
            return yield* stopped(
              'failed',
              output,
              errorNeed(output, [{ what: 'git push', output }]),
            )
          }
          return fresh
        })

      /** The tree Ship froze for a repository of the mission; null before Ship (R9). */
      const frozenOf = (one: Run) =>
        database
          .select({ trees: missionShips.trees })
          .from(missionShips)
          .where(eq(missionShips.missionId, one.mission.id))
          .pipe(
            Effect.mapError(refusedWhile('reading the frozen trees')),
            Effect.map(
              ([shipped]) =>
                readTrees(shipped?.trees ?? null).find((tree) => tree.repository === one.name)
                  ?.tree ?? null,
            ),
          )

      /** Shipped, nothing leaves but the tree Ship froze: what moved since stops the push. */
      const changedAfterShip = (one: Run, what: string) => {
        const output = `The Workspace of ${one.name} changed after Ship froze it: nothing was pushed.`
        return stopped('failed', output, errorNeed(output, [{ what, output }]))
      }

      const commitStep = (one: Run) =>
        Effect.gen(function* () {
          const { folder } = one.place
          const missionId = one.mission.id
          yield* onBranch(one)
          for (const key of ['user.name', 'user.email'] as const) {
            if ((yield* configOf(folder, key)) === null) {
              return yield* stopped(
                'failed',
                `Git has no ${key} for ${one.name}: Hemera commits as you and never sets it.`,
                EnvironmentFields.make({
                  missing: `Git has no ${key} for ${one.name}: Hemera commits as you and never sets it.`,
                  action: IDENTITY_FIX[key],
                  settingsSection: null,
                }),
              )
            }
          }
          const row = yield* reread(one)
          // Committed already for the checkpoint it recorded: nothing is done twice.
          const tree = yield* treeOf(folder)
          if (row.tree !== null && tree === row.tree) {
            yield* settleLeft(missionId, 'delivery.commit', one.name, 'done')
            return
          }
          yield* settleLeft(missionId, 'delivery.commit', one.name, 'failed')
          const where = { home: homedir(), platform: process.platform }
          const kept = yield* screened(
            one,
            (yield* committablePathsOf(folder)).filter(
              (path) => sensitivePlace(path, where) !== null,
            ),
            [],
          )
          const changedOut = 'The Workspace changed while it was being committed.'
          for (const attempt of [1, 2]) {
            // A checkpoint's tree holds a stand-in for a sensitive file it withholds (#140): with
            // one changed, the commit is compared with the Workspace read on both sides of it.
            const withheld = (yield* changedPathsOf(folder)).filter(
              (path) => sensitivePlace(path, where) !== null,
            )
            const before = withheld.length === 0 ? null : yield* treesWithout(folder, kept)
            const checkpointId = yield* checkpoints.take(missionId, 'push', [one.place])
            const [taken] = yield* database
              .select({ tree: checkpointRepositories.tree })
              .from(checkpointRepositories)
              .where(
                and(
                  eq(checkpointRepositories.checkpointId, checkpointId),
                  eq(checkpointRepositories.repository, one.name),
                ),
              )
              .pipe(Effect.mapError(refusedWhile('reading the push’s checkpoint')))
            const recorded = taken?.tree ?? ''
            const trees = yield* treesWithout(folder, kept)
            const still = before === null ? trees.whole === recorded : before.whole === trees.whole
            if (!still) {
              if (attempt === 1) continue
              return yield* stopped(
                'failed',
                changedOut,
                errorNeed(`The commit of ${one.name} failed.`, [
                  { what: 'git commit', output: changedOut },
                ]),
              )
            }
            const frozen = yield* frozenOf(one)
            if (frozen !== null && recorded !== frozen) {
              return yield* changedAfterShip(one, 'git commit')
            }
            const expected = trees.kept
            yield* setRow(row, { checkpointId, tree: expected })
            if ((yield* treeOf(folder)) === expected) return
            const id = yield* begin(missionId, 'delivery.commit', {
              repository: one.name,
              checkpointId,
              tree: expected,
            })
            yield* hold('committing', one.name)
            const message = one.render(one.entry.commitTemplate)
            // Kept out: unstaged, even when an agent staged it, and never deleted.
            const committed = yield* Effect.all([
              git(folder, ['add', '--all'], 'work'),
              ...(kept.length === 0
                ? []
                : [git(folder, ['reset', '--quiet', 'HEAD', '--', ...kept.map(literal)], 'work')]),
              git(folder, ['commit', '--quiet', '-m', message], 'work'),
            ]).pipe(Effect.result)
            if (Result.isFailure(committed)) {
              const output = gitSaid(committed.failure)
              yield* settle(id, 'failed', output, row)
              return yield* stopped(
                'failed',
                output,
                errorNeed(`The commit of ${one.name} failed.`, [{ what: 'git commit', output }]),
              )
            }
            const head = yield* headOf(folder)
            if ((yield* treeOf(folder)) === expected) {
              yield* settle(id, 'done', head, row, {}, [
                pushEvent(missionId, 'delivery.committed', { repository: one.name, commit: head }),
              ])
              yield* hold('committed', one.name)
              return
            }
            // Committed, but not what the checkpoint recorded: the commit is there all the same.
            yield* settle(id, 'done', `${head}: ${changedOut}`, row, {}, [
              pushEvent(missionId, 'delivery.committed', { repository: one.name, commit: head }),
            ])
            if (attempt === 2) {
              return yield* stopped(
                'failed',
                changedOut,
                errorNeed(`The commit of ${one.name} failed.`, [
                  { what: 'git commit', output: changedOut },
                ]),
              )
            }
          }
        })

      const pushStep = (one: Run) =>
        Effect.gen(function* () {
          const { folder } = one.place
          const missionId = one.mission.id
          const remote = one.remote
          if (remote === null) {
            const output = `${one.name} has no delivery remote to push to.`
            return yield* stopped('failed', output, errorNeed(output, []))
          }
          const ref = `refs/heads/${one.branch}`
          // The branch's commit, not HEAD's: what is pushed is the mission's branch, whatever HEAD
          // names.
          const head = (yield* git(folder, ['rev-parse', '--verify', '--quiet', ref]).pipe(
            Effect.mapError(failedWith(`git rev-parse ${ref}`)),
          )).trim()
          // A Hemera commit was checked against the frozen tree; any other commit is checked here.
          if (!one.entry.steps.some((step) => step.kind === 'commit-by-hemera')) {
            const frozen = yield* frozenOf(one)
            const tree = (yield* git(folder, [
              'rev-parse',
              '--verify',
              '--quiet',
              `${head}^{tree}`,
            ]).pipe(Effect.mapError(failedWith(`git rev-parse ${head}^{tree}`)))).trim()
            if (frozen !== null && tree !== frozen) return yield* changedAfterShip(one, 'git push')
          }
          const there = yield* remoteHeadOf(folder, remote, one.branch).pipe(
            Effect.orElseSucceed(() => null),
          )
          const pushed = (set: Partial<Row> = {}) => ({
            ...set,
            commit: head,
            pushedAt: now(),
            remote,
            branch: one.branch,
          })
          const event = pushEvent(missionId, 'delivery.pushed', {
            repository: one.name,
            commit: head,
            remote,
            branch: one.branch,
          })
          if (there === head) {
            // Already on the remote: an intent a stop left is found done, nothing is pushed again.
            yield* settleLeft(missionId, 'delivery.push', one.name, 'done')
            const row = yield* reread(one)
            if (row.commit !== head) yield* setRow(row, pushed(), [event])
            return
          }
          const where = { home: homedir(), platform: process.platform }
          yield* screened(
            one,
            [],
            (yield* publishedPathsOf(folder, one.place.baseCommit, there, head)).filter(
              (path) => sensitivePlace(path, where) !== null,
            ),
          )
          yield* settleLeft(missionId, 'delivery.push', one.name, 'failed')
          const row = yield* reread(one)
          const id = yield* begin(missionId, 'delivery.push', {
            repository: one.name,
            remote,
            branch: one.branch,
            commit: head,
          })
          yield* hold('pushing', one.name)
          // Never forced: no `--force`, no `+` on the refspec; no `-u`, the upstream is kept here.
          const what = `git push ${remote} ${head}:${ref}`
          const result = yield* git(
            folder,
            ['push', '--porcelain', remote, `${head}:${ref}`],
            'work',
          ).pipe(Effect.result)
          const after = yield* remoteHeadOf(folder, remote, one.branch).pipe(Effect.result)
          if (Result.isSuccess(after) && after.success === head) {
            yield* settle(id, 'done', head, row, pushed(), [event])
            yield* hold('pushed', one.name)
            return
          }
          if (Result.isFailure(result)) {
            const output = gitSaid(result.failure)
            yield* settle(id, 'failed', output, row)
            return yield* stopped(
              'failed',
              output,
              errorNeed(`The push of ${one.name} failed.`, [{ what, output }]),
            )
          }
          if (Result.isFailure(after)) {
            const output = `Pushed, but the remote could not be read: ${gitSaid(after.failure)}`
            yield* settle(id, 'indeterminate', output, row)
            return yield* stopped(
              'indeterminate',
              output,
              errorNeed(`Hemera could not read whether ${one.name} was pushed.`, [
                { what, output },
              ]),
            )
          }
          const output = 'The remote does not show the commit pushed.'
          yield* settle(id, 'failed', output, row)
          return yield* stopped(
            'failed',
            output,
            errorNeed(`The push of ${one.name} failed.`, [{ what, output }]),
          )
        })

      /** The pull request found, read again for its status, and recorded. */
      const recorded = (one: Run, number: number, url: string, head: string) =>
        pullRequestStatus(one.repositoryId, number).pipe(
          Effect.provide(context),
          Effect.orElseSucceed(() => ({
            forge: 'unknown' as const,
            host: '',
            number,
            url,
            state: 'open' as const,
            head,
            reviewDecision: null,
            approvals: [],
          })),
        )

      const forgeSaid = (failure: { readonly message: string }) => failure.message

      // --- the images of a pull request (R7) ---------------------------------------------------

      type ImageRow = typeof deliveryImages.$inferSelect & { readonly name: string }

      /** The images recorded for a repository's pull request, in their order, with their names. */
      const imageRowsOf = (missionId: string, repositoryId: string) =>
        database
          .select({ image: deliveryImages, name: memoryEvidence.name })
          .from(deliveryImages)
          .innerJoin(memoryEvidence, eq(memoryEvidence.id, deliveryImages.evidenceId))
          .where(
            and(
              eq(deliveryImages.missionId, missionId),
              eq(deliveryImages.repositoryId, repositoryId),
            ),
          )
          .orderBy(asc(deliveryImages.position))
          .pipe(
            Effect.mapError(refusedWhile('reading the images of a pull request')),
            Effect.map((rows) => rows.map((one): ImageRow => ({ ...one.image, name: one.name }))),
          )

      /** Where the evidence files of a mission are. */
      const evidenceFolderOf = (missionId: string) =>
        Effect.map(provided(missionKeyOf(missionId)), (key) =>
          join(missionFolder(home.dataFolder, key), 'evidence'),
        )

      /** A repository as its forge names it, `owner/repository`. */
      const fullNameOf = (projectId: string, repositoryId: string) =>
        Effect.map(
          ForgePort.use((port) => port.status(projectId)).pipe(Effect.provide(context)),
          (statuses) => {
            const status = statuses.find((one) => one.repositoryId === repositoryId)
            return `${status?.owner ?? ''}/${status?.slug ?? ''}`
          },
        )

      /**
       * Whether the forge shows a repository's images, or why they are listed by name instead;
       * `ask` when a public repository's question is still to answer.
       */
      interface Hosting {
        readonly reason: string | null
        readonly ask: boolean
        readonly full: string
      }

      const hostingOf = (one: Run, answer: string | null) =>
        Effect.gen(function* () {
          const port = yield* ForgePort
          const status = (yield* port.status(one.mission.projectId)).find(
            (found) => found.repositoryId === one.repositoryId,
          )
          const full = `${status?.owner ?? ''}/${status?.slug ?? ''}`
          const byName = (reason: string): Hosting => ({ reason, ask: false, full })
          const forge = status?.forge ?? 'unknown'
          if (forge === 'bitbucket-cloud' || forge === 'bitbucket-datacenter') {
            return byName('Bitbucket cannot host images: the file names are listed.')
          }
          if (forge !== 'github')
            return byName('This forge cannot host images: the file names are listed.')
          const host = status?.host ?? ''
          if (host.toLowerCase() !== GITHUB_HOST) {
            return byName(
              `GitHub Enterprise Server (${host}) cannot host images through gh: the file names are listed.`,
            )
          }
          const capabilities = yield* port.capabilities(one.repositoryId)
          if (!capabilities.attachImage) {
            return byName(
              `gh ${capabilities.cliVersion ?? 'of an unknown version'} cannot attach images (2.99.0 or later can): the file names are listed.`,
            )
          }
          const access = yield* repositoryAccess(one.repositoryId).pipe(Effect.result)
          if (Result.isFailure(access)) {
            return byName(
              `Hemera could not read whether your account may push to ${full}: ${forgeSaid(access.failure)} The file names are listed.`,
            )
          }
          if (!access.success.push) {
            return byName(
              `Your account cannot push to ${full}, which hosting images needs: the file names are listed.`,
            )
          }
          if (access.success.visibility !== 'public' || answer === 'publish') {
            return { reason: null, ask: false, full } satisfies Hosting
          }
          if (answer === 'list') return byName(listedByChoice(full))
          return {
            reason: `${full} is public: the file names are listed until you answer whether to publish the images.`,
            ask: true,
            full,
          } satisfies Hosting
        }).pipe(Effect.provide(context))

      /** Why an image chosen when its pull request opened is no longer sent. */
      const NO_LONGER_CHOSEN =
        'No longer chosen for publication (unmarked, or its feedback withdrawn): its file name is listed.'

      const listedByChoice = (full: string) =>
        `${full} is public and you chose to list the file names instead of publishing the images.`

      /** The images chosen for a pull request about to open, recorded before it is sent. */
      const recordImages = (one: Run, hosting: Hosting | null) =>
        provided(
          mutate('recording the images of a pull request', (transaction) =>
            Effect.gen(function* () {
              const where = and(
                eq(deliveryImages.missionId, one.mission.id),
                eq(deliveryImages.repositoryId, one.repositoryId),
              )
              yield* transaction
                .delete(deliveryImages)
                .where(where)
                .pipe(Effect.mapError(refusedWhile('replacing the images of a pull request')))
              for (const [position, image] of one.images.entries()) {
                yield* transaction
                  .insert(deliveryImages)
                  .values({
                    missionId: one.mission.id,
                    repositoryId: one.repositoryId,
                    evidenceId: image.evidenceId,
                    position,
                    file: image.file,
                    alt: secrets.mask(image.alt),
                    state: hosting?.reason === null ? 'pending' : 'listed',
                    updatedAt: now(),
                  })
                  .pipe(Effect.mapError(refusedWhile('recording the images of a pull request')))
              }
              yield* setIn(
                transaction,
                { missionId: one.mission.id, repositoryId: one.repositoryId },
                {
                  imagesReason:
                    hosting?.reason === null || hosting === null
                      ? null
                      : secrets.mask(hosting.reason),
                },
              )
              return { result: undefined, events: [] }
            }),
          ),
        )

      /** The question a public repository asks before its first images are published. */
      const askPublic = (
        one: Pick<Run, 'mission' | 'repositoryId'>,
        full: string,
        names: ReadonlyArray<string>,
      ) =>
        provided(
          Effect.gen(function* () {
            const counted = names.length === 1 ? '1 image' : `${String(names.length)} images`
            const write = yield* createNeedIn(
              DELIVERY_NEEDS,
              MissionOwner.make({
                projectId: one.mission.projectId,
                missionId: one.mission.id,
                taskId: null,
              }),
              DecisionFields.make({
                question: [
                  `Publish ${counted} in the public pull request of ${full}?`,
                  ...names,
                ].join('\n'),
                options: [PUBLISH, LIST_NAMES],
                recommended: {
                  option: LIST_NAMES,
                  reason:
                    'Anyone can see an image published in a public pull request, and its copy stays on the forge. The evidence stays with the mission either way.',
                },
              }),
            )
            yield* mutate('asking whether to publish images', (transaction) =>
              Effect.gen(function* () {
                const made = yield* write(transaction)
                yield* setIn(
                  transaction,
                  { missionId: one.mission.id, repositoryId: one.repositoryId },
                  { imagesAnswer: 'ask' satisfies ImagesAnswer, imagesNeedId: made.id },
                )
                return { result: undefined, events: made.events }
              }),
            )
          }),
        )

      /**
       * Sends a pull request's images not in its description yet, then records where each stands
       * from the description read back (CT-54). An image whose copy is there already is never sent
       * again; `tried`, sent by the create that answered `said`, is not sent twice in one run.
       * Each image is checked against what is chosen right before it is sent: one unmarked since,
       * or whose feedback was withdrawn, is listed instead. With `replace`, the images listed by
       * name in the description, it is first rewritten: each name sent becomes its image.
       * Answers why some images are not published, or null.
       */
      const sendImages = (
        one: Pick<Run, 'mission' | 'repositoryId' | 'name'>,
        pullRequest: { readonly number: number; readonly url: string },
        tried: ReadonlyArray<string>,
        told: string | null,
        replace: ReadonlyArray<ImageRow> | null,
      ) =>
        Effect.gen(function* () {
          const missionId = one.mission.id
          const unsent = (yield* imageRowsOf(missionId, one.repositoryId)).filter(
            (row) => row.state === 'pending' || row.state === 'not-published',
          )
          if (unsent.length === 0) return null
          // By file: another evidence holding the same bytes may still choose it.
          const still = new Set(
            (yield* provided(chosenImages(missionId, secrets.mask))).map((image) => image.file),
          )
          const rows = unsent.filter((row) => still.has(row.file))
          const dropped = unsent.filter((row) => !still.has(row.file))
          const folder = yield* evidenceFolderOf(missionId)
          const bodyNow = pullRequestBody(one.repositoryId, pullRequest.number).pipe(
            Effect.provide(context),
            Effect.result,
          )
          const before = yield* bodyNow
          const there = (body: Result.Result<string, { readonly message: string }>, alt: string) =>
            Result.isSuccess(body) ? copyIn(body.success, alt) : null
          const refused = new Map<string, string>()
          const sendable = rows.filter((row) => {
            if (Result.isFailure(before)) return false
            if (there(before, row.alt) !== null || tried.includes(row.file)) return false
            const why = unreadable(folder, row)
            if (why !== null) refused.set(row.evidenceId, why)
            return why === null
          })
          let failed = told
          const sent = new Set(sendable.map((row) => row.evidenceId))
          const from = replace === null ? '' : nameList(replace)
          let body =
            replace === null || Result.isFailure(before) || !before.success.includes(from)
              ? null
              : before.success.replace(
                  from,
                  replace
                    .map((row) => (sent.has(row.evidenceId) ? imageLines([row]) : nameList([row])))
                    .join('\n'),
                )
          for (let at = 0; at < sendable.length; at += ATTACH_AT_ONCE) {
            const answer = yield* attachToPullRequest(
              one.repositoryId,
              pullRequest.number,
              sendable
                .slice(at, at + ATTACH_AT_ONCE)
                .map((row) => `${join(folder, row.file)}#${row.alt}`),
              body,
            ).pipe(Effect.provide(context), Effect.result)
            body = null
            if (Result.isFailure(answer)) failed = forgeSaid(answer.failure)
            else if (answer.success.code !== 0) {
              failed =
                answer.success.stderr === ''
                  ? `gh ended with ${String(answer.success.code)}.`
                  : answer.success.stderr
            }
          }
          const after = sendable.length === 0 ? before : yield* bodyNow
          const status = Option.getOrNull(readStatus((yield* reread(one)).pullRequest ?? ''))
          const left: Array<string> = []
          let published = 0
          const settled = rows.map((row) => {
            const url = there(after, row.alt)
            if (url !== null) {
              if (row.state !== 'published') published += 1
              return {
                row,
                set: {
                  state: 'published',
                  url,
                  forge: status?.forge ?? null,
                  host: status?.host ?? null,
                  number: pullRequest.number,
                  message: null,
                } satisfies Partial<ImageRow>,
              }
            }
            const message =
              refused.get(row.evidenceId) ??
              (Result.isFailure(after)
                ? `The description could not be read back: ${forgeSaid(after.failure)}`
                : (failed ?? 'gh did not show it in the description.'))
            left.push(message)
            return {
              row,
              set: { state: 'not-published', url: null, message: secrets.mask(message) },
            }
          })
          yield* provided(
            mutate('recording the images of a pull request', (transaction) =>
              Effect.gen(function* () {
                const unchosen = dropped.map((row) => ({
                  row,
                  set: { state: 'listed', url: null, message: secrets.mask(NO_LONGER_CHOSEN) },
                }))
                for (const { row, set } of [...unchosen, ...settled]) {
                  yield* transaction
                    .update(deliveryImages)
                    .set({ ...set, updatedAt: now() })
                    .where(
                      and(
                        eq(deliveryImages.missionId, missionId),
                        eq(deliveryImages.repositoryId, one.repositoryId),
                        eq(deliveryImages.evidenceId, row.evidenceId),
                      ),
                    )
                    .pipe(Effect.mapError(refusedWhile('recording the images of a pull request')))
                }
                return {
                  result: undefined,
                  events:
                    published === 0
                      ? []
                      : [
                          pushEvent(missionId, 'delivery.images_published', {
                            repository: one.name,
                            count: published,
                            url: pullRequest.url,
                          }),
                        ],
                }
              }),
            ),
          )
          const [first] = left
          if (first === undefined) return null
          return `${left.length === 1 ? '1 image was' : `${String(left.length)} images were`} not published: ${first}`
        })

      /**
       * The images of a pull request found or opened: a public repository's question asked again
       * when it was let go, then what is still to send sent. A failure stops the step.
       */
      const imagesStep = (
        one: Run,
        pullRequest: { readonly number: number; readonly url: string },
        tried: ReadonlyArray<string>,
        told: string | null,
        hosting: Hosting | null,
      ) =>
        Effect.gen(function* () {
          const row = yield* reread(one)
          const rows = yield* imageRowsOf(one.mission.id, one.repositoryId)
          const onList = rows.filter((image) => image.state === 'listed')
          if (
            onList.length > 0 &&
            row.imagesNeedId === null &&
            (hosting?.ask === true || (hosting === null && row.imagesAnswer === 'ask'))
          ) {
            yield* askPublic(
              one,
              hosting?.full ?? (yield* fullNameOf(one.mission.projectId, one.repositoryId)),
              onList.map((image) => image.name),
            )
          }
          const left = yield* sendImages(one, pullRequest, tried, told, null)
          if (left === null) return
          return yield* stopped(
            'failed',
            left,
            errorNeed(`Some images of ${one.name} were not published in its pull request.`, [
              { what: 'gh pr edit --attach', output: left },
            ]),
          )
        })

      /**
       * A public repository's question answered: Publish edits the description, its file names
       * becoming the images; the list keeps the names and says why.
       */
      const answerImages = (missionId: string, repositoryId: string) =>
        Effect.gen(function* () {
          const row = yield* rowOf(missionId, repositoryId)
          if (row === null || row.pullRequest === null) return
          const pullRequest = Option.getOrNull(readStatus(row.pullRequest))
          if (pullRequest === null) return
          const mission = yield* getMission(missionId).pipe(Effect.provide(context))
          const one = { mission, repositoryId, name: row.repository }
          if (row.imagesAnswer === 'list') {
            const full = yield* fullNameOf(mission.projectId, repositoryId)
            yield* setRow(row, { imagesReason: secrets.mask(listedByChoice(full)) })
            return
          }
          if (row.imagesAnswer !== 'publish') return
          const onList = (yield* imageRowsOf(missionId, repositoryId)).filter(
            (image) => image.state === 'listed',
          )
          if (onList.length === 0) return
          yield* provided(
            mutate('publishing the images of a pull request', (transaction) =>
              Effect.gen(function* () {
                yield* transaction
                  .update(deliveryImages)
                  .set({ state: 'pending', message: null, updatedAt: now() })
                  .where(
                    and(
                      eq(deliveryImages.missionId, missionId),
                      eq(deliveryImages.repositoryId, repositoryId),
                      eq(deliveryImages.state, 'listed'),
                    ),
                  )
                  .pipe(Effect.mapError(refusedWhile('publishing the images of a pull request')))
                yield* setIn(transaction, row, { imagesReason: null })
                return { result: undefined, events: [] }
              }),
            ),
          )
          const left = yield* sendImages(one, pullRequest, [], null, onList)
          if (left === null) return
          yield* stopRow(
            one,
            'pull-request',
            stopped(
              'failed',
              left,
              errorNeed(
                `Some images of ${row.repository} were not published in its pull request.`,
                [{ what: 'gh pr edit --attach', output: left }],
              ),
            ),
          )
        }).pipe(
          Semaphore.withPermits(turnOf(`${missionId}\u0000${repositoryId}`), 1),
          Effect.catchCause((cause) =>
            said(`the images of ${repositoryId} were not published: ${String(cause)}`),
          ),
        )

      const pullRequestStep = (one: Run) =>
        Effect.gen(function* () {
          const missionId = one.mission.id
          const row = yield* reread(one)
          const pushedCommit =
            row.commit ?? (yield* headOf(one.place.folder).pipe(Effect.orElseSucceed(() => '')))
          const left = yield* leftOf(missionId, 'delivery.pull_request', one.name)
          const find = findPullRequest(one.repositoryId, one.branch, one.base).pipe(
            Effect.provide(context),
          )
          const found = yield* find.pipe(
            Effect.mapError((failure) =>
              left.length > 0
                ? // A create whose outcome is unknown: never created again until a find can say.
                  stopped(
                    'indeterminate',
                    forgeSaid(failure),
                    errorNeed(
                      `Hemera could not read whether the pull request of ${one.name} was opened.`,
                      [{ what: 'gh pr list', output: forgeSaid(failure) }],
                    ),
                  )
                : stopped(
                    'failed',
                    forgeSaid(failure),
                    errorNeed(`The pull request of ${one.name} could not be found or opened.`, [
                      { what: 'find the pull request', output: forgeSaid(failure) },
                    ]),
                  ),
            ),
          )
          const keep = (
            number: number,
            url: string,
            head: string,
            id: string | null,
            opened: boolean,
          ) =>
            Effect.gen(function* () {
              const status = yield* recorded(one, number, url, head)
              const set = { pullRequest: writeStatus(status) }
              const written = opened
                ? [
                    pushEvent(missionId, 'delivery.pull_request_opened', {
                      repository: one.name,
                      commit: pushedCommit,
                      number,
                      url,
                    }),
                  ]
                : []
              if (id === null) yield* setRow(row, set, written)
              else yield* settle(id, 'done', url, row, set, written)
              if (!status.head.startsWith(pushedCommit) && !pushedCommit.startsWith(status.head)) {
                return yield* stopped(
                  'indeterminate',
                  'The pull request does not show the pushed commit yet.',
                  errorNeed(`The pull request of ${one.name} does not show the pushed commit.`, []),
                )
              }
            })
          if (Option.isSome(found)) {
            // Found open: it is the mission's; an intent a stop left is found done.
            yield* settleLeft(missionId, 'delivery.pull_request', one.name, 'done')
            const opened = row.pullRequest === null
            yield* keep(found.value.number, found.value.url, found.value.head, null, opened)
            // Its images still to send (a Retry); none added since it opened (R7).
            yield* imagesStep(one, found.value, [], null, null)
            return
          }
          yield* settleLeft(missionId, 'delivery.pull_request', one.name, 'failed')
          // What the description shows of the images (R7), recorded before it is sent.
          const hosting = one.images.length === 0 ? null : yield* hostingOf(one, row.imagesAnswer)
          const shown =
            hosting === null
              ? ''
              : hosting.reason === null
                ? imageLines(one.images)
                : nameList(one.images)
          yield* recordImages(one, hosting)
          const folder = yield* evidenceFolderOf(missionId)
          // The first 50 go with the create; the rest, and what cannot be read, after it.
          const sent =
            hosting?.reason === null
              ? one.images
                  .slice(0, ATTACH_AT_ONCE)
                  .filter((image) => unreadable(folder, image) === null)
              : []
          const id = yield* begin(missionId, 'delivery.pull_request', {
            repository: one.name,
            head: one.branch,
            base: one.base,
          })
          yield* hold('creating', one.name)
          const created = yield* createPullRequest(one.repositoryId, {
            base: one.base,
            head: one.branch,
            title: one.render(one.entry.pullRequestTitle),
            body: one.render(one.entry.pullRequestBody, shown),
            reviewers: one.entry.reviewers,
            attachments: sent.map((image) => `${join(folder, image.file)}#${image.alt}`),
          }).pipe(Effect.provide(context), Effect.result)
          if (
            Result.isFailure(created) &&
            Predicate.isTagged(created.failure, 'ForgeError') &&
            sent.length === 0
          ) {
            // The forge answered: it said no. With images, a failed upload still opens it: a find
            // says which.
            const output = forgeSaid(created.failure)
            yield* settle(id, 'failed', output, row)
            return yield* stopped(
              'failed',
              output,
              errorNeed(`The pull request of ${one.name} could not be opened.`, [
                { what: 'open the pull request', output },
              ]),
            )
          }
          // Opened, or cut on its way: a find says which.
          const again = yield* find.pipe(Effect.result)
          if (Result.isSuccess(again) && Option.isSome(again.success)) {
            yield* keep(
              again.success.value.number,
              again.success.value.url,
              again.success.value.head,
              id,
              true,
            )
            yield* hold('opened', one.name)
            yield* imagesStep(
              one,
              again.success.value,
              sent.map((image) => image.file),
              Result.isFailure(created) ? forgeSaid(created.failure) : null,
              hosting,
            )
            return
          }
          if (Result.isSuccess(again) && Result.isFailure(created)) {
            const output = forgeSaid(created.failure)
            yield* settle(id, 'failed', output, row)
            return yield* stopped(
              'failed',
              output,
              errorNeed(`The pull request of ${one.name} could not be opened.`, [
                { what: 'open the pull request', output },
              ]),
            )
          }
          const output = Result.isFailure(again)
            ? forgeSaid(again.failure)
            : 'The forge does not list the pull request it said it opened.'
          yield* settle(id, 'indeterminate', output, row)
          return yield* stopped(
            'indeterminate',
            output,
            errorNeed(`Hemera could not read whether the pull request of ${one.name} was opened.`, [
              { what: 'find the pull request', output },
            ]),
          )
        })

      const stepOf = (one: Run, step: DeliveryAction) => {
        switch (step.kind) {
          case 'commit-by-hemera':
            return commitStep(one)
          case 'push':
            return pushStep(one)
          case 'pull-request':
            return pullRequestStep(one)
          default: {
            const output = `Hemera does not run a “${step.kind}” step in the preparation yet.`
            return Effect.fail(stopped('failed', output, errorNeed(output, [])))
          }
        }
      }

      /** Where a row stops: its state, its message, and the need it puts to the user, at once. */
      const stopRow = (
        one: Pick<Run, 'mission' | 'repositoryId' | 'name'>,
        step: string | null,
        stop: PushStopped,
      ) =>
        provided(
          Effect.gen(function* () {
            const write =
              stop.need === null
                ? null
                : yield* createNeedIn(
                    DELIVERY_NEEDS,
                    MissionOwner.make({
                      projectId: one.mission.projectId,
                      missionId: one.mission.id,
                      taskId: null,
                    }),
                    stop.need,
                  )
            yield* mutate('stopping a push', (transaction) =>
              Effect.gen(function* () {
                const made = write === null ? null : yield* write(transaction)
                yield* setIn(
                  transaction,
                  { missionId: one.mission.id, repositoryId: one.repositoryId },
                  {
                    state: stop.state,
                    step,
                    message: secrets.mask(stop.message),
                    needId: made?.id ?? null,
                  },
                )
                const failed =
                  stop.state === 'waiting'
                    ? []
                    : [
                        pushEvent(one.mission.id, 'delivery.step_failed', {
                          repository: one.name,
                          step,
                          state: stop.state,
                          message: secrets.mask(stop.message),
                        }),
                      ]
                return { result: undefined, events: [...(made?.events ?? []), ...failed] }
              }),
            )
            yield* said(`${one.name} of ${one.mission.id} stopped (${stop.state}): ${stop.message}`)
          }),
        )

      /** One repository's sequence, in its turn: the steps of its preparation stack, in order. */
      /**
       * `atForge`, when given, is told as the sequence reaches a step that may wait for the forge's
       * CLI: Ship waits no longer than that while the CLI is not ready.
       */
      const drive = (missionId: string, repositoryId: string, atForge?: Deferred.Deferred<void>) =>
        Effect.gen(function* () {
          const row = yield* rowOf(missionId, repositoryId)
          if (row === null || row.state !== 'running') return
          const mission = yield* getMission(missionId).pipe(Effect.provide(context))
          // Nothing runs out of Review, or Shipping for Ship's push: the next return to Review
          // considers it again.
          if (!pushing(mission.stage)) return
          const at = { mission, repositoryId, name: row.repository }
          let step: string | null = null
          yield* Effect.gen(function* () {
            const copy = yield* copySection(missionId, 'preparation').pipe(Effect.provide(context))
            if (copy.section !== 'preparation')
              return yield* stopped('failed', 'No preparation was copied.')
            const entry = copy.repositories.find((one) => one.repositoryId === repositoryId)
            if (entry === undefined) {
              return yield* stopped(
                'failed',
                `${row.repository} is no longer in the delivery rules.`,
              )
            }
            const places = yield* diffs.places(missionId)
            const place = places?.find((one) => one.name === row.repository)
            if (place === undefined) {
              return yield* stopped(
                'failed',
                `The Workspace of ${row.repository} is not on the disk.`,
              )
            }
            const project = yield* getProject(mission.projectId).pipe(Effect.provide(context))
            const repository = project.repositories.find((one) => one.id === repositoryId)
            if (repository === undefined) {
              return yield* stopped('failed', `${row.repository} is no longer in the Project.`)
            }
            // The mission's branch as its Workspace recorded it, never what the worktree's HEAD
            // names now: an agent may point HEAD at another branch (`git symbolic-ref`).
            const branch = yield* diffs.branch(missionId)
            if (branch === null) {
              return yield* stopped(
                'failed',
                `The Workspace of ${row.repository} is on no branch: there is nothing to push.`,
              )
            }
            const values = yield* valuesOf(mission, branch)
            const one: Run = {
              mission,
              project,
              place,
              repositoryId,
              name: row.repository,
              entry,
              render: values.render,
              images: values.images,
              branch,
              remote: repository.remote,
              base: repository.baseBranch,
            }
            for (const action of entry.steps) {
              const still = yield* getMission(missionId).pipe(Effect.provide(context))
              if (!pushing(still.stage)) return
              step = action.id
              yield* setRow(row, { step })
              if (action.kind === 'pull-request' && atForge !== undefined) {
                yield* Deferred.succeed(atForge, undefined)
              }
              yield* stepOf(one, action)
            }
            yield* setRow(row, { state: 'done', step: null, message: null, needId: null })
          }).pipe(
            Effect.catchTag('PushStopped', (stop) => stopRow(at, step, stop)),
            Effect.catch((failure) =>
              stopRow(
                at,
                step,
                stopped(
                  'failed',
                  failure.message,
                  errorNeed(`The delivery of ${row.repository} failed.`, [
                    { what: STEP_WORDS.get(step ?? '') ?? 'delivery', output: failure.message },
                  ]),
                ),
              ),
            ),
          )
        }).pipe(
          Semaphore.withPermits(turnOf(`${missionId}\u0000${repositoryId}`), 1),
          Effect.catchCause((cause) =>
            said(`the push of ${repositoryId} failed: ${String(cause)}`),
          ),
        )

      const driveLater = (missionId: string, repositoryId: string) =>
        drive(missionId, repositoryId).pipe(Effect.forkIn(scope), Effect.asVoid)

      // --- when it runs ---------------------------------------------------------------------------

      /** Whether a repository holds what its last push (or its base) does not. */
      const changedSince = (place: Place, since: string | null) =>
        Effect.gen(function* () {
          const head = yield* headOf(place.folder).pipe(Effect.orElseSucceed(() => ''))
          if ((since ?? place.baseCommit) !== head) return true
          return yield* dirtyOf(place.folder).pipe(Effect.orElseSucceed(() => false))
        })

      /**
       * The repositories with changes since their last push (or their base) whose copied stack
       * pushes or opens a pull request, with that copy; `fresh`, only those this round has not
       * considered yet.
       */
      const actingOf = (mission: Mission, fresh: boolean) =>
        Effect.gen(function* () {
          const places = yield* diffs.places(mission.id)
          if (places === null) return null
          const project = yield* getProject(mission.projectId).pipe(Effect.provide(context))
          const known = yield* rowsOf(mission.id)
          const changed: Array<{ place: Place; repositoryId: string }> = []
          for (const place of places) {
            const repository = project.repositories.find((one) => one.path === place.name)
            if (repository === undefined) continue
            const row = known.find((one) => one.repositoryId === repository.id)
            if (fresh && row !== undefined && row.round === mission.round) continue
            if (yield* changedSince(place, row?.commit ?? null)) {
              changed.push({ place, repositoryId: repository.id })
            }
          }
          if (changed.length === 0) return null
          // The first time the step acts, the mission copies the preparation (CT-47).
          const copy = yield* copySection(mission.id, 'preparation').pipe(Effect.provide(context))
          if (copy.section !== 'preparation') return null
          const acting = changed.flatMap((one) => {
            const entry = copy.repositories.find(
              (repository) => repository.repositoryId === one.repositoryId,
            )
            return entry === undefined || !delivers(entry.steps) ? [] : [{ ...one, entry }]
          })
          return { copy, acting }
        })

      /** A repository's row, written for this round: running, or waiting for the user's click. */
      const startIn = (
        transaction: EngineTransaction,
        mission: Mission,
        one: { readonly place: Place; readonly repositoryId: string },
        needId: string | null,
        waits: boolean,
      ) => {
        const set = {
          round: mission.round,
          state: waits ? 'waiting' : 'running',
          step: null,
          message: null,
          needId: waits ? needId : null,
          checkpointId: null,
          tree: null,
          sensitive: null,
          sensitiveAnswer: null,
          updatedAt: now(),
        } satisfies Partial<Row>
        return transaction
          .insert(deliveryPushes)
          .values({
            missionId: mission.id,
            repositoryId: one.repositoryId,
            repository: one.place.name,
            ...set,
          })
          .onConflictDoUpdate({
            target: [deliveryPushes.missionId, deliveryPushes.repositoryId],
            set,
          })
          .pipe(Effect.mapError(refusedWhile('writing a push')), Effect.asVoid)
      }

      /**
       * The mission entered Review (or came back to it): each repository with changes whose stack
       * pushes or opens a pull request runs it, at once or once the user clicks. Considered once
       * per round, read again in the transaction that writes it.
       */
      const consider = (missionId: string) =>
        Effect.gen(function* () {
          const mission = yield* getMission(missionId).pipe(Effect.provide(context))
          if (mission.stage !== 'review') return
          const found = yield* actingOf(mission, true)
          if (found === null || found.acting.length === 0) return
          const { copy, acting } = found
          const clicked = acting.filter((one) =>
            one.entry.steps.some((step) => step.mode === 'click'),
          )
          const question = yield* questionOf(
            mission,
            copy,
            clicked.map((one) => one.entry),
          )
          const write =
            clicked.length === 0
              ? null
              : yield* provided(
                  createNeedIn(
                    DELIVERY_NEEDS,
                    MissionOwner.make({ projectId: mission.projectId, missionId, taskId: null }),
                    DecisionFields.make({
                      question,
                      options: [PUSH, NOT_NOW],
                      recommended: {
                        option: PUSH,
                        reason: 'The pull requests are what the team reviews; nothing is forced.',
                      },
                    }),
                  ),
                )
          const started = yield* provided(
            mutate('considering the pushes of a mission', (transaction) =>
              Effect.gen(function* () {
                const [still] = yield* transaction
                  .select({ stage: missions.stage, round: missions.round })
                  .from(missions)
                  .where(eq(missions.id, missionId))
                  .pipe(Effect.mapError(refusedWhile('reading the mission')))
                if (still?.stage !== 'review' || still.round !== mission.round) {
                  return { result: [], events: [] }
                }
                const rows = yield* transaction
                  .select()
                  .from(deliveryPushes)
                  .where(eq(deliveryPushes.missionId, missionId))
                  .pipe(Effect.mapError(refusedWhile('reading the pushes')))
                const fresh = acting.filter(
                  (one) =>
                    rows.find((row) => row.repositoryId === one.repositoryId)?.round !==
                    mission.round,
                )
                if (fresh.length === 0) return { result: [], events: [] }
                const freshClicked = fresh.filter((one) => clicked.includes(one))
                const made =
                  write === null || freshClicked.length === 0 ? null : yield* write(transaction)
                for (const one of fresh) {
                  yield* startIn(transaction, mission, one, made?.id ?? null, clicked.includes(one))
                }
                return {
                  result: fresh
                    .filter((one) => !clicked.includes(one))
                    .map((one) => one.repositoryId),
                  events: made?.events ?? [],
                }
              }),
            ),
          )
          for (const repositoryId of started) yield* driveLater(missionId, repositoryId)
        }).pipe(
          Semaphore.withPermits(turnOf(missionId), 1),
          Effect.catchCause((cause) =>
            said(`the pushes of ${missionId} were not considered: ${String(cause)}`),
          ),
        )

      /**
       * Ship's push (R9): what changed since its last push, whatever the round, handed in Ship's
       * freeze and pushed once it is committed. Ship is the user's click: nothing is asked again.
       */
      /** Ends once the repository's forge CLI is not ready, or cannot be read. */
      const cliWaits = (projectId: string, repositoryId: string) =>
        provided(
          Effect.gen(function* () {
            const port = yield* ForgePort
            yield* port.changes(projectId).pipe(
              Stream.filter((states) =>
                states.some(
                  (one) =>
                    one.repositoryId === repositoryId &&
                    one.state !== 'ready' &&
                    one.state !== 'not-needed',
                ),
              ),
              Stream.take(1),
              Stream.runDrain,
            )
          }),
        ).pipe(Effect.ignore)

      const atShip = (missionId: string) =>
        Effect.gen(function* () {
          const mission = yield* getMission(missionId).pipe(Effect.provide(context))
          const found = yield* actingOf(mission, false).pipe(
            Effect.catchTag('UnknownProject', Effect.die),
          )
          const acting = found?.acting ?? []
          return {
            handIn: (transaction) =>
              Effect.forEach(acting, (one) => startIn(transaction, mission, one, null, false), {
                discard: true,
              }),
            push: Effect.forEach(
              acting,
              (one) =>
                Effect.gen(function* () {
                  const atForge = yield* Deferred.make<void>()
                  // Forked in the pushes' own scope: a Ship that returns or is cut leaves it running.
                  const fiber = yield* drive(missionId, one.repositoryId, atForge).pipe(
                    Effect.forkIn(scope),
                  )
                  // Ended, stopped or waiting on a need; or at the forge, which waits for its CLI.
                  yield* Effect.raceFirst(
                    Fiber.join(fiber),
                    Deferred.await(atForge).pipe(
                      Effect.andThen(cliWaits(mission.projectId, one.repositoryId)),
                    ),
                  )
                }),
              { concurrency: 'unbounded', discard: true },
            ),
          } satisfies ShipPush
        })

      /** The click's question: the repositories, and with the drafts reviewed, what each opens. */
      const questionOf = (
        mission: Mission,
        copy: PreparationCopy,
        entries: ReadonlyArray<PreparationCopy['repositories'][number]>,
      ) =>
        Effect.gen(function* () {
          const names = entries.map((entry) => entry.name)
          const opens = entries.some((entry) =>
            entry.steps.some((step) => step.kind === 'pull-request'),
          )
          const asked = opens
            ? `Push and open the pull requests for ${listed(names)}?`
            : `Push ${listed(names)}?`
          if (!copy.reviewDrafts) return asked
          const branch = buildingBranchName(mission.key, mission.title)
          const { render } = yield* valuesOf(mission, branch)
          const drafts = entries.map((entry) =>
            [
              `${entry.name}: ${render(entry.pullRequestTitle)}`,
              render(entry.pullRequestBody),
              `Reviewers: ${entry.reviewers.length === 0 ? 'none' : entry.reviewers.join(', ')}`,
            ].join('\n'),
          )
          return [asked, ...drafts].join('\n\n')
        })

      // --- the needs' answers ------------------------------------------------------------------

      deliver = (need, transaction) =>
        Effect.gen(function* () {
          if (!Predicate.isTagged(need.owner, 'Mission')) return []
          const missionId = need.owner.missionId
          const option =
            need.answer !== null && Predicate.isTagged(need.answer, 'Chosen')
              ? need.answer.option
              : null
          // A public repository's question on images (R7): its rows keep the answer.
          const imagesAnswer: ImagesAnswer =
            option === PUBLISH ? 'publish' : option === LIST_NAMES ? 'list' : 'ask'
          const asked = yield* transaction
            .update(deliveryPushes)
            .set({ imagesAnswer, imagesNeedId: null, updatedAt: now() })
            .where(
              and(
                eq(deliveryPushes.missionId, missionId),
                eq(deliveryPushes.imagesNeedId, need.id),
              ),
            )
            .returning({ repository: deliveryPushes.repository })
            .pipe(Effect.mapError(refusedWhile('taking an answer on images')))
          if (asked.length > 0) {
            return [
              pushEvent(missionId, 'delivery.images_answered', {
                repositories: asked.map((row) => row.repository).join(','),
                option: option ?? '',
              }),
            ]
          }
          const state: RowState = option === NOT_NOW || option === null ? 'declined' : 'running'
          const answer = option === PUSH_ANYWAY ? 'push' : option === KEEP_OUT ? 'keep' : undefined
          const set: Partial<Row> = { state, needId: null, updatedAt: now() }
          if (answer !== undefined) set.sensitiveAnswer = answer
          const rows = yield* transaction
            .update(deliveryPushes)
            .set(set)
            .where(and(eq(deliveryPushes.missionId, missionId), eq(deliveryPushes.needId, need.id)))
            .returning({ repository: deliveryPushes.repository })
            .pipe(Effect.mapError(refusedWhile('taking an answer of the pushes')))
          if (rows.length === 0) return []
          return [
            pushEvent(missionId, 'delivery.answered', {
              repositories: rows.map((row) => row.repository).join(','),
              option: option ?? NOT_NOW,
            }),
          ]
        })

      recheck = (need) =>
        provided(
          Effect.gen(function* () {
            if (!Predicate.isTagged(need.owner, 'Mission')) return false
            const missionId = need.owner.missionId
            const rows = (yield* rowsOf(missionId)).filter((row) => row.needId === need.id)
            const places = (yield* diffs.places(missionId)) ?? []
            for (const row of rows) {
              const place = places.find((one) => one.name === row.repository)
              if (place === undefined) continue
              for (const key of ['user.name', 'user.email'] as const) {
                if ((yield* configOf(place.folder, key)) === null) return true
              }
            }
            return false
          }),
        ).pipe(Effect.orElseSucceed(() => true))

      /** A need of the pushes withdrawn (Retry found what was missing): its rows run again. */
      const resumeWithdrawn = (needId: string, missionId: string) =>
        Effect.gen(function* () {
          const rows = (yield* rowsOf(missionId)).filter((row) => row.needId === needId)
          for (const row of rows) {
            if (row.state === 'running') {
              yield* driveLater(missionId, row.repositoryId)
              continue
            }
            if (row.state !== 'failed' && row.state !== 'indeterminate') continue
            yield* setRow(row, { state: 'running', needId: null })
            yield* driveLater(missionId, row.repositoryId)
          }
        })

      /**
       * The mission left Review: a need of its pushes still pending is withdrawn, since a
       * Building's end waits while the mission holds one, and the next return to Review asks
       * again. A row waiting for its click is declined, as "Not now" leaves it; a stopped one
       * keeps its state. The rows let go of their need first, so its withdrawal resumes none.
       */
      const leaveReview = (missionId: string) =>
        Effect.gen(function* () {
          // Shipped: Ship's guard left no need of the pushes pending, and those of its push are
          // the user's in Shipping.
          if ((yield* getMission(missionId).pipe(Effect.provide(context))).stage === 'shipping') {
            return
          }
          const held = (yield* rowsOf(missionId)).filter(
            (row) => row.needId !== null || row.imagesNeedId !== null,
          )
          if (held.length === 0) return
          const ids = [
            ...new Set(
              held.flatMap((row) => [row.needId, row.imagesNeedId].filter((id) => id !== null)),
            ),
          ]
          for (const row of held) {
            // A public repository's question let go is asked again at the next return to Review.
            yield* setRow(
              row,
              row.state === 'waiting' && row.needId !== null
                ? { needId: null, state: 'declined', imagesNeedId: null }
                : { needId: null, imagesNeedId: null },
            )
          }
          const pending = yield* database
            .select({ id: needs.id })
            .from(needs)
            .where(and(inArray(needs.id, ids), eq(needs.state, 'pending')))
            .pipe(Effect.mapError(refusedWhile('reading the needs of the pushes')))
          for (const need of pending) {
            yield* provided(withdrawNeed(need.id, 'the mission left Review')).pipe(
              Effect.catchTag('UnknownNeed', () => Effect.void),
            )
          }
        })

      const handle = (event: DomainEvent) =>
        Effect.gen(function* () {
          if (event.type === 'mission.moved' && event.payload['to'] === 'review') {
            return yield* consider(event.entityId)
          }
          if (event.type === 'mission.moved' && event.payload['from'] === 'review') {
            return yield* leaveReview(event.entityId)
          }
          if (event.type === 'delivery.images_answered') {
            const named = String(event.payload['repositories'] ?? '').split(',')
            for (const row of yield* rowsOf(event.entityId)) {
              if (named.includes(row.repository)) {
                yield* answerImages(event.entityId, row.repositoryId).pipe(
                  Effect.forkIn(scope),
                  Effect.asVoid,
                )
              }
            }
            return
          }
          if (event.type === 'delivery.answered') {
            for (const row of yield* rowsOf(event.entityId)) {
              if (row.state === 'running') yield* driveLater(event.entityId, row.repositoryId)
            }
            return
          }
          if (event.type === 'need.withdrawn' && event.payload['service'] === DELIVERY_NEEDS) {
            const missionId = readMissionId(event.payload)
            if (Option.isSome(missionId)) yield* resumeWithdrawn(event.entityId, missionId.value)
          }
        })

      /** What a stop left: the sequences it cut run again, and Review entries not considered yet. */
      const catchUp = Effect.gen(function* () {
        const running = yield* database
          .select()
          .from(deliveryPushes)
          .where(eq(deliveryPushes.state, 'running'))
          .pipe(Effect.mapError(refusedWhile('reading the pushes')))
        for (const row of running) yield* driveLater(row.missionId, row.repositoryId)
        const reviewing = yield* database
          .select({ id: missions.id })
          .from(missions)
          .where(eq(missions.stage, 'review'))
          .pipe(Effect.mapError(refusedWhile('reading the missions')))
        for (const one of reviewing) yield* consider(one.id)
        // A move out of Review the stop missed: its needs are let go as the move would have.
        const holding = yield* database
          .selectDistinct({ missionId: deliveryPushes.missionId })
          .from(deliveryPushes)
          .innerJoin(missions, eq(missions.id, deliveryPushes.missionId))
          .where(
            and(
              or(isNotNull(deliveryPushes.needId), isNotNull(deliveryPushes.imagesNeedId)),
              ne(missions.stage, 'review'),
            ),
          )
          .pipe(Effect.mapError(refusedWhile('reading the pushes')))
        for (const one of holding) yield* leaveReview(one.missionId)
        yield* hold('caught-up', '')
      })

      // --- what the window reads -------------------------------------------------------------------

      const stateOf = (row: Row, waitingFor: RepositoryPush['waitingFor']): PushState => {
        if (row.state === 'waiting') return 'waiting-for-click'
        if (row.state === 'running' && waitingFor !== null) return 'waiting-for-cli'
        const states: ReadonlyArray<PushState> = [
          'running',
          'done',
          'failed',
          'indeterminate',
          'declined',
        ]
        return states.find((one) => one === row.state) ?? 'indeterminate'
      }

      const pushes = (missionId: string) =>
        provided(
          Effect.gen(function* () {
            const mission = yield* getMission(missionId)
            const project = yield* getProject(mission.projectId).pipe(
              Effect.catchTag('UnknownProject', () =>
                Effect.fail(new UnknownMission({ id: missionId })),
              ),
            )
            const copies = yield* missionCopies(missionId).pipe(
              Effect.catchTag('UnknownProject', () => Effect.succeed([])),
            )
            const copy = copies.find((one) => one.section === 'preparation')
            const rows = yield* rowsOf(missionId)
            const statuses = yield* ForgePort.use((port) => port.status(mission.projectId)).pipe(
              Effect.catchTag('UnknownProject', () => Effect.succeed([])),
            )
            const ordered = project.repositories.flatMap((repository) => {
              const row = rows.find((one) => one.repositoryId === repository.id)
              return row === undefined ? [] : [row]
            })
            const chosen = yield* chosenImages(missionId, secrets.mask)
            const images = new Map<string, ReadonlyArray<PushImage>>()
            for (const row of ordered) {
              const kept = yield* imageRowsOf(missionId, row.repositoryId)
              // Chosen since the pull request opened: never added to its description.
              const later =
                row.pullRequest === null
                  ? []
                  : chosen.filter(
                      (image) => !kept.some((one) => one.evidenceId === image.evidenceId),
                    )
              images.set(row.repositoryId, [
                ...kept.map((image): PushImage => ({
                  evidenceId: image.evidenceId,
                  name: image.name,
                  alt: image.alt,
                  state: IMAGE_STATES.find((one) => one === image.state) ?? 'pending',
                  url: image.url,
                  message: image.message,
                })),
                ...later.map((image): PushImage => ({
                  evidenceId: image.evidenceId,
                  name: image.name,
                  alt: image.alt,
                  state: 'not-in-pull-request',
                  url: null,
                  message: null,
                })),
              ])
            }
            return {
              missionId,
              rulesVersion: copy?.version ?? null,
              repositories: ordered.map((row) => {
                const status = statuses.find((one) => one.repositoryId === row.repositoryId)
                const waitingFor =
                  row.state === 'running' &&
                  row.step === 'pull-request' &&
                  status !== undefined &&
                  status.cli !== null &&
                  status.state !== 'ready' &&
                  status.state !== 'not-needed'
                    ? status.cli
                    : null
                return {
                  repositoryId: row.repositoryId,
                  repository: row.repository,
                  state: stateOf(row, waitingFor),
                  step: row.step,
                  message: row.message,
                  waitingFor,
                  commit: row.commit,
                  pushedAt: row.pushedAt,
                  pullRequest:
                    row.pullRequest === null ? null : Option.getOrNull(readStatus(row.pullRequest)),
                  images: images.get(row.repositoryId) ?? [],
                  imagesReason: row.imagesReason,
                } satisfies RepositoryPush
              }),
            } satisfies MissionPushes
          }),
        )

      const service: PushesService = {
        pushes,
        setPublishable: (evidenceId, publishable) =>
          provided(
            Effect.gen(function* () {
              const [found] = yield* database
                .select()
                .from(memoryEvidence)
                .where(eq(memoryEvidence.id, evidenceId))
                .pipe(Effect.mapError(refusedWhile('reading an evidence')))
              if (found === undefined) return yield* new UnknownEvidence({ id: evidenceId })
              if (!IMAGE_TYPES.includes(found.mediaType)) {
                return yield* new NotPublishable({ evidenceId })
              }
              yield* mutate('marking an image publishable', (transaction) =>
                transaction
                  .update(memoryEvidence)
                  .set({ publishable: publishable ? 1 : 0 })
                  .where(eq(memoryEvidence.id, evidenceId))
                  .pipe(
                    Effect.mapError(refusedWhile('marking an image publishable')),
                    Effect.as({
                      result: undefined,
                      events: [
                        {
                          type: 'delivery.image_marked',
                          entityKind: 'mission',
                          entityId: found.missionId,
                          source: 'ui',
                          author: 'human',
                          payload: { evidenceId, name: found.name, publishable },
                        } satisfies NewEvent,
                      ],
                    }),
                  ),
              )
            }),
          ),
        atShip,
        retry: (missionId, repository) =>
          Effect.gen(function* () {
            yield* getMission(missionId).pipe(Effect.provide(context))
            const row = (yield* rowsOf(missionId)).find((one) => one.repository === repository)
            if (row === undefined || (row.state !== 'failed' && row.state !== 'indeterminate')) {
              return yield* new NothingToRetry({ repository })
            }
            const pending =
              row.needId === null
                ? []
                : yield* database
                    .select({ id: needs.id })
                    .from(needs)
                    .where(and(eq(needs.id, row.needId), eq(needs.state, 'pending')))
                    .pipe(Effect.mapError(refusedWhile('reading the need of a push')))
            yield* setRow(row, { state: 'running', needId: null })
            for (const need of pending) {
              yield* provided(withdrawNeed(need.id, 'retried')).pipe(
                Effect.catchTag('UnknownNeed', () => Effect.void),
              )
            }
            yield* driveLater(missionId, row.repositoryId)
            return yield* pushes(missionId)
          }),
        changes: (missionId) =>
          Stream.unwrap(
            Effect.gen(function* () {
              const first = yield* pushes(missionId)
              const committed = yield* events.subscribe
              const later = committed.pipe(
                Stream.filter(
                  (event) =>
                    (event.entityId === missionId &&
                      (event.type.startsWith('delivery.') || event.type === 'mission.moved')) ||
                    (event.type.startsWith('need.') && event.payload['missionId'] === missionId) ||
                    event.type === 'forge.cli_state_changed',
                ),
                Stream.mapEffect(() => pushes(missionId)),
              )
              return Stream.concat(Stream.make(first), later)
            }),
          ),
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
      return service
    }),
  )
  return { layer, handler }
}
