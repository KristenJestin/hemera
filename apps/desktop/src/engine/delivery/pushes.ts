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
 * - **Hemera commits** (`commit-by-hemera`): a checkpoint of the repository first (#140), what this
 *   push pushes; then the whole working tree is committed (untracked non-ignored files included)
 *   with the commit template, as the user's Git identity, which Hemera reads and never sets. The
 *   commit's tree must equal the checkpoint's, or the Workspace changed meanwhile: tried once more
 *   from a new checkpoint. Never an amend, never `--no-verify`. An untracked file in a sensitive
 *   place (A5's list) stops it first, with a decision need: push it anyway, or keep it out.
 * - **The push** (`push`): `git push <remote> refs/heads/<branch>:refs/heads/<branch>` to the
 *   repository's delivery remote, never forced, through the engine's own Git in the user's
 *   environment (the agents' is the one where pushing is neutralised). No `-u`: the upstream is
 *   recorded here, so the repository's configuration is never written.
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
  NothingToRetry,
  type Project,
  PullRequestStatus,
  type PushState,
  type RepositoryPush,
  UnknownMission,
} from '@hemera/ipc'
import { and, asc, desc, eq, inArray, like } from 'drizzle-orm'
import {
  Context,
  Effect,
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
import { copySection, missionCopies } from '../delivery-rules.ts'
import { DomainEvents } from '../domain-events.ts'
import { ForgePort } from '../forges/port.ts'
import { createPullRequest, findPullRequest, pullRequestStatus } from '../forges/pull-requests.ts'
import type { GitBytesSpawn, GitRefusal } from '../git.ts'
import type { DomainEvent, NewEvent } from '../journal.ts'
import { type MissionActivity, getMission } from '../missions.ts'
import {
  DeliveryFailed,
  type NeedHandler,
  createNeedIn,
  needService,
  withdrawNeed,
} from '../needs.ts'
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
  deliveryPushes,
  effectfulActions,
  memoryEvidence,
  missions,
  needs,
} from '../storage/schema.ts'
import { beginAction, settleActionIn } from '../tools/actions.ts'
import { mutate } from '../transaction.ts'

/** The service the pushes' needs belong to. */
export const DELIVERY_NEEDS = needService('delivery')

/** Where a suite holds a repository's sequence: after an intent, after its outcome. */
export type PushMoment = 'committing' | 'committed' | 'pushing' | 'pushed' | 'creating' | 'opened'

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
  /** What a stop left, then each committed event of the stream, for as long as it lasts. */
  readonly follow: (events: Stream.Stream<DomainEvent>) => Effect.Effect<void>
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
const PUSH_ANYWAY = 'Push them anyway'
const KEEP_OUT = 'Keep them out'

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

/** Whether a stack pushes or opens a pull request: what this ticket runs it for. */
const delivers = (steps: ReadonlyArray<DeliveryAction>) =>
  steps.some((step) => step.kind === 'push' || step.kind === 'pull-request')

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
      const context = yield* Effect.context<
        Database | DomainEvents | Secrets | ForgePort | Diffs | Checkpoints | MissionActivity
      >()
      const provided = <A, E>(
        effect: Effect.Effect<
          A,
          E,
          Database | DomainEvents | Secrets | ForgePort | Diffs | Checkpoints | MissionActivity
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
      const untrackedOf = (folder: string) =>
        Effect.map(git(folder, ['ls-files', '--others', '--exclude-standard', '-z']), (out) =>
          out.split('\0').filter((path) => path !== ''),
        )
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
              yield* gitIn(
                folder,
                ['rm', '--cached', '--quiet', '--ignore-unmatch', '--', ...kept],
                env,
              )
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
          // `{images}` lists the mission's images by name until R7 hosts them.
          const images = yield* database
            .select({ name: memoryEvidence.name })
            .from(memoryEvidence)
            .where(
              and(
                eq(memoryEvidence.missionId, mission.id),
                like(memoryEvidence.mediaType, 'image/%'),
              ),
            )
            .orderBy(asc(memoryEvidence.addedAt))
            .pipe(Effect.mapError(refusedWhile('reading the mission’s images')))
          const values: TemplateFields = {
            key: mission.key,
            title: mission.title,
            slug: buildingBranchName(mission.key, mission.title),
            branch,
            summary: building?.summary ?? '',
          }
          const list = images.map((image) => `- ${image.name}`).join('\n')
          return (template: string) =>
            renderTemplate(template, values).text.replaceAll(IMAGES_SLOT, list)
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
        readonly render: (template: string) => string
        readonly branch: string
        readonly remote: string | null
        readonly base: string
      }

      const reread = (one: Run) =>
        Effect.flatMap(rowOf(one.mission.id, one.repositoryId), (row) =>
          row === null
            ? Effect.fail(stopped('failed', 'The push was removed.'))
            : Effect.succeed(row),
        )

      const commitStep = (one: Run) =>
        Effect.gen(function* () {
          const { folder } = one.place
          const missionId = one.mission.id
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
          const untracked = yield* untrackedOf(folder)
          const where = { home: homedir(), platform: process.platform }
          const sensitive = untracked.filter((path) => sensitivePlace(path, where) !== null)
          const answered = Option.getOrElse(
            readStrings(row.sensitive ?? ''),
            (): ReadonlyArray<string> => [],
          )
          if (
            sensitive.length > 0 &&
            (row.sensitiveAnswer === null || sensitive.some((path) => !answered.includes(path)))
          ) {
            yield* setRow(row, { sensitive: JSON.stringify(sensitive), sensitiveAnswer: null })
            return yield* stopped(
              'waiting',
              `Untracked files in sensitive places: ${sensitive.join(', ')}.`,
              DecisionFields.make({
                question: `${one.name} holds files Git does not track in sensitive places: ${sensitive.join(', ')}. Push them with the rest of the Workspace?`,
                options: [PUSH_ANYWAY, KEEP_OUT],
                recommended: {
                  option: KEEP_OUT,
                  reason:
                    'Such a file often holds a secret. Kept out, it stays uncommitted and nothing is added to .gitignore.',
                },
              }),
            )
          }
          const kept = row.sensitiveAnswer === 'keep' ? sensitive : []
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
            const added =
              kept.length === 0
                ? ['add', '--all']
                : ['add', '--all', '--', '.', ...kept.map((path) => `:(exclude,literal)${path}`)]
            const committed = yield* Effect.all([
              git(folder, added, 'work'),
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
          const head = yield* headOf(folder).pipe(Effect.mapError(failedWith('git rev-parse HEAD')))
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
          yield* settleLeft(missionId, 'delivery.push', one.name, 'failed')
          const row = yield* reread(one)
          const id = yield* begin(missionId, 'delivery.push', {
            repository: one.name,
            remote,
            branch: one.branch,
            commit: head,
          })
          yield* hold('pushing', one.name)
          const ref = `refs/heads/${one.branch}`
          // Never forced: no `--force`, no `+` on the refspec; no `-u`, the upstream is kept here.
          const what = `git push ${remote} ${ref}:${ref}`
          const result = yield* git(
            folder,
            ['push', '--porcelain', remote, `${ref}:${ref}`],
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
            return
          }
          yield* settleLeft(missionId, 'delivery.pull_request', one.name, 'failed')
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
            body: one.render(one.entry.pullRequestBody),
            reviewers: one.entry.reviewers,
          }).pipe(Effect.provide(context), Effect.result)
          if (Result.isFailure(created) && Predicate.isTagged(created.failure, 'ForgeError')) {
            // The forge answered: it said no.
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
      const drive = (missionId: string, repositoryId: string) =>
        Effect.gen(function* () {
          const row = yield* rowOf(missionId, repositoryId)
          if (row === null || row.state !== 'running') return
          const mission = yield* getMission(missionId).pipe(Effect.provide(context))
          // Nothing runs out of Review: the next return to Review considers it again.
          if (mission.stage !== 'review') return
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
            const branch = (yield* git(place.folder, [
              'symbolic-ref',
              '--quiet',
              '--short',
              'HEAD',
            ]).pipe(Effect.orElseSucceed(() => ''))).trim()
            if (branch === '') {
              return yield* stopped(
                'failed',
                `${row.repository} is on no branch: there is nothing to push.`,
              )
            }
            const one: Run = {
              mission,
              project,
              place,
              repositoryId,
              name: row.repository,
              entry,
              render: yield* valuesOf(mission, branch),
              branch,
              remote: repository.remote,
              base: repository.baseBranch,
            }
            for (const action of entry.steps) {
              const still = yield* getMission(missionId).pipe(Effect.provide(context))
              if (still.stage !== 'review') return
              step = action.id
              yield* setRow(row, { step })
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
       * The mission entered Review (or came back to it): each repository with changes whose stack
       * pushes or opens a pull request runs it, at once or once the user clicks. Considered once
       * per round, read again in the transaction that writes it.
       */
      const consider = (missionId: string) =>
        Effect.gen(function* () {
          const mission = yield* getMission(missionId).pipe(Effect.provide(context))
          if (mission.stage !== 'review') return
          const places = yield* diffs.places(missionId)
          if (places === null) return
          const project = yield* getProject(mission.projectId).pipe(Effect.provide(context))
          const known = yield* rowsOf(missionId)
          const changed: Array<{ place: Place; repositoryId: string }> = []
          for (const place of places) {
            const repository = project.repositories.find((one) => one.path === place.name)
            if (repository === undefined) continue
            const row = known.find((one) => one.repositoryId === repository.id)
            if (row !== undefined && row.round === mission.round) continue
            if (yield* changedSince(place, row?.commit ?? null)) {
              changed.push({ place, repositoryId: repository.id })
            }
          }
          if (changed.length === 0) return
          // The first time the step acts, the mission copies the preparation (CT-47).
          const copy = yield* copySection(missionId, 'preparation').pipe(Effect.provide(context))
          if (copy.section !== 'preparation') return
          const acting = changed.flatMap((one) => {
            const entry = copy.repositories.find(
              (repository) => repository.repositoryId === one.repositoryId,
            )
            return entry === undefined || !delivers(entry.steps) ? [] : [{ ...one, entry }]
          })
          if (acting.length === 0) return
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
                  const waits = clicked.includes(one)
                  const set = {
                    round: mission.round,
                    state: waits ? 'waiting' : 'running',
                    step: null,
                    message: null,
                    needId: waits ? (made?.id ?? null) : null,
                    checkpointId: null,
                    tree: null,
                    sensitive: null,
                    sensitiveAnswer: null,
                    updatedAt: now(),
                  } satisfies Partial<Row>
                  yield* transaction
                    .insert(deliveryPushes)
                    .values({
                      missionId,
                      repositoryId: one.repositoryId,
                      repository: one.place.name,
                      ...set,
                    })
                    .onConflictDoUpdate({
                      target: [deliveryPushes.missionId, deliveryPushes.repositoryId],
                      set,
                    })
                    .pipe(Effect.mapError(refusedWhile('writing a push')))
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
          const render = yield* valuesOf(mission, branch)
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

      const handle = (event: DomainEvent) =>
        Effect.gen(function* () {
          if (event.type === 'mission.moved' && event.payload['to'] === 'review') {
            return yield* consider(event.entityId)
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
                } satisfies RepositoryPush
              }),
            } satisfies MissionPushes
          }),
        )

      const service: PushesService = {
        pushes,
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
