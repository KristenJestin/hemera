/**
 * Review's checkpoints, feedback and comment anchors (#341, R1): a Review checkpoint on entering
 * Review and at the end of each round; rounds as data, forward only; the user's remarks, code
 * comments and questions, their versions, images and states; the anchors of code comments followed
 * on the live diff; the hold on the agents' writes while the user reviews; and a refused manual
 * proof written as a remark.
 *
 * On the engine as it starts, with the fake agent of #32 as every agent: Acme's `api` and `web` in
 * temporary folders, a mission launched into Building over both and moved into Review the way the
 * end of a Building moves it (B9), the test writing in its Workspace as the user would.
 */

import {
  existsSync,
  linkSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'

import {
  CodeAnchorAsked,
  REVIEW_HOLD,
  type RoundState,
  STAGE_UNREAD,
  SpecAnchorAsked,
} from '@hemera/core/domain'
import {
  AnchorCurrent,
  AnchorMoved,
  AnchorOutdated,
  AnchorUnread,
  type DiffChange,
  FeedbackForge,
  FeedbackUser,
  type FeedbackView,
  type ReviewStateView,
  SpecAnchorView,
  UserAuthor,
} from '@hemera/ipc'
import { asc, desc, eq } from 'drizzle-orm'
import { Deferred, Effect, Fiber, Predicate, Ref, Stream } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { ImageBlock } from '../src/engine/agents/client.ts'
import { Checkpoints } from '../src/engine/building/checkpoints.ts'
import { OutsideChanges, type OutsideSettings } from '../src/engine/building/outside.ts'
import {
  SnapshotFailed,
  Snapshots,
  type SnapshotsService,
} from '../src/engine/building/snapshots.ts'
import { judgeManual } from '../src/engine/building/proofs.ts'
import { Memory } from '../src/engine/memory/index.ts'
import { putEvidence } from '../src/engine/memory/evidence.ts'
import { missionFolder, missionKeyOf } from '../src/engine/memory/files.ts'
import { createMission, getMission, moveIn, moveMission } from '../src/engine/missions.ts'
import { Diffs } from '../src/engine/review/diffs.ts'
import { Review, type ReviewHold } from '../src/engine/review/feedback.ts'
import { sessionsIn } from '../src/engine/sessions/store.ts'
import { Database, DatabaseError, type EngineDatabase } from '../src/engine/storage/database.ts'
import {
  buildingLaunches,
  memoryEvidence,
  missions,
  sessionDeliveries,
  workspaceRepositories,
} from '../src/engine/storage/schema.ts'
import { mutate } from '../src/engine/transaction.ts'
import { builderAgents, builderOf, launched } from './builder-world.ts'
import { git } from './repositories.ts'
import { HELPER, sessionsEngine, until, within } from './sessions-world.ts'
import { removeFolders, temporaryFolder } from './storage.ts'
import { ALLOW, callTool, verdictsSaying } from './tools-world.ts'

let data: string
let work: string

beforeEach(() => {
  data = realpathSync.native(temporaryFolder('review-feedback'))
  work = realpathSync.native(temporaryFolder('review-feedback-work'))
})
afterEach(removeFolders)

/** The detector's timers never on their own: a compare is the test's. */
const QUIET_TIMERS: Partial<OutsideSettings> = {
  compareEveryMillis: 3_600_000,
  baseEveryMillis: 3_600_000,
}

const engine = (
  hold?: ReviewHold,
  verdicts = verdictsSaying(() => ALLOW),
  snapshots: (real: SnapshotsService) => SnapshotsService = (real) => real,
) =>
  sessionsEngine(data, builderAgents, {
    roles: [HELPER],
    tools: { home: work, verdicts: verdicts.layer },
    building: { outside: QUIET_TIMERS },
    review: { hold },
    snapshots,
  })

/** The database whose read of a mission's stage alone fails while `armed` says so. */
const stageUnreadable =
  (armed: () => boolean) =>
  (real: EngineDatabase): EngineDatabase =>
    new Proxy(real, {
      get: (target, key, receiver) => {
        if (key !== 'select') return Reflect.get(target, key, receiver)
        return (fields?: Parameters<EngineDatabase['select']>[0]) => {
          if (armed() && fields !== undefined && Object.keys(fields).join() === 'stage') {
            const refused = Effect.fail(
              new DatabaseError({ doing: 'reading the mission', reason: 'disk I/O error' }),
            )
            return { from: () => ({ where: () => refused }) }
          }
          return fields === undefined ? target.select() : target.select(fields)
        }
      },
    })

/** Snapshots whose checkpoint takes fail while `broken` says so, each attempt counted. */
const checkpointsFailing = (broken: () => boolean) => {
  const attempts = { count: 0 }
  const wrap = (real: SnapshotsService): SnapshotsService => ({
    ...real,
    take: (repository, owner) => {
      if (owner.kind !== 'checkpoint') return real.take(repository, owner)
      attempts.count += 1
      return broken()
        ? Effect.fail(
            new SnapshotFailed({
              repository: repository.name,
              owner: 'checkpoint',
              said: 'git: no space left on device',
            }),
          )
        : real.take(repository, owner)
    },
  })
  return { attempts, wrap }
}

/** Every test runs a whole engine, Git and a Builder: far above its time alone (5 to 15 s). */
const SLOW = 120_000

/** Twenty numbered lines: what a code comment is written on. */
const NOTES = Array.from({ length: 20 }, (_, at) => `line ${String(at + 1)}`)
const textOf = (lines: ReadonlyArray<string>) => `${lines.join('\n')}\n`

/** A PNG of 640 × 480: its signature and its IHDR, which is all the store reads. */
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000280000001e00806000000', 'hex')
/** Another PNG, of 641 × 480: another mission's, or what replaced a file. */
const OTHER_PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000281000001e00806000000', 'hex')

/** Acme's mission launched over `api` and `web`, `notes.ts` written in `api`, and its folders. */
const launchedOverBoth = () =>
  Effect.gen(function* () {
    const { mission, project } = yield* launched(
      work,
      () => Effect.void,
      'It touches api and web, nothing else.',
    )
    const database = yield* Database
    const [launch] = yield* database
      .select({ workspaceId: buildingLaunches.workspaceId })
      .from(buildingLaunches)
      .where(eq(buildingLaunches.missionId, mission.id))
      .orderBy(desc(buildingLaunches.startedAt))
    const rows = yield* database
      .select()
      .from(workspaceRepositories)
      .where(eq(workspaceRepositories.workspaceId, launch?.workspaceId ?? ''))
      .orderBy(asc(workspaceRepositories.position))
    const folderOf = (path: string) => {
      const found = rows.find((row) => row.path === path)?.worktree
      if (found === undefined) throw new Error(`no ${path} in the Workspace`)
      return found
    }
    const api = folderOf('api')
    // The Building's base snapshots are taken as its Builder starts: a test writes after them.
    yield* builderOf(mission.id)
    writeFileSync(join(api, 'notes.ts'), textOf(NOTES))
    return { missionId: mission.id, projectId: project.id, api, web: folderOf('web') }
  })

/** The mission moved as a Building's end (B9) or a Fix moves it. */
const moved = (missionId: string, move: 'endBuilding' | 'fix' | 'ship') =>
  Effect.gen(function* () {
    if (move !== 'endBuilding') return yield* moveMission(missionId, move, 'user')
    const mission = yield* getMission(missionId)
    yield* mutate('ending the Building', (transaction) =>
      Effect.map(
        moveIn(
          transaction,
          { id: missionId, stage: mission.stage, round: mission.round },
          move,
          'hemera',
        ),
        (event) => ({ result: undefined, events: [event] }),
      ),
    )
    return yield* getMission(missionId)
  })

const stateOf = (missionId: string) => Review.use((review) => review.state(missionId))
const add = (
  missionId: string,
  asked: Parameters<(typeof Review.Service)['feedbackAdd']>[1],
  author: Parameters<(typeof Review.Service)['feedbackAdd']>[2] = FeedbackUser.make({}),
) => Review.use((review) => review.feedbackAdd(missionId, asked, author))
const remark = (body: string) => ({ kind: 'remark' as const, body, anchor: null, images: [] })
const codeOn = (start: number, end: number, body = 'These lines read badly.') => ({
  kind: 'code' as const,
  body,
  anchor: CodeAnchorAsked.make({
    repository: 'api',
    path: 'notes.ts',
    side: 'new',
    lines: { start, end },
    tree: null,
  }),
  images: [],
})
const moveRound = (missionId: string, number: number, to: RoundState) =>
  Review.use((review) => review.moveRound(missionId, number, to))

/** The mission in Review, its entry checkpoint taken. */
const inReview = (missionId: string) =>
  Effect.gen(function* () {
    yield* moved(missionId, 'endBuilding')
    yield* until(
      Effect.map(stateOf(missionId), (state) => state.checkpoints.length > 0),
      30_000,
    )
  })

const feedbackOf = (state: ReviewStateView, id: string): FeedbackView => {
  const found = state.feedback.find((one) => one.id === id)
  if (found === undefined) throw new Error(`no feedback ${id}`)
  return found
}
const liveOf = (feedback: FeedbackView) =>
  feedback.anchor !== null && Predicate.isTagged(feedback.anchor, 'Code')
    ? feedback.anchor.live
    : null

/** The Workspace removed from the disk and Git's objects it alone held collected. */
const workspaceGone = (folders: ReadonlyArray<string>) =>
  Effect.sync(() => {
    for (const folder of folders) rmSync(folder, { recursive: true, force: true })
    for (const name of ['api', 'web']) {
      const main = join(work, 'acme', name)
      git(main, 'worktree', 'prune')
      for (const branch of git(main, 'branch', '--format=%(refname:short)').split('\n')) {
        if (branch !== '' && branch !== 'main') git(main, 'branch', '-D', branch)
      }
      git(main, 'reflog', 'expire', '--expire=now', '--all')
      git(main, 'gc', '-q', '--prune=now')
    }
  })

describe('Review checkpoints', () => {
  test(
    'a Review checkpoint Git refuses once is taken again while the mission is in Review',
    async () => {
      // Armed as the mission enters Review: the Building's own checkpoints are not this test's.
      let failures = 0
      const failing = checkpointsFailing(() => {
        failures -= 1
        return failures >= 0
      })
      const { run } = engine(undefined, undefined, failing.wrap)
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { missionId } = yield* launchedOverBoth()
            const before = failing.attempts.count
            failures = 1
            yield* inReview(missionId)
            return {
              attempts: failing.attempts.count - before,
              checkpoints: (yield* stateOf(missionId)).checkpoints.map((one) => [
                one.round,
                one.kind,
              ]),
            }
          }),
        ),
      )
      // The first try refused on `api`; the next takes `api` and `web`.
      expect(seen.attempts).toBe(3)
      expect(seen.checkpoints).toEqual([[0, 'review_entry']])
    },
    SLOW,
  )

  test(
    'a mission that leaves Review before its checkpoint could be taken takes it on the way out',
    async () => {
      let broken = false
      const failing = checkpointsFailing(() => broken)
      const { run } = engine(undefined, undefined, failing.wrap)
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { missionId } = yield* launchedOverBoth()
            const before = failing.attempts.count
            broken = true
            yield* moved(missionId, 'endBuilding')
            yield* until(
              Effect.sync(() => failing.attempts.count > before),
              30_000,
            )
            // Git works again; Fix is clicked before the next try: the round's archive is taken now.
            broken = false
            yield* add(missionId, remark('The export button is grey.'))
            yield* moveRound(missionId, 1, 'grilling')
            yield* moveRound(missionId, 1, 'building')
            yield* moved(missionId, 'fix')
            yield* until(
              Effect.map(stateOf(missionId), (state) => state.checkpoints.length > 0),
              30_000,
            )
            return (yield* stateOf(missionId)).checkpoints.map((one) => [one.round, one.kind])
          }),
        ),
      )
      expect(seen).toEqual([[0, 'review_entry']])
    },
    SLOW,
  )

  test(
    'entering Review records one Review checkpoint per repository; a round’s end records another; both read back after the Workspace is removed and git gc --prune=now ran',
    async () => {
      const { run } = engine()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { missionId, api, web } = yield* launchedOverBoth()
            yield* inReview(missionId)
            // Round 1: its feedback, its Fix, a change, and its return to Review.
            yield* add(missionId, remark('The export button is grey.'))
            yield* moveRound(missionId, 1, 'grilling')
            yield* moveRound(missionId, 1, 'building')
            yield* moved(missionId, 'fix')
            writeFileSync(join(api, 'notes.ts'), textOf(['changed in round 1', ...NOTES]))
            yield* moved(missionId, 'endBuilding')
            yield* until(
              Effect.map(stateOf(missionId), (state) => state.checkpoints.length === 2),
              30_000,
            )
            yield* workspaceGone([api, web])
            const state = yield* stateOf(missionId)
            const checkpoints = yield* Checkpoints
            const [entry, end] = state.checkpoints
            const contentAt = (id: string) =>
              Effect.map(checkpoints.content(id, 'api', 'notes.ts', 'after'), (side) =>
                side?.content === null || side === null
                  ? null
                  : Buffer.from(side.content).toString('utf8'),
              )
            return {
              checkpoints: state.checkpoints.map((one) => ({
                round: one.round,
                kind: one.kind,
                repositories: one.repositories.map((repository) => repository.repository),
              })),
              entry: yield* contentAt(entry?.id ?? ''),
              end: yield* contentAt(end?.id ?? ''),
            }
          }),
        ),
      )
      expect(seen.checkpoints).toEqual([
        { round: 0, kind: 'review_entry', repositories: ['api', 'web'] },
        { round: 1, kind: 'round_end', repositories: ['api', 'web'] },
      ])
      expect(seen.entry).toBe(textOf(NOTES))
      expect(seen.end).toBe(textOf(['changed in round 1', ...NOTES]))
    },
    SLOW,
  )

  test(
    'an engine stopped between the entry into Review and its checkpoint takes it at its next start',
    async () => {
      const stuck = Effect.runSync(Deferred.make<void>())
      const { run } = engine((at) => (at === 'checkpoint' ? Deferred.await(stuck) : Effect.void))
      const missionId = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { missionId: launchedId } = yield* launchedOverBoth()
            yield* moved(launchedId, 'endBuilding')
            return launchedId
          }),
        ),
      )
      const { run: again } = engine()
      const seen = await again(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            yield* until(
              Effect.map(stateOf(missionId), (state) => state.checkpoints.length > 0),
              30_000,
            )
            return (yield* stateOf(missionId)).checkpoints.map((one) => one.round)
          }),
        ),
      )
      expect(seen).toEqual([0])
    },
    SLOW,
  )
})

describe('Feedback only accumulates', () => {
  test(
    'adding a remark, a code comment and a question starts no session and delivers nothing; the Journal gets one line each',
    async () => {
      const { run } = engine()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { missionId } = yield* launchedOverBoth()
            yield* inReview(missionId)
            const database = yield* Database
            const sessions = () =>
              Effect.map(
                sessionsIn(['idle', 'working', 'starting'], { kind: 'mission', missionId }),
                (rows) => rows.length,
              )
            const deliveries = () =>
              Effect.map(database.select().from(sessionDeliveries), (rows) => rows.length)
            const before = { sessions: yield* sessions(), deliveries: yield* deliveries() }
            yield* add(missionId, remark('The export button is grey.'))
            yield* add(missionId, codeOn(10, 12))
            yield* add(missionId, {
              kind: 'question',
              body: 'Why CSV and not XLSX?',
              anchor: null,
              images: [],
            })
            const memory = yield* Memory
            yield* memory.catchUp
            const lines = (yield* memory.journal(missionId, null)).lines.filter(
              (line) => line.kind === 'review',
            )
            return {
              before,
              after: { sessions: yield* sessions(), deliveries: yield* deliveries() },
              lines: lines.map((line) => line.text),
              state: yield* stateOf(missionId),
            }
          }),
        ),
      )
      expect(seen.after).toEqual(seen.before)
      expect(seen.lines).toEqual(
        expect.arrayContaining([
          'The user wrote a remark in round 1: The export button is grey.',
          'The user commented on api/notes.ts, lines 10–12, in round 1: These lines read badly.',
          'The user asked a question in round 1: Why CSV and not XLSX?',
        ]),
      )
      expect(seen.state.rounds.map((one) => [one.number, one.state])).toEqual([[1, 'collecting']])
    },
    SLOW,
  )
})

describe('Feedback is masked', () => {
  test(
    'a token in a feedback body is masked before it is written, in every version and the Journal',
    async () => {
      const token = `ghp_${'a1B2'.repeat(9)}`
      const { run } = engine()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { missionId } = yield* launchedOverBoth()
            yield* inReview(missionId)
            const one = yield* add(missionId, remark(`It fails with ${token}.`))
            const edited = yield* Review.use((review) =>
              review.feedbackEdit(one.id, `Still ${token}.`, 1, FeedbackUser.make({})),
            )
            const memory = yield* Memory
            yield* memory.catchUp
            const lines = (yield* memory.journal(missionId, null)).lines.map((line) => line.text)
            return { edited, lines }
          }),
        ),
      )
      expect(JSON.stringify(seen)).not.toContain(token)
      expect(seen.edited.versions.map((one) => one.body)).toEqual([
        'It fails with •••.',
        'Still •••.',
      ])
    },
    SLOW,
  )
})

describe('Feedback waits for a Fix', () => {
  test(
    'feedback waits is true for a waiting remark, false for a question, a withdrawn remark, or an empty round',
    async () => {
      const { run } = engine()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { missionId } = yield* launchedOverBoth()
            yield* inReview(missionId)
            const empty = (yield* stateOf(missionId)).waits
            yield* add(missionId, { kind: 'question', body: 'Why CSV?', anchor: null, images: [] })
            const question = (yield* stateOf(missionId)).waits
            const one = yield* add(missionId, remark('The export button is grey.'))
            const waiting = (yield* stateOf(missionId)).waits
            yield* Review.use((review) => review.feedbackWithdraw(one.id, FeedbackUser.make({})))
            const withdrawn = yield* stateOf(missionId)
            return {
              empty,
              question,
              waiting,
              withdrawn: withdrawn.waits,
              state: feedbackOf(withdrawn, one.id).state,
            }
          }),
        ),
      )
      expect(seen).toEqual({
        empty: false,
        question: false,
        waiting: true,
        withdrawn: false,
        state: 'withdrawn',
      })
    },
    SLOW,
  )
})

describe('Editing a feedback', () => {
  test(
    'an edit makes a new version while waiting, and is refused after Fix took it',
    async () => {
      const { run } = engine()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { missionId } = yield* launchedOverBoth()
            yield* inReview(missionId)
            const one = yield* add(missionId, remark('The button is grey.'))
            const edit = (body: string, version: number) =>
              Review.use((review) =>
                review.feedbackEdit(one.id, body, version, FeedbackUser.make({})),
              ).pipe(
                Effect.flip,
                Effect.map((refused) =>
                  Predicate.isTagged(refused, 'StaleVersion') ? 'stale' : refused.message,
                ),
              )
            const edited = yield* Review.use((review) =>
              review.feedbackEdit(one.id, 'The export button is grey.', 1, FeedbackUser.make({})),
            )
            const stale = yield* edit('Again.', 1)
            yield* moveRound(missionId, 1, 'grilling')
            const taken = yield* edit('Too late.', 2)
            const state = feedbackOf(yield* stateOf(missionId), one.id)
            return { edited, stale, taken, state }
          }),
        ),
      )
      expect(seen.edited.version).toBe(2)
      expect(seen.edited.versions.map((one) => one.body)).toEqual([
        'The button is grey.',
        'The export button is grey.',
      ])
      expect(seen.stale).toBe('stale')
      expect(seen.taken).toBe('This feedback was taken by a Fix: it is read-only now.')
      expect(seen.state.state).toBe('in_round')
    },
    SLOW,
  )
})

describe('Resolving and following up', () => {
  test(
    'resolve is refused for a non-author and for a waiting feedback; a follow-up links to the original, which stays addressed',
    async () => {
      const { run } = engine()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { missionId } = yield* launchedOverBoth()
            yield* inReview(missionId)
            const mine = yield* add(missionId, remark('The export button is grey.'))
            const theirs = yield* add(
              missionId,
              remark('Rename the column.'),
              FeedbackForge.make({ login: 'octo' }),
            )
            const resolve = (id: string) =>
              Review.use((review) => review.feedbackResolve(id, FeedbackUser.make({}))).pipe(
                Effect.flip,
                Effect.map((refused) => refused.message),
              )
            const waiting = yield* resolve(mine.id)
            yield* moveRound(missionId, 1, 'grilling')
            yield* moveRound(missionId, 1, 'building')
            yield* Review.use((review) => review.answer(mine.id, 'The button is blue now.'))
            yield* Review.use((review) => review.answer(theirs.id, 'Renamed.'))
            yield* moveRound(missionId, 1, 'answered')
            const notAuthor = yield* resolve(theirs.id)
            const follow = yield* Review.use((review) =>
              review.feedbackFollowUp(
                mine.id,
                'It is blue but too light.',
                [],
                FeedbackUser.make({}),
              ),
            )
            const afterFollow = yield* stateOf(missionId)
            return {
              waiting,
              notAuthor,
              follow,
              original: feedbackOf(afterFollow, mine.id),
              rounds: afterFollow.rounds,
            }
          }),
        ),
      )
      expect(seen.waiting).toBe(
        'This feedback is waiting: it is resolved once the agent addressed it.',
      )
      expect(seen.notAuthor).toBe('Only its author resolves a feedback.')
      expect(seen.follow).toMatchObject({ round: 2, state: 'waiting', followsUp: seen.original.id })
      expect(seen.original).toMatchObject({
        state: 'addressed',
        answer: 'The button is blue now.',
        followedBy: [seen.follow.id],
      })
      expect(seen.rounds.map((one) => [one.number, one.state])).toEqual([
        [1, 'answered'],
        [2, 'collecting'],
      ])
    },
    SLOW,
  )
})

describe('The engine says what the user may settle', () => {
  test(
    'a feedback tells whether the user may withdraw it and resolve it, by its author and where it stands',
    async () => {
      const { run } = engine()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { missionId } = yield* launchedOverBoth()
            yield* inReview(missionId)
            const mine = yield* add(missionId, remark('The export button is grey.'))
            const theirs = yield* add(
              missionId,
              remark('Rename the column.'),
              FeedbackForge.make({ login: 'octo' }),
            )
            const taken = yield* Review.use((review) =>
              review.forgeFeedback(missionId, {
                author: FeedbackForge.make({ login: 'octo' }),
                kind: 'remark',
                body: 'Add a limit.',
                source: 'forge:tc-1',
                anchor: null,
              }),
            )
            const flags = (id: string) =>
              Effect.map(stateOf(missionId), (state) => {
                const one = feedbackOf(state, id)
                return [one.state, one.withdrawable, one.resolvable]
              })
            const waiting = yield* flags(mine.id)
            const foreign = yield* flags(theirs.id)
            const takenIn = yield* flags(taken.id)
            yield* moveRound(missionId, 1, 'grilling')
            yield* moveRound(missionId, 1, 'building')
            yield* Review.use((review) => review.answer(mine.id, 'The button is blue now.'))
            yield* Review.use((review) => review.answer(taken.id, 'Limited.'))
            yield* Review.use((review) => review.answer(theirs.id, 'Renamed.'))
            yield* moveRound(missionId, 1, 'answered')
            const addressed = yield* flags(mine.id)
            const foreignAddressed = yield* flags(theirs.id)
            const takenAddressed = yield* flags(taken.id)
            yield* Review.use((review) => review.feedbackResolve(mine.id, FeedbackUser.make({})))
            const resolved = yield* flags(mine.id)
            yield* Review.use((review) => review.feedbackWithdraw(taken.id, FeedbackUser.make({})))
            const withdrawn = yield* flags(taken.id)
            return {
              waiting,
              foreign,
              takenIn,
              addressed,
              foreignAddressed,
              takenAddressed,
              resolved,
              withdrawn,
            }
          }),
        ),
      )
      expect(seen).toEqual({
        waiting: ['waiting', true, false],
        foreign: ['waiting', false, false],
        takenIn: ['waiting', true, false],
        addressed: ['addressed', true, true],
        foreignAddressed: ['addressed', false, false],
        takenAddressed: ['addressed', true, true],
        resolved: ['resolved', false, false],
        withdrawn: ['withdrawn', false, false],
      })
    },
    SLOW,
  )
})

describe('Rounds as data', () => {
  test(
    'a round whose feedback were all withdrawn while it built closes as it is answered',
    async () => {
      const { run } = engine()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { missionId } = yield* launchedOverBoth()
            yield* inReview(missionId)
            const one = yield* add(missionId, remark('The export button is grey.'))
            yield* moveRound(missionId, 1, 'grilling')
            yield* moveRound(missionId, 1, 'building')
            yield* Review.use((review) => review.feedbackWithdraw(one.id, FeedbackUser.make({})))
            yield* moveRound(missionId, 1, 'answered')
            return (yield* stateOf(missionId)).rounds.map((round) => round.state)
          }),
        ),
      )
      expect(seen).toEqual(['closed'])
    },
    SLOW,
  )

  test(
    'feedback added while a round builds goes to the next round, which it creates',
    async () => {
      const { run } = engine()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { missionId } = yield* launchedOverBoth()
            yield* inReview(missionId)
            yield* add(missionId, remark('The export button is grey.'))
            yield* moveRound(missionId, 1, 'grilling')
            yield* moveRound(missionId, 1, 'building')
            yield* moved(missionId, 'fix')
            const later = yield* add(missionId, remark('And the footer overlaps.'))
            const back = yield* moveRound(missionId, 1, 'collecting').pipe(
              Effect.flip,
              Effect.map((refused) => refused.message),
            )
            const second = yield* moveRound(missionId, 2, 'grilling').pipe(
              Effect.flip,
              Effect.map((refused) => refused.message),
            )
            return { later, back, second, rounds: (yield* stateOf(missionId)).rounds }
          }),
        ),
      )
      expect(seen.later.round).toBe(2)
      expect(seen.back).toBe('round 1 is building: it cannot become collecting')
      expect(seen.second).toBe('round 1 is building: round 2 waits for it to be answered')
      expect(seen.rounds.map((one) => [one.number, one.state])).toEqual([
        [1, 'building'],
        [2, 'collecting'],
      ])
    },
    SLOW,
  )

  test(
    'an answered round closes when all its feedback is resolved or withdrawn, when the next Fix starts, or at Ship',
    async () => {
      const { run } = engine()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { missionId } = yield* launchedOverBoth()
            yield* inReview(missionId)
            const user = FeedbackUser.make({})
            const roundOf = (number: number) =>
              Effect.map(
                stateOf(missionId),
                (state) => state.rounds.find((one) => one.number === number)?.state,
              )
            // Round 1: resolved and withdrawn close it.
            const a = yield* add(missionId, remark('One.'))
            const b = yield* add(missionId, remark('Two.'))
            yield* moveRound(missionId, 1, 'grilling')
            yield* moveRound(missionId, 1, 'building')
            yield* Review.use((review) => review.answer(a.id, 'Done.'))
            yield* Review.use((review) => review.answer(b.id, 'Done.'))
            yield* moveRound(missionId, 1, 'answered')
            yield* Review.use((review) => review.feedbackResolve(a.id, user))
            const halfway = yield* roundOf(1)
            yield* Review.use((review) => review.feedbackWithdraw(b.id, user))
            const resolved = yield* roundOf(1)
            // Round 2: the next Fix closes it, its addressed feedback staying addressed.
            const c = yield* add(missionId, remark('Three.'))
            yield* moveRound(missionId, 2, 'grilling')
            yield* moveRound(missionId, 2, 'building')
            yield* Review.use((review) => review.answer(c.id, 'Done.'))
            yield* moveRound(missionId, 2, 'answered')
            yield* add(missionId, remark('Four.'))
            yield* moveRound(missionId, 3, 'grilling')
            const nextFix = yield* roundOf(2)
            const stays = feedbackOf(yield* stateOf(missionId), c.id).state
            // Round 4 collecting a question: Ship closes every round.
            yield* moveRound(missionId, 3, 'building')
            yield* moveRound(missionId, 3, 'answered')
            yield* add(missionId, { kind: 'question', body: 'Why?', anchor: null, images: [] })
            yield* moved(missionId, 'ship')
            yield* until(
              Effect.map(stateOf(missionId), (state) =>
                state.rounds.every((one) => one.state === 'closed'),
              ),
            )
            return { halfway, resolved, nextFix, stays }
          }),
        ),
      )
      expect(seen).toEqual({
        halfway: 'answered',
        resolved: 'closed',
        nextFix: 'closed',
        stays: 'addressed',
      })
    },
    SLOW,
  )
})

describe('Ship closes the rounds, even across a stop', () => {
  test(
    'Ship closes the rounds even when the checkpoint of the round it leaves cannot be taken',
    async () => {
      let broken = false
      const failing = checkpointsFailing(() => broken)
      const { run } = engine(undefined, undefined, failing.wrap)
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { missionId } = yield* launchedOverBoth()
            // Git refuses every checkpoint from the entry into Review on, Ship's too.
            broken = true
            yield* moved(missionId, 'endBuilding')
            yield* add(missionId, { kind: 'question', body: 'Why?', anchor: null, images: [] })
            yield* moved(missionId, 'ship')
            yield* until(
              Effect.map(stateOf(missionId), (state) =>
                state.rounds.every((one) => one.state === 'closed'),
              ),
              30_000,
            )
            const state = yield* stateOf(missionId)
            return { rounds: state.rounds.map((one) => one.state), checkpoints: state.checkpoints }
          }),
        ),
      )
      expect(seen.rounds).toEqual(['closed'])
      expect(seen.checkpoints).toEqual([])
    },
    SLOW,
  )

  test(
    'an engine stopped between Ship and the closing of the rounds closes them at its next start',
    async () => {
      const { run } = engine()
      const missionId = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { missionId: launchedId } = yield* launchedOverBoth()
            yield* inReview(launchedId)
            yield* add(launchedId, { kind: 'question', body: 'Why?', anchor: null, images: [] })
            // Ship committed, its event never followed: what an engine stopped right after leaves.
            const database = yield* Database
            yield* database
              .update(missions)
              .set({ stage: 'shipping' })
              .where(eq(missions.id, launchedId))
            return launchedId
          }),
        ),
      )
      const { run: again } = engine()
      const seen = await again(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            yield* until(
              Effect.map(stateOf(missionId), (state) =>
                state.rounds.every((one) => one.state === 'closed'),
              ),
              30_000,
            )
            return (yield* stateOf(missionId)).rounds.map((one) => one.state)
          }),
        ),
      )
      expect(seen).toEqual(['closed'])
    },
    SLOW,
  )
})

describe('Code comments follow their lines', () => {
  test(
    'a code comment on lines 10–12; the file then changes above them: moved with the new range; the lines themselves change: outdated with the original excerpt; commentedVersion returns the old file after the Workspace is deleted',
    async () => {
      const { run } = engine()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { missionId, api, web } = yield* launchedOverBoth()
            yield* inReview(missionId)
            const one = yield* add(missionId, codeOn(10, 12))
            const live = () =>
              Effect.map(stateOf(missionId), (state) => liveOf(feedbackOf(state, one.id)))
            const first = yield* live()
            writeFileSync(join(api, 'notes.ts'), textOf(['import a', 'import b', ...NOTES]))
            const above = yield* live()
            writeFileSync(
              join(api, 'notes.ts'),
              textOf(NOTES.map((line) => (line === 'line 11' ? 'line eleven' : line))),
            )
            const changed = yield* stateOf(missionId)
            yield* workspaceGone([api, web])
            const version = yield* Review.use((review) => review.commentedVersion(one.id))
            return {
              first,
              above,
              changed: feedbackOf(changed, one.id),
              version,
              gone: yield* live(),
            }
          }),
        ),
      )
      expect(seen.first).toEqual(
        AnchorCurrent.make({ path: 'notes.ts', lines: { start: 10, end: 12 } }),
      )
      expect(seen.above).toEqual(
        AnchorMoved.make({ path: 'notes.ts', lines: { start: 12, end: 14 } }),
      )
      const anchor = seen.changed.anchor
      expect(
        anchor !== null &&
          Predicate.isTagged(anchor, 'Code') &&
          Predicate.isTagged(anchor.live, 'Outdated'),
      ).toBe(true)
      expect(anchor !== null && Predicate.isTagged(anchor, 'Code') ? anchor.excerpt : null).toEqual(
        {
          before: ['line 7', 'line 8', 'line 9'],
          lines: ['line 10', 'line 11', 'line 12'],
          after: ['line 13', 'line 14', 'line 15'],
          start: 10,
        },
      )
      const content = seen.version.content
      expect(Predicate.isTagged(content, 'DiffText') ? content.text : null).toBe(textOf(NOTES))
      expect(seen.version.excerpt?.lines).toEqual(['line 10', 'line 11', 'line 12'])
      expect(seen.gone).toEqual(AnchorUnread.make({ why: 'the Workspace cannot be read' }))
    },
    SLOW,
  )

  test(
    'a comment that cannot be re-anchored is kept, outdated, with its excerpt: never lost',
    async () => {
      const { run } = engine()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { missionId, api } = yield* launchedOverBoth()
            yield* inReview(missionId)
            const line = yield* add(missionId, codeOn(10, 12))
            const whole = yield* add(missionId, {
              ...codeOn(1, 1),
              anchor: { ...codeOn(1, 1).anchor, lines: null },
            })
            rmSync(join(api, 'notes.ts'))
            const state = yield* stateOf(missionId)
            return { line: feedbackOf(state, line.id), whole: feedbackOf(state, whole.id) }
          }),
        ),
      )
      expect(liveOf(seen.line)).toEqual(AnchorOutdated.make({ why: 'the file was deleted' }))
      expect(liveOf(seen.whole)).toEqual(AnchorOutdated.make({ why: 'the file was deleted' }))
      expect(seen.line.body).toBe('These lines read badly.')
    },
    SLOW,
  )

  test(
    'a comment is re-anchored once per version of the Workspace, not at each read of the Review',
    async () => {
      let computed = 0
      const { run } = engine((at) =>
        at === 'reanchor'
          ? Effect.sync(() => {
              computed += 1
            })
          : Effect.void,
      )
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { missionId, api } = yield* launchedOverBoth()
            yield* inReview(missionId)
            const one = yield* add(missionId, codeOn(10, 12))
            const added = computed
            yield* stateOf(missionId)
            yield* stateOf(missionId)
            const read = computed
            writeFileSync(join(api, 'notes.ts'), textOf(['new 1', ...NOTES]))
            const live = liveOf(feedbackOf(yield* stateOf(missionId), one.id))
            yield* stateOf(missionId)
            return { added, read, changed: computed, live }
          }),
        ),
      )
      expect(seen.added).toBe(1)
      expect(seen.read).toBe(1)
      expect(seen.changed).toBe(2)
      expect(seen.live).toEqual(
        AnchorMoved.make({ path: 'notes.ts', lines: { start: 11, end: 13 } }),
      )
    },
    SLOW,
  )

  test(
    'a whole-file comment follows its file when renamed',
    async () => {
      const { run } = engine()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { missionId, api } = yield* launchedOverBoth()
            yield* inReview(missionId)
            const whole = yield* add(missionId, {
              ...codeOn(1, 1),
              anchor: { ...codeOn(1, 1).anchor, lines: null },
            })
            rmSync(join(api, 'notes.ts'))
            writeFileSync(join(api, 'remarks.ts'), textOf(NOTES))
            return liveOf(feedbackOf(yield* stateOf(missionId), whole.id))
          }),
        ),
      )
      expect(seen).toEqual(AnchorMoved.make({ path: 'remarks.ts', lines: null }))
    },
    SLOW,
  )

  test(
    'a whole-file comment on a file that changes, not renamed, stays current',
    async () => {
      const { run } = engine()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { missionId, api } = yield* launchedOverBoth()
            yield* inReview(missionId)
            const whole = yield* add(missionId, {
              ...codeOn(1, 1),
              anchor: { ...codeOn(1, 1).anchor, lines: null },
            })
            writeFileSync(join(api, 'notes.ts'), textOf([...NOTES, 'line 21']))
            return liveOf(feedbackOf(yield* stateOf(missionId), whole.id))
          }),
        ),
      )
      expect(seen).toEqual(AnchorCurrent.make({ path: 'notes.ts', lines: null }))
    },
    SLOW,
  )

  test(
    'an anchor is refused on a repository not in the Workspace, a path not in the diff, a range that is not one, or a Spec item that does not exist',
    async () => {
      const { run } = engine()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { missionId } = yield* launchedOverBoth()
            yield* inReview(missionId)
            const refused = (asked: Parameters<typeof add>[1]) =>
              add(missionId, asked).pipe(
                Effect.flip,
                Effect.map((refusal) => refusal.message),
              )
            const base = codeOn(10, 12)
            return [
              yield* refused({ ...base, anchor: { ...base.anchor, repository: 'mobile' } }),
              yield* refused({ ...base, anchor: { ...base.anchor, path: 'README.md' } }),
              yield* refused(codeOn(12, 10)),
              yield* refused(codeOn(19, 21)),
              yield* refused({
                kind: 'remark',
                body: 'R9 is wrong.',
                anchor: SpecAnchorAsked.make({ item: 'R9' }),
                images: [],
              }),
              yield* refused({ kind: 'code', body: 'No anchor.', anchor: null, images: [] }),
              yield* refused({ kind: 'remark', body: '   ', anchor: null, images: [] }),
            ]
          }),
        ),
      )
      expect(seen).toEqual([
        'The Workspace has no repository mobile: it has api, web.',
        'README.md is not in the changes of api.',
        'lines 12–10 are not a range',
        'lines 19–21 go beyond the file, which has 20 lines',
        'R9 is not a requirement or a scenario of the frozen Spec.',
        'A comment on the code is anchored on a file, a line or a range.',
        'a feedback is never empty: write what you found',
      ])
    },
    SLOW,
  )

  test(
    'a refused anchor holds no snapshot for the comment it never became',
    async () => {
      const { run } = engine()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { missionId } = yield* launchedOverBoth()
            yield* inReview(missionId)
            const refused = (asked: Parameters<typeof add>[1]) =>
              add(missionId, asked).pipe(Effect.flip, Effect.asVoid)
            yield* refused(codeOn(19, 21))
            yield* refused({ ...codeOn(1, 1), anchor: { ...codeOn(1, 1).anchor, path: 'nope.ts' } })
            const kept = yield* add(missionId, codeOn(10, 12))
            const refs = (yield* Snapshots.use((snapshots) =>
              snapshots.diagnose(missionId),
            )).flatMap((repository) => repository.refs.filter((ref) => ref.includes('/feedback/')))
            return { refs, kept: kept.id }
          }),
        ),
      )
      expect(seen.refs).toHaveLength(1)
      expect(seen.refs[0]).toContain(seen.kept)
    },
    SLOW,
  )

  test(
    'a Spec anchor on a requirement or a scenario of the frozen Spec is taken',
    async () => {
      const { run } = engine()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { missionId } = yield* launchedOverBoth()
            yield* inReview(missionId)
            const one = yield* add(missionId, {
              kind: 'remark',
              body: 'R1.S2 reads oddly.',
              anchor: SpecAnchorAsked.make({ item: 'R1.S2' }),
              images: [],
            })
            return one.anchor
          }),
        ),
      )
      expect(seen).toEqual(SpecAnchorView.make({ item: 'R1.S2' }))
    },
    SLOW,
  )
})

describe('Changes made outside Hemera', () => {
  test(
    'a change made outside Hemera stays marked until the next Review checkpoint takes it in (open question 29)',
    async () => {
      const { run } = engine()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { missionId, api } = yield* launchedOverBoth()
            const outside = yield* OutsideChanges
            const marked = (path: string) =>
              Effect.map(
                Diffs.use((diffs) => diffs.live(missionId)),
                (diff) =>
                  diff.repositories
                    .find((one) => one.repository === 'api')
                    ?.files.find((file) => file.path === path)?.changedOutside ?? null,
              )
            writeFileSync(join(api, 'early.md'), 'mine\n')
            yield* outside.compare(missionId, null)
            const inBuilding = yield* marked('early.md')
            yield* inReview(missionId)
            const afterEntry = yield* marked('early.md')
            writeFileSync(join(api, 'late.md'), 'mine too\n')
            yield* outside.compare(missionId, null)
            const inReviewMarked = yield* marked('late.md')
            const heard = yield* Ref.make<ReadonlyArray<DiffChange>>([])
            const listening = yield* Effect.forkChild(
              Stream.runForEach(
                Stream.unwrap(Diffs.use((diffs) => Effect.succeed(diffs.changes(missionId)))),
                (change) => Ref.update(heard, (all) => [...all, change]),
              ),
            )
            yield* add(missionId, remark('The export button is grey.'))
            yield* moveRound(missionId, 1, 'grilling')
            yield* moveRound(missionId, 1, 'building')
            yield* moved(missionId, 'fix')
            yield* moved(missionId, 'endBuilding')
            // The window is told, with no other change in the Workspace to move the diff.
            yield* until(
              Effect.map(Ref.get(heard), (all) =>
                all.some((change) =>
                  change.files.some(
                    (file) => file.path === 'late.md' && file.changedOutside === null,
                  ),
                ),
              ),
              30_000,
            )
            yield* Fiber.interrupt(listening)
            return {
              inBuilding,
              afterEntry,
              inReviewMarked,
              afterRound: yield* marked('late.md'),
            }
          }),
        ),
      )
      expect(seen.inBuilding).toEqual(expect.any(String))
      expect(seen.afterEntry).toBeNull()
      expect(seen.inReviewMarked).toEqual(expect.any(String))
      expect(seen.afterRound).toBeNull()
    },
    SLOW,
  )

  test(
    'a change made outside Hemera (written by the test, flagged by B10) re-anchors and blocks nothing',
    async () => {
      const { run } = engine()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { missionId, api } = yield* launchedOverBoth()
            yield* inReview(missionId)
            const one = yield* add(missionId, codeOn(10, 12))
            writeFileSync(join(api, 'notes.ts'), textOf(['// by hand', ...NOTES]))
            const outside = yield* OutsideChanges
            yield* outside.compare(missionId, null)
            const flagged = (yield* outside.list(missionId)).flatMap((found) =>
              found.changes.map((change) => change.path),
            )
            const after = yield* add(missionId, remark('Still writable.'))
            const state = yield* stateOf(missionId)
            return { flagged, live: liveOf(feedbackOf(state, one.id)), after: after.state }
          }),
        ),
      )
      expect(seen.flagged).toContain('notes.ts')
      expect(seen.live).toEqual(
        AnchorMoved.make({ path: 'notes.ts', lines: { start: 11, end: 13 } }),
      )
      expect(seen.after).toBe('waiting')
    },
    SLOW,
  )

  test(
    'a change landing while a comment is written re-anchors it from the version it was written on',
    async () => {
      const reached = Effect.runSync(Deferred.make<void>())
      const go = Effect.runSync(Deferred.make<void>())
      const { run } = engine((at) =>
        at === 'anchor'
          ? Effect.andThen(Deferred.succeed(reached, undefined), Deferred.await(go))
          : Effect.void,
      )
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { missionId, api } = yield* launchedOverBoth()
            yield* inReview(missionId)
            const adding = yield* Effect.forkChild(add(missionId, codeOn(10, 12)))
            yield* Deferred.await(reached)
            writeFileSync(join(api, 'notes.ts'), textOf(['// meanwhile', ...NOTES]))
            yield* Deferred.succeed(go, undefined)
            const one = yield* Fiber.join(adding)
            return liveOf(feedbackOf(yield* stateOf(missionId), one.id))
          }),
        ),
      )
      expect(seen).toEqual(AnchorMoved.make({ path: 'notes.ts', lines: { start: 11, end: 13 } }))
    },
    SLOW,
  )
  test(
    'a change landing while the user writes a comment: it lands on the lines the user saw, or is refused when they changed',
    async () => {
      const { run } = engine()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { missionId, api } = yield* launchedOverBoth()
            yield* inReview(missionId)
            const shownTree = Effect.map(
              Diffs.use((diffs) => diffs.live(missionId)),
              (diff) => diff.repositories.find((one) => one.repository === 'api')?.tree ?? null,
            )
            const seenTree = yield* shownTree
            // The user selects lines 10–12 and writes; meanwhile their editor adds two lines on top.
            writeFileSync(join(api, 'notes.ts'), textOf(['// one', '// two', ...NOTES]))
            const asked = codeOn(10, 12)
            const one = yield* add(missionId, {
              ...asked,
              anchor: { ...asked.anchor, tree: seenTree },
            })
            const view = feedbackOf(yield* stateOf(missionId), one.id)
            // Seen again, then the selected lines themselves change before the comment is sent.
            const again = yield* shownTree
            writeFileSync(
              join(api, 'notes.ts'),
              textOf([
                '// one',
                '// two',
                ...NOTES.map((line) => line.replace('line 11', 'eleven')),
              ]),
            )
            const refused = yield* add(missionId, {
              ...asked,
              anchor: { ...asked.anchor, tree: again },
            }).pipe(
              Effect.flip,
              Effect.map((failure) => failure.message),
            )
            return {
              seenTree,
              live: liveOf(view),
              excerpt:
                view.anchor !== null && Predicate.isTagged(view.anchor, 'Code')
                  ? view.anchor.excerpt?.lines
                  : null,
              refused,
            }
          }),
        ),
      )
      expect(seen.seenTree).toEqual(expect.any(String))
      expect(seen.excerpt).toEqual(['line 10', 'line 11', 'line 12'])
      expect(seen.live).toEqual(
        AnchorCurrent.make({ path: 'notes.ts', lines: { start: 12, end: 14 } }),
      )
      expect(seen.refused).toBe('The lines changed while you wrote: select them again.')
    },
    SLOW,
  )
})

describe('Images', () => {
  test(
    'images: a PNG accepted and deduplicated on a second add; A8’s refusals (a GIF, an 11 MB PNG) reach the caller unchanged',
    async () => {
      const { run } = engine()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { missionId } = yield* launchedOverBoth()
            yield* inReview(missionId)
            const imageAdd = (name: string, bytes: Uint8Array) =>
              Review.use((review) => review.imageAdd(missionId, name, bytes))
            const refused = (name: string, bytes: Uint8Array) =>
              imageAdd(name, bytes).pipe(
                Effect.flip,
                Effect.map((refusal) => refusal.message),
              )
            const first = yield* imageAdd('grey-button.png', PNG)
            const second = yield* imageAdd('again.png', PNG)
            const gif = yield* refused(
              'spinner.gif',
              Buffer.from('GIF89a\u0001\u0000\u0001\u0000', 'latin1'),
            )
            const large = yield* refused(
              'huge.png',
              Buffer.concat([PNG, Buffer.alloc(11 * 1024 * 1024)]),
            )
            const text = yield* refused('notes.png', Buffer.from('not an image'))
            const one = yield* add(missionId, {
              ...remark('See the grey button.'),
              images: [first.evidenceId],
            })
            const key = yield* missionKeyOf(missionId)
            const files = readdirSync(join(missionFolder(data, key), 'evidence'))
            return { first, second, gif, large, text, images: one.images, files }
          }),
        ),
      )
      expect(seen.first).toMatchObject({ size: PNG.length, width: 640, height: 480 })
      expect(seen.second.sha256).toBe(seen.first.sha256)
      expect(seen.files).toEqual([`${seen.first.sha256}.png`])
      expect(seen.gif).toBe('a gif is not accepted: png, jpeg or webp')
      expect(seen.large).toBe('the image is 11 MB; the limit is 10 MB')
      expect(seen.text).toBe('this file is not a png, jpeg or webp image')
      expect(seen.images.map((one) => one.evidenceId)).toEqual([seen.first.evidenceId])
    },
    SLOW,
  )

  test(
    'an image given twice to one feedback is refused, never delivered twice',
    async () => {
      const { run } = engine()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { missionId } = yield* launchedOverBoth()
            yield* inReview(missionId)
            const image = yield* Review.use((review) => review.imageAdd(missionId, 'grey.png', PNG))
            return yield* add(missionId, {
              ...remark('The button is grey.'),
              images: [image.evidenceId, image.evidenceId],
            }).pipe(
              Effect.flip,
              Effect.map((failure) => failure.message),
            )
          }),
        ),
      )
      expect(seen).toBe('An image is attached once: it was given twice.')
    },
    SLOW,
  )

  test(
    'an image of a feedback reaches an agent as an image block when it takes images, by its path otherwise',
    async () => {
      const { run } = engine()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { missionId } = yield* launchedOverBoth()
            yield* inReview(missionId)
            const image = yield* Review.use((review) => review.imageAdd(missionId, 'grey.png', PNG))
            const one = yield* add(missionId, {
              ...remark('See the grey button.'),
              images: [image.evidenceId],
            })
            const key = yield* missionKeyOf(missionId)
            return {
              path: join(missionFolder(data, key), 'evidence', `${image.sha256}.png`),
              blocks: yield* Review.use((review) => review.blocks([one.id], true)),
              named: yield* Review.use((review) => review.blocks([one.id], false)),
            }
          }),
        ),
      )
      expect(seen.blocks.map((block) => Predicate.isTagged(block, 'Text'))).toEqual([true, false])
      expect(seen.blocks[1]).toEqual(
        ImageBlock.make({ mimeType: 'image/png', data: PNG.toString('base64') }),
      )
      expect(seen.named.map((block) => Predicate.isTagged(block, 'Text'))).toEqual([true])
      const said = seen.named[0]
      expect(said !== undefined && Predicate.isTagged(said, 'Text') ? said.text : '').toContain(
        seen.path,
      )
    },
    SLOW,
  )
})

describe('The agents do not write during Review', () => {
  test(
    'a mission whose stage cannot be read holds fs_write, fs_edit and commands_run before any judge: the hold fails closed',
    async () => {
      let armed = false
      const verdicts = verdictsSaying(() => ALLOW)
      const { run } = sessionsEngine(data, builderAgents, {
        roles: [HELPER],
        tools: { home: work, verdicts: verdicts.layer },
        building: { outside: QUIET_TIMERS },
        database: stageUnreadable(() => armed),
      })
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { missionId } = yield* launchedOverBoth()
            const { grantId } = yield* builderOf(missionId)
            const judged = verdicts.asked.length
            armed = true
            const written = yield* callTool(grantId, 'fs_write', {
              repository: 'api',
              path: 'held.md',
              content: 'no\n',
            })
            const read = yield* callTool(grantId, 'fs_read', {
              repository: 'api',
              path: 'notes.ts',
            })
            armed = false
            return { written, read: read.ok, judged: verdicts.asked.length - judged }
          }),
        ),
      )
      expect(seen.written.ok).toBe(false)
      expect(seen.written.text).toBe(`refused: ${STAGE_UNREAD}`)
      expect(seen.read).toBe(true)
      expect(seen.judged).toBe(1)
    },
    SLOW,
  )

  test(
    'during Review, fs_write, fs_edit and commands_run from any mission session are refused with the reason, before any judge; fs_read goes through; in Building · round N they are not held',
    async () => {
      const verdicts = verdictsSaying(() => ALLOW)
      const { run } = engine(undefined, verdicts)
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { missionId, api } = yield* launchedOverBoth()
            const { grantId } = yield* builderOf(missionId)
            yield* inReview(missionId)
            const judged = verdicts.asked.length
            const write = yield* callTool(grantId, 'fs_write', {
              repository: 'api',
              path: 'held.ts',
              content: 'x\n',
            })
            const edit = yield* callTool(grantId, 'fs_edit', {
              repository: 'api',
              path: 'notes.ts',
              old: 'line 1',
              new: 'line one',
            })
            const command = yield* callTool(grantId, 'commands_run', { command: 'test' })
            const judgedAfter = verdicts.asked.length
            const read = yield* callTool(grantId, 'fs_read', {
              repository: 'api',
              path: 'notes.ts',
            })
            yield* add(missionId, remark('Fix it.'))
            yield* moveRound(missionId, 1, 'grilling')
            yield* moveRound(missionId, 1, 'building')
            yield* moved(missionId, 'fix')
            const inRound = yield* callTool(grantId, 'fs_write', {
              repository: 'api',
              path: 'held.ts',
              content: 'x\n',
            })
            return {
              write,
              edit,
              command,
              judged,
              judgedAfter,
              read,
              inRound,
              written: existsSync(join(api, 'held.ts')),
            }
          }),
        ),
      )
      for (const refused of [seen.write, seen.edit, seen.command]) {
        expect(refused).toMatchObject({ ok: false, refused: true, text: `refused: ${REVIEW_HOLD}` })
      }
      expect(seen.judgedAfter).toBe(seen.judged)
      expect(seen.read.ok).toBe(true)
      expect(seen.inRound).toMatchObject({ ok: true })
      expect(seen.written).toBe(true)
    },
    SLOW,
  )

  test(
    'fs_read of an evidence PNG answers an image block; of another mission’s evidence, a refusal naming the place',
    async () => {
      const { run } = engine()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { missionId, projectId } = yield* launchedOverBoth()
            const { grantId } = yield* builderOf(missionId)
            const image = yield* Review.use((review) => review.imageAdd(missionId, 'grey.png', PNG))
            const own = join(
              missionFolder(data, yield* missionKeyOf(missionId)),
              'evidence',
              `${image.sha256}.png`,
            )
            const other = yield* createMission({
              projectId,
              idea: { sentence: 'Another one', ticket: null },
            })
            const theirs = yield* putEvidence({
              missionId: other.id,
              content: { bytes: PNG },
              name: 'theirs.png',
              about: null,
              author: UserAuthor.make({}),
            })
            const otherFolder = missionFolder(data, yield* missionKeyOf(other.id))
            const path = join(otherFolder, 'evidence', `${theirs.sha256}.png`)
            return {
              own: yield* callTool(grantId, 'fs_read', { path: own }),
              other: yield* callTool(grantId, 'fs_read', { path }),
              otherKey: yield* missionKeyOf(other.id),
            }
          }),
        ),
      )
      expect(seen.own).toMatchObject({
        ok: true,
        image: { mimeType: 'image/png', data: PNG.toString('base64') },
      })
      expect(seen.other.ok).toBe(false)
      expect(seen.other.text).toContain(join('missions', seen.otherKey))
    },
    SLOW,
  )
  test(
    'fs_read of a hard link in its own evidence folder to another mission’s image is refused: only what it recorded is served',
    async () => {
      const { run } = engine()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { missionId, projectId } = yield* launchedOverBoth()
            const { grantId } = yield* builderOf(missionId)
            yield* Review.use((review) => review.imageAdd(missionId, 'grey.png', PNG))
            const other = yield* createMission({
              projectId,
              idea: { sentence: 'Another one', ticket: null },
            })
            const theirs = yield* putEvidence({
              missionId: other.id,
              content: { bytes: OTHER_PNG },
              name: 'theirs.png',
              about: null,
              author: UserAuthor.make({}),
            })
            const own = join(missionFolder(data, yield* missionKeyOf(missionId)), 'evidence')
            // A hard link has a real path of its own: no link check sees it.
            linkSync(
              join(
                missionFolder(data, yield* missionKeyOf(other.id)),
                'evidence',
                `${theirs.sha256}.png`,
              ),
              join(own, 'hard.png'),
            )
            return yield* callTool(grantId, 'fs_read', { path: join(own, 'hard.png') })
          }),
        ),
      )
      expect(seen.ok).toBe(false)
      expect(seen).not.toHaveProperty('image')
      expect(seen.text).toContain('refused')
    },
    SLOW,
  )

  test(
    'fs_read of its own evidence whose file was replaced since it was recorded is refused, never served',
    async () => {
      const { run } = engine()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { missionId } = yield* launchedOverBoth()
            const { grantId } = yield* builderOf(missionId)
            const image = yield* Review.use((review) => review.imageAdd(missionId, 'grey.png', PNG))
            const path = join(
              missionFolder(data, yield* missionKeyOf(missionId)),
              'evidence',
              `${image.sha256}.png`,
            )
            writeFileSync(path, OTHER_PNG)
            return yield* callTool(grantId, 'fs_read', { path })
          }),
        ),
      )
      expect(seen.ok).toBe(false)
      expect(seen).not.toHaveProperty('image')
      expect(seen.text).toContain('changed on disk')
    },
    SLOW,
  )

  test(
    'fs_read through a link in its own evidence folder to another mission’s image is refused, and the image never delivered',
    async () => {
      const { run } = engine()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { missionId, projectId } = yield* launchedOverBoth()
            const { grantId } = yield* builderOf(missionId)
            yield* Review.use((review) => review.imageAdd(missionId, 'grey.png', PNG))
            const other = yield* createMission({
              projectId,
              idea: { sentence: 'Another one', ticket: null },
            })
            const theirs = yield* putEvidence({
              missionId: other.id,
              content: { bytes: PNG },
              name: 'theirs.png',
              about: null,
              author: UserAuthor.make({}),
            })
            // A junction: a link Windows makes without privileges, as an agent's command could.
            const linked = join(
              missionFolder(data, yield* missionKeyOf(missionId)),
              'evidence',
              'linked',
            )
            symlinkSync(
              join(missionFolder(data, yield* missionKeyOf(other.id)), 'evidence'),
              linked,
              'junction',
            )
            return yield* callTool(grantId, 'fs_read', {
              path: join(linked, `${theirs.sha256}.png`),
            })
          }),
        ),
      )
      expect(seen.ok).toBe(false)
      expect(seen).not.toHaveProperty('image')
      expect(seen.text).toContain('refused')
    },
    SLOW,
  )
})

describe('A refused manual proof', () => {
  test(
    'a manual proof refused through B6 becomes a remark of the collecting round',
    async () => {
      const { run } = engine()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { missionId } = yield* launchedOverBoth()
            yield* inReview(missionId)
            yield* judgeManual(missionId, 'R1.S1', 'refused', 'The CSV has no header row.')
            yield* until(Effect.map(stateOf(missionId), (state) => state.feedback.length > 0))
            return (yield* stateOf(missionId)).feedback
          }),
        ),
      )
      expect(seen).toHaveLength(1)
      expect(seen[0]).toMatchObject({
        kind: 'remark',
        body: 'The CSV has no header row.',
        author: FeedbackUser.make({}),
        round: 1,
        state: 'waiting',
        anchor: SpecAnchorView.make({ item: 'R1.S1' }),
      })
    },
    SLOW,
  )

  test(
    'a refusal the engine stopped before writing is written at its next start, once',
    async () => {
      const stuck = Effect.runSync(Deferred.make<void>())
      const { run } = engine((at) => (at === 'proof' ? Deferred.await(stuck) : Effect.void))
      const missionId = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { missionId: launchedId } = yield* launchedOverBoth()
            yield* inReview(launchedId)
            yield* judgeManual(launchedId, 'R1.S1', 'refused', 'No header.')
            return launchedId
          }),
        ),
      )
      const { run: again } = engine()
      const seen = await again(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            yield* until(
              Effect.map(stateOf(missionId), (state) => state.feedback.length > 0),
              30_000,
            )
            return (yield* stateOf(missionId)).feedback.map((one) => one.body)
          }),
        ),
      )
      expect(seen).toEqual(['No header.'])
      const { run: third } = engine()
      const still = await third(({ profile }) =>
        within(
          profile,
          Effect.map(stateOf(missionId), (state) => state.feedback.length),
        ),
      )
      expect(still).toBe(1)
    },
    SLOW,
  )
})

describe('Review survives a restart', () => {
  test(
    'a restart keeps rounds, feedback, anchors and images',
    async () => {
      const { run } = engine()
      const first = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { missionId } = yield* launchedOverBoth()
            yield* inReview(missionId)
            const image = yield* Review.use((review) => review.imageAdd(missionId, 'grey.png', PNG))
            yield* add(missionId, { ...remark('See the grey button.'), images: [image.evidenceId] })
            yield* add(missionId, codeOn(10, 12))
            return { missionId, state: yield* stateOf(missionId) }
          }),
        ),
      )
      const { run: again } = engine()
      const second = await again(({ profile }) => within(profile, stateOf(first.missionId)))
      expect(second).toEqual(first.state)
      expect(second.feedback).toHaveLength(2)
      const data2 = await again(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const database = yield* Database
            const rows = yield* database.select().from(memoryEvidence)
            const key = yield* missionKeyOf(first.missionId)
            return rows.map((row) =>
              existsSync(join(missionFolder(data, key), 'evidence', `${row.sha256}.png`)),
            )
          }),
        ),
      )
      expect(data2).toEqual([true])
    },
    SLOW,
  )
})

describe('What changes is told', () => {
  test(
    'review.changes tells each change of the mission’s Review with a growing sequence',
    async () => {
      const { run } = engine()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { missionId } = yield* launchedOverBoth()
            yield* inReview(missionId)
            // The stream starts with where the sequence stands: the test writes once it heard it.
            const listening = yield* Deferred.make<void>()
            const told = yield* Effect.forkChild(
              Stream.unwrap(Review.useSync((review) => review.changes(missionId))).pipe(
                Stream.tap(() => Deferred.succeed(listening, undefined)),
                Stream.take(3),
                Stream.runCollect,
              ),
            )
            yield* Deferred.await(listening)
            yield* add(missionId, remark('One.'))
            yield* add(missionId, remark('Two.'))
            return yield* Fiber.join(told)
          }),
        ),
      )
      const sequences = [...seen].map((one) => one.sequence)
      expect(sequences).toHaveLength(3)
      expect(sequences[1]).toBeGreaterThan(sequences[0] ?? Number.POSITIVE_INFINITY)
      expect(sequences[2]).toBeGreaterThan(sequences[1] ?? Number.POSITIVE_INFINITY)
    },
    SLOW,
  )
})
