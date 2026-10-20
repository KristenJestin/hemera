/**
 * What the suites of the team's comments share (R8): the engine with the fake agent of #32 as every
 * agent, Acme's `api` and `web` in temporary folders, a mission launched into Building over both and
 * moved into Review the way the end of a Building moves it, `api`'s remote named on a forge host
 * that never resolves and forced to GitHub there, and `gh` a fake alone on a `PATH` of its own
 * answering the comments the test writes for `api`'s pull request #7.
 *
 * Hemera's push of `api` is recorded as R6 records it: the pushes' row with the pull request read
 * last, and `delivery.pushed`, at a commit whose tree is a snapshot of the Workspace as it was. No
 * real forge, no network, no real profile.
 */

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { PullRequestStatus } from '@hemera/ipc'
import { and, asc, desc, eq } from 'drizzle-orm'
import { Effect, Schema } from 'effect'

import type { FakeScript } from '../src/engine/agents/fake.ts'
import { Snapshots } from '../src/engine/building/snapshots.ts'
import { ForgePort } from '../src/engine/forges/port.ts'
import { getMission, moveIn } from '../src/engine/missions.ts'
import { getProject } from '../src/engine/projects.ts'
import { Review } from '../src/engine/review/feedback.ts'
import { Sessions } from '../src/engine/sessions/service.ts'
import { Database } from '../src/engine/storage/database.ts'
import {
  buildingLaunches,
  buildings,
  deliveryPushes,
  workspaceRepositories,
} from '../src/engine/storage/schema.ts'
import { type TeamCommentsParts, TeamComments } from '../src/engine/review/team-comments.ts'
import { mutate } from '../src/engine/transaction.ts'
import { PLAN, builderOf, launched } from './builder-world.ts'
import { READING, acmeAt, says } from './building-world.ts'
import { type FakeForge, type FakeRule, fakeForge, ghReady, ghSignedOut } from './fake-forge.ts'
import { git } from './repositories.ts'
import { HELPER, held, sessionsEngine, text, until } from './sessions-world.ts'
import { temporaryFolder } from './storage.ts'

/** The forge's host: `.test` never resolves. */
export const HOST = 'git.acme.test'

/** Every test runs a whole engine, Git and a Builder: far above its time alone. */
export const SLOW = 180_000

/** How long a step may take on a slow runner: never a measure of speed. */
export const LONG = 60_000

/** The pull request of `api` Hemera opened. */
export const NUMBER = 7

/** Twenty numbered lines: what an inline comment is made on. */
export const NOTES = Array.from({ length: 20 }, (_, at) => `line ${String(at + 1)}`)
export const textOf = (lines: ReadonlyArray<string>) => `${lines.join('\n')}\n`

/** A comment as the fake forge holds it: GitHub's REST fields, what the test writes. */
export interface FakeComment {
  readonly id: number
  readonly kind: 'inline' | 'general'
  readonly login: string
  readonly body: string
  readonly at?: string
  readonly updated?: string
  readonly path?: string
  readonly start?: number
  readonly line?: number
  readonly commit?: string
  readonly replyTo?: number
}

/** What the fake forge holds now: the signed-in login, the comments, the resolved threads. */
export interface ForgeState {
  readonly login: string
  readonly comments: ReadonlyArray<FakeComment>
  readonly resolved: ReadonlyArray<number>
  /** `gh` signed out: every call but `--version` is refused as GitHub refuses it. */
  readonly signedOut?: boolean
}

const AT = '2026-10-20T09:00:00Z'

/** The fake `gh`'s rules for a state: the comments of `acme/api`'s pull request #7. */
export const forgeRules = (state: ForgeState): ReadonlyArray<FakeRule> => {
  if (state.signedOut === true) return ghSignedOut(HOST)
  const inline = state.comments.filter((one) => one.kind === 'inline')
  const general = state.comments.filter((one) => one.kind === 'general')
  const repo = `repos/acme/api`
  return [
    {
      cli: 'gh',
      when: [`${repo}/pulls/${String(NUMBER)}/comments`],
      stdout: JSON.stringify([
        inline.map((one) => {
          const comment = {
            id: one.id,
            user: { login: one.login },
            body: one.body,
            created_at: one.at ?? AT,
            updated_at: one.updated ?? one.at ?? AT,
            path: one.path ?? 'notes.ts',
            line: one.line ?? null,
            start_line: one.start ?? null,
            original_line: one.line ?? null,
            original_start_line: one.start ?? null,
            side: 'RIGHT',
            commit_id: one.commit ?? 'feed',
            original_commit_id: one.commit ?? 'feed',
            html_url: `https://${HOST}/acme/api/pull/7#discussion_r${String(one.id)}`,
          }
          // A reply names the comment it answers; a thread's first comment names none.
          return one.replyTo === undefined ? comment : { ...comment, in_reply_to_id: one.replyTo }
        }),
      ]),
    },
    {
      cli: 'gh',
      when: [`${repo}/issues/${String(NUMBER)}/comments`],
      stdout: JSON.stringify([
        general.map((one) => ({
          id: one.id,
          user: { login: one.login },
          body: one.body,
          created_at: one.at ?? AT,
          updated_at: one.updated ?? one.at ?? AT,
          html_url: `https://${HOST}/acme/api/pull/7#issuecomment-${String(one.id)}`,
        })),
      ]),
    },
    { cli: 'gh', when: [`${repo}/pulls/${String(NUMBER)}/reviews`], stdout: '[[]]' },
    {
      cli: 'gh',
      when: ['graphql'],
      stdout: JSON.stringify({
        data: {
          repository: {
            pullRequest: {
              reviewThreads: {
                nodes: inline
                  .filter((one) => one.replyTo === undefined)
                  .map((root) => ({
                    isResolved: state.resolved.includes(root.id),
                    comments: {
                      nodes: inline
                        .filter((one) => one.id === root.id || one.replyTo === root.id)
                        .map((one) => ({ databaseId: one.id })),
                    },
                  })),
              },
            },
          },
        },
      }),
    },
    // What `--jq .login` leaves of the signed-in user.
    { cli: 'gh', when: ['api', 'user', '.login'], stdout: `${state.login}\n` },
    ...ghReady(HOST),
  ]
}

/** How many times the fake was asked for the inline comments of `api`'s pull request. */
export const commentReads = (fake: FakeForge) =>
  fake.calls().filter((call) => call.args.some((arg) => arg.endsWith('/pulls/7/comments'))).length

/**
 * The fake agent of every session: the cold read reads, a team-comment session holds its turn
 * until the test lets it go (so it waits for the test's calls), every other agent answers at once.
 */
export const heldAgents = () => {
  const turn = held()
  let entered = 0
  let prompts: (index: number) => string = () => ''
  const script = (index: number): FakeScript =>
    index === 0
      ? READING
      : {
          steps: [says('Working.')],
          between: () => {
            if (!prompts(index).includes('Mode: team comment')) return Promise.resolve()
            entered += 1
            return turn.promise
          },
        }
  return {
    script,
    entered: () => entered,
    release: turn.release,
    /** How the script reads an agent's first prompt, once the engine exists. */
    reads: (read: (index: number) => string) => {
      prompts = read
    },
  }
}

export interface TeamWorld {
  readonly data: string
  readonly work: string
  readonly fake: FakeForge
  /** Replaces what the fake forge holds. */
  readonly set: (state: ForgeState) => void
  readonly agents: ReturnType<typeof heldAgents>
}

export const teamWorld = (state: ForgeState): TeamWorld => {
  const fake = fakeForge(forgeRules(state), ['gh'])
  return {
    data: temporaryFolder('team-comments'),
    work: temporaryFolder('team-comments-work'),
    fake,
    set: (next) => fake.answer(forgeRules(next)),
    agents: heldAgents(),
  }
}

/** The engine of a suite, the fetch every `every` (5 minutes unless told). */
export const teamEngine = (world: TeamWorld, teamComments: TeamCommentsParts = {}) => {
  const engine = sessionsEngine(world.data, world.agents.script, {
    roles: [HELPER],
    tools: { home: world.work },
    building: { outside: { compareEveryMillis: 3_600_000, baseEveryMillis: 3_600_000 } },
    forge: { env: world.fake.env },
    teamComments,
  })
  world.agents.reads((index) => text(engine.world.agents[index]?.answers.prompts[0] ?? []))
  return engine
}

export interface OnForge {
  readonly missionId: string
  readonly projectId: string
  readonly api: string
  readonly web: string
  /** The commit Hemera pushed of `api`, and its tree. */
  readonly commit: string
  readonly tree: string
}

/** The folder of each repository of the mission's Workspace. */
const foldersOf = (missionId: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const [launch] = yield* database
      .select({ workspaceId: buildingLaunches.workspaceId })
      .from(buildingLaunches)
      .where(eq(buildingLaunches.missionId, missionId))
      .orderBy(desc(buildingLaunches.startedAt))
    const rows = yield* database
      .select()
      .from(workspaceRepositories)
      .where(eq(workspaceRepositories.workspaceId, launch?.workspaceId ?? ''))
      .orderBy(asc(workspaceRepositories.position))
    return (path: string) => {
      const found = rows.find((row) => row.path === path)?.worktree
      if (found === undefined) throw new Error(`no ${path} in the Workspace`)
      return found
    }
  })

/**
 * The mission's Building ended as the exit of its end leaves it (B9): its sessions stopped, the
 * Building over, the mission moved to Review by Hemera.
 */
const intoReview = (missionId: string) =>
  Effect.gen(function* () {
    yield* Sessions.use((sessions) =>
      sessions.stopTree({ kind: 'mission', missionId }, 'the Building ended'),
    )
    const mission = yield* getMission(missionId)
    yield* mutate('ending the Building', (transaction) =>
      Effect.gen(function* () {
        yield* transaction
          .update(buildings)
          .set({ state: 'ended', phase: 'ended', endedAt: new Date().toISOString() })
          .where(and(eq(buildings.missionId, missionId), eq(buildings.state, 'active')))
        const event = yield* moveIn(
          transaction,
          { id: missionId, stage: mission.stage, round: mission.round },
          'endBuilding',
          'hemera',
        )
        return { result: undefined, events: [event] }
      }),
    )
  })

/** A mission moved by Hemera or the user, as a Building's end or a Ship moves it. */
export const moved = (missionId: string, move: 'ship' | 'complete') =>
  Effect.gen(function* () {
    const mission = yield* getMission(missionId)
    yield* mutate('moving the mission', (transaction) =>
      Effect.map(
        moveIn(
          transaction,
          { id: missionId, stage: mission.stage, round: mission.round },
          move,
          move === 'ship' ? 'user' : 'hemera',
        ),
        (event) => ({ result: undefined, events: [event] }),
      ),
    )
  })

const writePullRequest = Schema.encodeSync(
  Schema.fromJsonString(
    Schema.Struct({
      forge: Schema.String,
      host: Schema.String,
      number: Schema.Number,
      url: Schema.String,
      state: Schema.String,
      head: Schema.String,
      reviewDecision: Schema.NullOr(Schema.String),
      approvals: Schema.Array(Schema.Struct({ login: Schema.String })),
    }),
  ),
)

/** Records a push of `api` at this commit and tree, with its open pull request, as R6 does. */
export const pushed = (missionId: string, repositoryId: string, commit: string, tree: string) =>
  mutate('recording a push', (transaction) =>
    Effect.gen(function* () {
      const status: PullRequestStatus = {
        forge: 'github',
        host: HOST,
        number: NUMBER,
        url: `https://${HOST}/acme/api/pull/${String(NUMBER)}`,
        state: 'open',
        head: commit,
        reviewDecision: null,
        approvals: [],
      }
      const at = new Date().toISOString()
      yield* transaction
        .insert(deliveryPushes)
        .values({
          missionId,
          repositoryId,
          repository: 'api',
          round: 0,
          state: 'done',
          commit,
          tree,
          pushedAt: at,
          remote: 'origin',
          branch: 'acme/invoices',
          pullRequest: writePullRequest(status),
          updatedAt: at,
        })
        .onConflictDoUpdate({
          target: [deliveryPushes.missionId, deliveryPushes.repositoryId],
          set: { commit, tree, pullRequest: writePullRequest(status), updatedAt: at },
        })
        .pipe(Effect.orDie)
      return {
        result: undefined,
        events: [
          {
            type: 'delivery.pushed',
            entityKind: 'mission',
            entityId: missionId,
            source: 'system' as const,
            author: 'hemera' as const,
            payload: { repository: 'api', commit, remote: 'origin', branch: 'acme/invoices' },
          },
        ],
      }
    }),
  )

/**
 * Acme's mission in Review over `api` and `web`, `notes.ts` written in `api`, `api`'s remote named
 * on the forge's host and forced to GitHub there, and `api` pushed by Hemera with its pull request.
 */
export const inReviewOnForge = (work: string) =>
  Effect.gen(function* () {
    const url = `https://${HOST}/acme/api.git`
    const { mission, project } = yield* launched(
      work,
      // The forge's GitHub on the fake's host, before any Building reads it.
      (projectId) =>
        Effect.gen(function* () {
          const api = (yield* getProject(projectId)).repositories.find((one) => one.path === 'api')
          yield* ForgePort.use((port) => port.setForced(projectId, api?.id ?? '', 'github', HOST))
        }),
      'It touches api and web, nothing else.',
      PLAN,
      // `api`'s remote named on the forge's host before Hemera's Git watches it.
      (at) => acmeAt(at, 'acme', (api) => git(api, 'remote', 'set-url', 'origin', url)),
    )
    const folderOf = yield* foldersOf(mission.id)
    const api = folderOf('api')
    yield* builderOf(mission.id)
    writeFileSync(join(api, 'notes.ts'), textOf(NOTES))
    const apiId =
      (yield* getProject(project.id)).repositories.find((one) => one.path === 'api')?.id ?? ''
    yield* intoReview(mission.id)
    yield* until(
      Effect.map(
        Review.use((review) => review.state(mission.id)),
        (state) => state.checkpoints.length > 0,
      ),
      LONG,
    )
    const tree = yield* Snapshots.use((snapshots) =>
      snapshots.take(
        { name: 'api', folder: api },
        { kind: 'run', missionId: mission.id, runId: crypto.randomUUID(), side: 'after' },
      ),
    )
    const commit = 'c0ffee0000000000000000000000000000000001'
    yield* pushed(mission.id, apiId, commit, tree)
    // The fetch the push starts, done: the test's comments are read by its own fetches.
    yield* TeamComments.use((team) => team.fetch(mission.id))
    const result: OnForge = {
      missionId: mission.id,
      projectId: project.id,
      api,
      web: folderOf('web'),
      commit,
      tree,
    }
    return result
  })
