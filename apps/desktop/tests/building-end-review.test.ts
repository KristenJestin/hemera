/**
 * The end of a Building (#147): once every task is done, one sequence runs the documenter, the
 * final checks, a checkpoint of the result, the two reviewers (one pass each, read-only, on the
 * checkpoint), the special tasks born from their findings, the documenter's delta and the proofs
 * made fresh again, then moves the mission to Review on its own.
 *
 * On the engine as it starts, with the fake agent of #32 as every agent and the test driving the
 * Builder's, the documenter's and both reviewers' tools through their grants; Acme's real
 * repositories in temporary folders as the Workspace. The cold read reads, the Builder answers
 * every prompt and does nothing else; every agent after them holds its turn open until the test
 * lets it go, once it reported. The checks are a fake `TaskChecks`: none unless a test says.
 *
 * This file: the end sequence, the reviewers, their findings and what the review saw.
 */

import {
  closeSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, win32 } from 'node:path'
import {
  ChosenAnswer,
  SESSION_STATES,
  SPEC_IS_RIGHT,
  REVIEWERS,
  START_AGAIN,
  TOOLS,
  WrittenAnswer,
  toolsOf,
} from '@hemera/core/domain'
import { and, asc, eq } from 'drizzle-orm'
import { Effect, Exit, Fiber, Predicate, Stream } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'
import { autoReviewOf } from '../src/engine/building/review-store.ts'
import { insideCopy, reviewFolderOf } from '../src/engine/building/review.ts'
import { withheldIn } from '../src/engine/building/end.ts'
import { buildingPartOf } from '../src/engine/building/tasks.ts'
import { projectLimits, setProjectLimits } from '../src/engine/budget.ts'
import { DomainEvents } from '../src/engine/domain-events.ts'
import { Memory } from '../src/engine/memory/index.ts'
import { getMission } from '../src/engine/missions.ts'
import { answerNeed } from '../src/engine/needs.ts'
import { Secrets } from '../src/engine/secrets.ts'
import { REGISTRY, noticesOf } from '../src/engine/notifications.ts'
import {
  MEMORY_TOOLS,
  ROLES_REGISTERED,
  memoryContractBroken,
  roleNamed,
} from '../src/engine/sessions/roles.ts'
import { Sessions } from '../src/engine/sessions/service.ts'
import { type RoleSession, sessionsIn } from '../src/engine/sessions/store.ts'
import { Database } from '../src/engine/storage/database.ts'
import { mutate } from '../src/engine/transaction.ts'
import {
  buildingTasks,
  buildings,
  checkpointFiles,
  checkpoints,
  missions,
  fileContents,
  proofRuns,
  reviewPasses,
} from '../src/engine/storage/schema.ts'
import { call, eventsOf } from './building-world.ts'
import { PLAN, builderOf, buildingNow, launched, taskIn } from './builder-world.ts'
import { held, text, until, within } from './sessions-world.ts'
import { callTool } from './tools-world.ts'
import { ProfileHome } from '../src/engine/profile-home.ts'
import { sweepDiagnostics } from '../src/engine/retention.ts'
import { removeFolders } from './storage.ts'
import { git } from './repositories.ts'
import {
  data,
  work,
  LONG,
  SLOW,
  RED,
  ending,
  withReadme,
  builtAll,
  agentOf,
  NO_DOC,
  documented,
  reviewed,
  warning,
  specialDone,
  inReview,
  specialAvailable,
  reviewing,
  journalOf,
  typesOf,
  toBuilder,
  writtenInWorkspace,
  apiOf,
  folderOf,
  BOTH,
  specialTargets,
  proofState,
  throughSpecial,
  exportProof,
  newFolders,
} from './end-world.ts'

beforeEach(() => newFolders('building-end'))
afterEach(removeFolders)

describe('The end sequence', () => {
  test(
    'every task done runs, in order: documenter, final checks, checkpoint, both reviewers, special tasks, refresh, Review; the stage moves to Review on its own with building.ended',
    SLOW,
    async () => {
      const { world, run } = ending()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.scoped(
            Effect.gen(function* () {
              const { mission } = yield* launched(work, withReadme)
              const builder = yield* builderOf(mission.id)
              const committed = yield* DomainEvents.use((events) => events.subscribe)
              const told = yield* noticesOf(REGISTRY, committed).pipe(
                Stream.filter((one) => Predicate.isTagged(one, 'NoticeRaised')),
                Stream.map((one) => (Predicate.isTagged(one, 'NoticeRaised') ? one.notice : null)),
                Stream.filter(
                  (one) => one?.kind === 'building-finished' || one?.kind === 'review-waiting',
                ),
                Stream.take(2),
                Stream.runCollect,
                Effect.forkChild,
              )
              yield* builtAll(builder.grantId)
              yield* documented(world, mission.id)
              yield* reviewed(world, mission.id, 'spec-reviewer')
              const now = Memory.use((memory) => memory.now(mission.id))
              yield* until(
                Effect.map(now, (state) => state.end.length > 0),
                LONG,
              )
              const reviewingNow = yield* now
              yield* reviewed(world, mission.id, 'code-reviewer', [
                warning('README.md', 'Say how to export the invoices as Markdown.'),
              ])
              yield* specialAvailable(mission.id, 'RV1')
              const specialNow = yield* now
              yield* specialDone(builder.grantId, 'RV1', 'README.md', 'Acme api, as Markdown\n')
              yield* inReview(mission.id)
              return {
                reviewingNow,
                specialNow,
                endedNow: yield* now,
                notices: yield* Fiber.join(told),
                // The Journal projects the events a moment after they are written.
                journal: yield* until(
                  Effect.map(journalOf(mission.id), (lines) =>
                    lines.some((line) => line.startsWith('Building ended')),
                  ),
                  LONG,
                ).pipe(Effect.andThen(journalOf(mission.id))),
                types: yield* typesOf(mission.id),
                view: yield* buildingNow(mission.id),
                builder: yield* sessionsIn(SESSION_STATES, {
                  kind: 'mission',
                  missionId: mission.id,
                }),
              }
            }),
          ),
        ),
      )
      const steps = seen.types.filter((type) =>
        [
          'building.end_started',
          'building.documenter_started',
          'building.final_checks',
          'review.checkpoint_taken',
          'review.pass_started',
          'review.special_task',
          'building.proofs_refreshed',
          'mission.moved',
          'building.ended',
        ].includes(type),
      )
      expect(steps.filter((type) => type !== 'mission.moved')).toEqual([
        'building.end_started',
        'building.documenter_started',
        'building.final_checks',
        'review.checkpoint_taken',
        'review.pass_started',
        'review.pass_started',
        'review.special_task',
        'building.proofs_refreshed',
        'building.ended',
      ])
      // The special task is done before the refresh, and the move to Review comes last.
      expect(seen.types.lastIndexOf('building.task_done')).toBeLessThan(
        seen.types.indexOf('building.proofs_refreshed'),
      )
      expect(seen.types.lastIndexOf('mission.moved')).toBeGreaterThan(
        seen.types.indexOf('building.proofs_refreshed'),
      )
      // Now says where the end stands: the reviewers done, then the special tasks.
      expect(seen.reviewingNow.end).toEqual(['Automatic review: 1 of 2 reviewers done'])
      expect(seen.specialNow.end).toEqual(['Special tasks: RV1'])
      expect(seen.endedNow.end).toEqual([])
      // The end tells: the build finished, and the mission waits for its Review.
      expect([...seen.notices].map((one) => [one?.kind, one?.missionKey, one?.what])).toEqual([
        ['review-waiting', 'ACME-1', 'it waits for your Review'],
        ['building-finished', 'ACME-1', 'its Building finished'],
      ])
      expect(
        REGISTRY.kinds
          .filter((one) => one.id === 'building-finished' || one.id === 'review-waiting')
          .map((one) => [one.id, one.byDefault, one.sound]),
      ).toEqual([
        ['building-finished', true, 'done'],
        ['review-waiting', false, null],
      ])
      // Each step of the end is a line of the Journal.
      expect(seen.journal).toEqual(
        expect.arrayContaining([
          'The end of Building started: documentation, final checks, then the automatic review.',
          'The final checks: none ran.',
          'The checkpoint of the automatic review is taken.',
          'The Spec reviewer started its pass.',
          'The Code reviewer started its pass.',
          'The Spec reviewer reported no finding.',
          'The Code reviewer reported 1 warning.',
          'RV1, a special task from finding 1 of the Code reviewer: Say how to export the invoices as Markdown.',
          'Building ended: the mission moves to Review; 1 file(s) changed after the automatic review.',
        ]),
      )
      expect(seen.view).toMatchObject({ state: 'ended', phase: 'ended' })
      expect(seen.view.endedAt).not.toBeNull()
      // The Builder's session is stopped at the exit.
      const builders = seen.builder.filter((one) => one.role === 'builder')
      expect(builders.every((one) => one.state === 'ended')).toBe(true)
    },
  )

  test(
    'the full end driven from the last green runs to Review: the refresh it calls never waits on the turn that greened',
    SLOW,
    async () => {
      const markdown = [
        "import { test } from 'node:test'",
        "import assert from 'node:assert/strict'",
        "import { existsSync, readFileSync } from 'node:fs'",
        '',
        "test('the scenario holds', () => {",
        "  const file = new URL('../export.ts', import.meta.url)",
        "  assert.ok(existsSync(file) && readFileSync(file, 'utf8').includes('toMarkdown'), 'no toMarkdown')",
        '})',
        '',
      ].join('\n')
      const proofs = () => ({
        'R1.S2': {
          mode: 'automated',
          actions: ['Run the test'],
          starting_data: 'None.',
          expected: 'The assertion of the test holds.',
          test: {
            repository: 'api',
            path: 'tests/export.test.mjs',
            code: markdown,
            insertion: 'new_file',
            command: `"${process.execPath}" --test --test-reporter=tap tests/export.test.mjs`,
          },
          seen_today: false,
        },
      })
      const { world, run } = ending()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(
              work,
              withReadme,
              undefined,
              PLAN,
              undefined,
              undefined,
              proofs,
            )
            const builder = yield* builderOf(mission.id)
            yield* proofState(mission.id, 'R1.S2', 'red_recorded')
            // T2 writes an export the proof does not accept: the end waits for its green.
            yield* builtAll(builder.grantId, 'export const toCsv = () => ""\n')
            const waited = (yield* buildingNow(mission.id)).phase
            // The last write turns the proof green, which calls the end from inside its turn.
            yield* call(builder.grantId, 'fs_write', {
              repository: 'api',
              path: 'export.ts',
              content: 'export const toMarkdown = () => ""\n',
            })
            yield* documented(world, mission.id)
            yield* reviewed(world, mission.id, 'spec-reviewer')
            yield* reviewed(world, mission.id, 'code-reviewer')
            yield* inReview(mission.id)
            return { waited, types: yield* typesOf(mission.id) }
          }),
        ),
      )
      expect(seen.waited).toBe('tasks')
      expect(seen.types.indexOf('building.scenario_green')).toBeLessThan(
        seen.types.indexOf('building.end_started'),
      )
      expect(seen.types).toContain('building.proofs_refreshed')
      expect(seen.types.at(-1)).not.toBe('building.end_started')
      expect(seen.types).toContain('building.ended')
    },
  )
})

describe('The reviewers', () => {
  test(
    'the reviewers’ sessions hold no write, command or Memory tool; their brief has no Journal; a replaced reviewer gets the same brief plus the restart sentence',
    SLOW,
    async () => {
      for (const id of ['spec-reviewer', 'code-reviewer'] as const) {
        const entry = roleNamed(ROLES_REGISTERED, id)
        expect(entry, id).toMatchObject({ readsMemory: false, writes: false, countsInCap: true })
        const tools = toolsOf(id)
        expect(
          tools.filter((name) => MEMORY_TOOLS.includes(name)),
          id,
        ).toEqual([])
        expect(
          tools.filter((name) => TOOLS[name].effect === 'writes' || TOOLS[name].effect === 'runs'),
          id,
        ).toEqual([])
      }
      expect(memoryContractBroken(ROLES_REGISTERED)).toEqual([])
      const { world, run } = ending()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(work, withReadme)
            const builder = yield* builderOf(mission.id)
            yield* call(builder.grantId, 'journal_add', {
              text: 'The CSV export keeps the header.',
            })
            yield* builtAll(builder.grantId)
            yield* documented(world, mission.id)
            const first = yield* agentOf(world, mission.id, 'code-reviewer')
            yield* reviewing(mission.id)
            const before = world.agents.length
            yield* Sessions.use((sessions) =>
              sessions.replace(first.session.id, 'the test replaced it'),
            )
            yield* until(
              Effect.sync(() => (world.agents[before]?.answers.prompts.length ?? 0) > 0),
              LONG,
            )
            const successor = text(world.agents[before]?.answers.prompts[0] ?? [])
            return { mission, first, successor }
          }),
        ),
      )
      expect(seen.first.brief).toContain(`## Code reviewer · ${seen.mission.key} · Building`)
      expect(seen.first.brief).toContain('Checkpoint: ')
      expect(seen.first.brief).not.toContain('The CSV export keeps the header.')
      expect(seen.first.brief).not.toMatch(/Journal|## Now|## Notes/)
      expect(seen.successor).toContain(seen.first.brief.trim())
      expect(seen.successor).toContain('[hemera:resume]')
      expect(seen.successor).toContain(START_AGAIN)
    },
  )

  test(
    'checkpoint_read reads the checkpoint, not a later write in the Workspace; a .env shows "content withheld"',
    SLOW,
    async () => {
      const { world, run } = ending()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(work, withReadme)
            const builder = yield* builderOf(mission.id)
            const api = yield* apiOf(mission.id)
            writtenInWorkspace(api, 'src/x.ts', 'export const x = "at the checkpoint"\n')
            writtenInWorkspace(api, '.env', 'TOKEN=at-the-checkpoint\n')
            yield* builtAll(builder.grantId)
            yield* documented(world, mission.id)
            const reviewer = yield* agentOf(world, mission.id, 'spec-reviewer')
            // Written after the checkpoint: the reviewer never sees it.
            writtenInWorkspace(api, 'src/x.ts', 'export const x = "later"\n')
            return {
              list: yield* call(reviewer.grantId, 'checkpoint_read', {}),
              file: yield* call(reviewer.grantId, 'checkpoint_read', {
                repository: 'api',
                path: 'src/x.ts',
              }),
              secret: yield* call(reviewer.grantId, 'checkpoint_read', {
                repository: 'api',
                path: '.env',
              }),
              read: yield* call(reviewer.grantId, 'fs_read', {
                repository: 'api',
                path: 'src/x.ts',
              }),
              folder: reviewer.session.folder,
              api,
            }
          }),
        ),
      )
      expect(seen.list).toContain('src/x.ts')
      expect(seen.list).toContain('.env')
      expect(seen.file).toContain('at the checkpoint')
      expect(seen.file).not.toContain('later')
      expect(seen.secret).toContain('content withheld: .env')
      expect(seen.secret).not.toContain('TOKEN=')
      expect(seen.read).toContain('at the checkpoint')
      expect(seen.read).not.toContain('later')
      expect(seen.folder).not.toBe(dirname(seen.api))
    },
  )

  test(
    'checkpoint_read of a .envrc a checkpoint kept in clear before it was a sensitive place shows "content withheld" (#392)',
    SLOW,
    async () => {
      const { world, run } = ending()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(work, withReadme)
            const builder = yield* builderOf(mission.id)
            const api = yield* apiOf(mission.id)
            writtenInWorkspace(api, '.envrc', 'export ACME_REGION=at-the-checkpoint\n')
            yield* builtAll(builder.grantId)
            yield* documented(world, mission.id)
            const reviewer = yield* agentOf(world, mission.id, 'spec-reviewer')
            // As a checkpoint taken before #392 kept it: the .envrc's bytes, under no reason.
            const bytes = Buffer.from('export ACME_REGION=at-the-checkpoint\n')
            const database = yield* Database
            const [kept] = yield* database
              .select({ sha256: checkpointFiles.afterSha256 })
              .from(checkpointFiles)
              .where(eq(checkpointFiles.path, '.envrc'))
            if (kept?.sha256 == null) return yield* Effect.die(new Error('no .envrc kept'))
            const sha256 = kept.sha256
            yield* mutate('keeping a .envrc as before #392', (transaction) =>
              Effect.as(
                Effect.all([
                  transaction
                    .update(checkpointFiles)
                    .set({ afterWithheld: null })
                    .where(eq(checkpointFiles.path, '.envrc')),
                  transaction
                    .insert(fileContents)
                    .values({ sha256, bytes, size: bytes.length, masked: false })
                    .onConflictDoUpdate({ target: fileContents.sha256, set: { bytes } }),
                ]),
                { result: undefined, events: [] },
              ),
            )
            return yield* call(reviewer.grantId, 'checkpoint_read', {
              repository: 'api',
              path: '.envrc',
            })
          }),
        ),
      )
      expect(seen).toContain('content withheld: .envrc')
      expect(seen).not.toContain('at-the-checkpoint')
    },
  )

  test(
    'checkpoint_read of a path without a repository, in a two-repository Workspace: changed in one, it reads that one; changed in both, unchanged or in neither, it is refused with both names',
    SLOW,
    async () => {
      const { world, run } = ending()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(work, withReadme, BOTH)
            const builder = yield* builderOf(mission.id)
            const web = yield* folderOf(mission.id, 'web')
            writtenInWorkspace(web, 'invoices.ts', 'export const fromWeb = true\n')
            writtenInWorkspace(web, 'page.ts', 'export const page = "web"\n')
            yield* builtAll(builder.grantId)
            yield* documented(world, mission.id)
            const reviewer = yield* agentOf(world, mission.id, 'spec-reviewer')
            const read = (path: string) => call(reviewer.grantId, 'checkpoint_read', { path })
            return {
              inApi: yield* read('export.ts'),
              inWeb: yield* read('page.ts'),
              inBoth: yield* read('invoices.ts'),
              unchanged: yield* read('package.json'),
              nowhere: yield* read('nowhere.ts'),
            }
          }),
        ),
      )
      expect(seen.inApi).toContain('## api/export.ts')
      expect(seen.inApi).toContain('export const markdown = true')
      expect(seen.inWeb).toContain('## web/page.ts')
      expect(seen.inWeb).toContain('export const page = "web"')
      for (const answer of [seen.inBoth, seen.unchanged, seen.nowhere]) {
        expect(answer).toMatch(/^refused: /)
        expect(answer).toContain('api, web')
        expect(answer).not.toContain('"name": "api"')
      }
      expect(seen.inBoth).toContain('invoices.ts')
      expect(seen.unchanged).toContain('package.json')
    },
  )

  test(
    'in a one-repository Workspace, a path without a repository names it: checkpoint_read reads an unchanged file there, and a finding on it targets it',
    SLOW,
    async () => {
      const { world, run } = ending()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(work, withReadme)
            const builder = yield* builderOf(mission.id)
            yield* builtAll(builder.grantId)
            yield* documented(world, mission.id)
            const reviewer = yield* agentOf(world, mission.id, 'spec-reviewer')
            const unchanged = yield* call(reviewer.grantId, 'checkpoint_read', {
              path: 'package.json',
            })
            yield* reviewed(world, mission.id, 'spec-reviewer', [
              {
                severity: 'warning',
                path: 'package.json',
                text: 'The package names no export script.',
                contradicts_spec: false,
              },
            ])
            yield* reviewed(world, mission.id, 'code-reviewer')
            yield* specialAvailable(mission.id, 'RV1')
            return { unchanged, targets: yield* specialTargets }
          }),
        ),
      )
      expect(seen.unchanged).toContain('## api/package.json, unchanged since the merge base')
      expect(seen.unchanged).toContain('"name": "api"')
      expect(seen.targets.map((one) => JSON.parse(one))).toEqual([
        [{ repository: 'api', path: 'package.json', intent: 'change' }],
      ])
    },
  )

  test(
    'a finding with a path and no repository, in a two-repository Workspace: refused with both names when the path is changed in both or unchanged; kept on the one repository whose changed files hold it, written with ./ or backslashes, its special task targeting it',
    SLOW,
    async () => {
      const { world, run } = ending()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(work, withReadme, BOTH)
            const builder = yield* builderOf(mission.id)
            const web = yield* folderOf(mission.id, 'web')
            writtenInWorkspace(web, 'invoices.ts', 'export const fromWeb = true\n')
            writtenInWorkspace(web, 'page.ts', 'export const page = "web"\n')
            writtenInWorkspace(web, 'src/view.ts', 'export const view = "web"\n')
            yield* builtAll(builder.grantId)
            yield* documented(world, mission.id)
            const reviewer = yield* agentOf(world, mission.id, 'spec-reviewer')
            const report = (path: string) =>
              call(reviewer.grantId, 'review_report', {
                findings: [
                  {
                    severity: 'warning',
                    path,
                    text: `Look again at ${path}.`,
                    contradicts_spec: false,
                  },
                ],
              })
            const inBoth = yield* report('invoices.ts')
            const unchanged = yield* report('package.json')
            // Written from where the reviewer stands, or with Windows separators: the same file.
            const inWeb = yield* report('./page.ts')
            world.release(reviewer.index)
            yield* reviewed(world, mission.id, 'code-reviewer', [
              {
                severity: 'warning',
                path: 'src\\view.ts',
                text: 'Look again at the view.',
                contradicts_spec: false,
              },
            ])
            yield* specialAvailable(mission.id, 'RV2')
            return {
              inBoth,
              unchanged,
              inWeb,
              review: yield* autoReviewOf(mission.id),
              targets: yield* specialTargets,
            }
          }),
        ),
      )
      expect(seen.inBoth).toBe(
        'refused: finding 1: invoices.ts names no single repository: say which, one of api, web. Nothing was kept.',
      )
      expect(seen.unchanged).toBe(
        'refused: finding 1: package.json names no single repository: say which, one of api, web. Nothing was kept.',
      )
      expect(seen.inWeb).toContain('Your report is kept.')
      expect(seen.review?.findings).toHaveLength(2)
      expect(seen.review?.findings[0]).toMatchObject({ repository: 'web', path: 'page.ts' })
      expect(seen.review?.findings[1]).toMatchObject({ repository: 'web', path: 'src/view.ts' })
      expect(seen.targets.map((one) => JSON.parse(one))).toEqual([
        [{ repository: 'web', path: 'page.ts', intent: 'change' }],
        [{ repository: 'web', path: 'src/view.ts', intent: 'change' }],
      ])
    },
  )

  test(
    'a .env of the checkpoint, read through the copy with fs_read or search, with or without a glob: content withheld, none of its lines printed',
    SLOW,
    async () => {
      const { world, run } = ending()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(work, withReadme)
            const builder = yield* builderOf(mission.id)
            const api = yield* apiOf(mission.id)
            // Written and left uncommitted: the checkpoint keeps a stand-in for it.
            writtenInWorkspace(api, '.env', 'TOKEN=left-in-the-workspace\n')
            // Committed: the checkpoint's tree holds its content as it is.
            writtenInWorkspace(api, 'config/.env.production', 'TOKEN=committed-to-the-branch\n')
            git(api, 'add', '-f', 'config/.env.production')
            git(api, 'commit', '-q', '-m', 'production settings')
            yield* builtAll(builder.grantId)
            yield* documented(world, mission.id)
            const reviewer = yield* agentOf(world, mission.id, 'spec-reviewer')
            const read = (path: string) =>
              call(reviewer.grantId, 'fs_read', { repository: 'api', path })
            const asked = { repository: 'api', pattern: 'TOKEN' }
            const search = (glob: string | null) =>
              call(reviewer.grantId, 'search', glob === null ? asked : { ...asked, glob })
            return {
              reads: [yield* read('.env'), yield* read('config/.env.production')],
              searches: [
                yield* search(null),
                yield* search('**/.env*'),
                yield* search('.env'),
                yield* search('.env.production'),
              ],
              checkpoint: yield* call(reviewer.grantId, 'checkpoint_read', {
                repository: 'api',
                path: 'config/.env.production',
              }),
            }
          }),
        ),
      )
      for (const answer of seen.reads) {
        expect(answer).toContain('content withheld')
      }
      for (const answer of [...seen.reads, ...seen.searches, seen.checkpoint]) {
        expect(answer).not.toContain('TOKEN=')
        expect(answer).not.toContain('left-in-the-workspace')
        expect(answer).not.toContain('committed-to-the-branch')
      }
    },
  )

  test.skipIf(process.platform === 'win32')(
    'a link in the copy of the checkpoint to its .env, or to a file outside it, read with fs_read or search: content withheld, none of its lines printed',
    SLOW,
    async () => {
      const outside = join(work, 'outside-secret.txt')
      writeFileSync(outside, 'TOKEN=outside-the-copy\n')
      const { world, run } = ending()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(work, withReadme)
            const builder = yield* builderOf(mission.id)
            const api = yield* apiOf(mission.id)
            writtenInWorkspace(api, 'config/.env.production', 'TOKEN=committed-to-the-branch\n')
            symlinkSync('config/.env.production', join(api, 'settings.txt'))
            symlinkSync(outside, join(api, 'elsewhere.txt'))
            git(api, 'add', '-f', 'config/.env.production', 'settings.txt', 'elsewhere.txt')
            git(api, 'commit', '-q', '-m', 'linked settings')
            yield* builtAll(builder.grantId)
            yield* documented(world, mission.id)
            const reviewer = yield* agentOf(world, mission.id, 'spec-reviewer')
            const read = (path: string) =>
              call(reviewer.grantId, 'fs_read', { repository: 'api', path })
            return {
              answers: [
                yield* read('settings.txt'),
                yield* read('elsewhere.txt'),
                yield* call(reviewer.grantId, 'search', { repository: 'api', pattern: 'TOKEN' }),
                yield* call(reviewer.grantId, 'search', {
                  repository: 'api',
                  pattern: 'TOKEN',
                  glob: '*.txt',
                }),
              ],
            }
          }),
        ),
      )
      expect(seen.answers[0]).toContain('content withheld: api/config/.env.production')
      expect(seen.answers[1]).toContain('content withheld: api/elsewhere.txt')
      for (const answer of seen.answers) {
        expect(answer).not.toContain('TOKEN=')
        expect(answer).not.toContain('committed-to-the-branch')
        expect(answer).not.toContain('outside-the-copy')
      }
    },
  )

  test.skipIf(process.platform === 'win32')(
    'a committed link to a folder outside the copy, and a link to the copy itself: the review runs, and the link out reads content withheld',
    SLOW,
    async () => {
      const outside = join(work, 'outside-folder')
      mkdirSync(outside)
      writeFileSync(join(outside, '.env'), 'TOKEN=outside-the-copy\n')
      const { world, run } = ending()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(work, withReadme)
            const builder = yield* builderOf(mission.id)
            const api = yield* apiOf(mission.id)
            symlinkSync(outside, join(api, 'out'))
            symlinkSync('.', join(api, 'self'))
            git(api, 'add', 'out', 'self')
            git(api, 'commit', '-q', '-m', 'linked folders')
            yield* builtAll(builder.grantId)
            yield* documented(world, mission.id)
            yield* reviewing(mission.id)
            const reviewer = yield* agentOf(world, mission.id, 'spec-reviewer')
            return {
              out: yield* call(reviewer.grantId, 'fs_read', { repository: 'api', path: 'out' }),
              search: yield* call(reviewer.grantId, 'search', {
                repository: 'api',
                pattern: 'TOKEN',
              }),
            }
          }),
        ),
      )
      expect(seen.out).toContain('content withheld: api/out')
      expect(seen.search).not.toContain('outside-the-copy')
      expect(readFileSync(join(outside, '.env'), 'utf8')).toBe('TOKEN=outside-the-copy\n')
    },
  )

  test(
    'a copy of the checkpoint made before the withholding is withheld when it is used again',
    SLOW,
    async () => {
      const { world, run } = ending()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(work, withReadme)
            const builder = yield* builderOf(mission.id)
            const { dataFolder } = yield* ProfileHome
            const folder = reviewFolderOf(dataFolder, (yield* buildingNow(mission.id)).buildingId)
            // A copy left by an engine that did not withhold, as an upgrade mid-end finds it.
            writtenInWorkspace(folder, 'api/.env', 'TOKEN=in-an-old-copy\n')
            yield* builtAll(builder.grantId)
            yield* documented(world, mission.id)
            const reviewer = yield* agentOf(world, mission.id, 'spec-reviewer')
            return yield* call(reviewer.grantId, 'fs_read', { repository: 'api', path: '.env' })
          }),
        ),
      )
      expect(seen).toContain('content withheld: api/.env')
      expect(seen).not.toContain('in-an-old-copy')
    },
  )

  test('on Windows, a finding’s path on another drive is not inside the checkpoint', () => {
    const root = 'C:\\Users\\someone\\hemera\\reviews\\b1\\api'
    expect(insideCopy(root, 'src\\x.ts', win32)).toBe(true)
    expect(insideCopy(root, '..\\web\\x.ts', win32)).toBe(false)
    expect(insideCopy(root, 'D:\\secrets\\x.ts', win32)).toBe(false)
    expect(insideCopy(root, 'D:x.ts', win32)).toBe(false)
  })
})

describe('The copy the reviewers read', () => {
  /** A copy of the checkpoint holding `api`, in a reviews folder of its own. */
  const copyIn = () => {
    const copy = join(work, 'reviews', 'b1.partial')
    mkdirSync(join(copy, 'api'), { recursive: true })
    writeFileSync(join(copy, 'api', 'README.md'), 'Acme api\n')
    return copy
  }
  const isLink = (path: string) => lstatSync(path).isSymbolicLink()
  const read = (path: string) => readFileSync(path, 'utf8')

  test('a .env template is withheld, as checkpoint_read withholds it', () => {
    const copy = copyIn()
    writeFileSync(join(copy, 'api', '.env.example'), 'TOKEN=a-real-value\n')
    withheldIn(copy)
    expect(read(join(copy, 'api', '.env.example'))).toBe('content withheld: api/.env.example\n')
    expect(read(join(copy, 'api', 'README.md'))).toBe('Acme api\n')
  })

  test.skipIf(process.platform === 'win32')(
    'a link to a folder outside the copy is withheld as a link, and nothing outside is touched',
    () => {
      const copy = copyIn()
      const outside = join(work, 'outside-folder')
      mkdirSync(outside)
      writeFileSync(join(outside, '.env'), 'TOKEN=outside-the-copy\n')
      symlinkSync(join(outside, '.env'), join(outside, 'link'))
      symlinkSync(outside, join(copy, 'api', 'out'))
      withheldIn(copy)
      expect(isLink(join(copy, 'api', 'out'))).toBe(false)
      expect(read(join(copy, 'api', 'out'))).toBe('content withheld: api/out\n')
      expect(read(join(outside, '.env'))).toBe('TOKEN=outside-the-copy\n')
      expect(isLink(join(outside, 'link'))).toBe(true)
    },
  )

  test.skipIf(process.platform === 'win32')(
    'a link to the copy itself is kept and never walked through',
    () => {
      const copy = copyIn()
      writeFileSync(join(copy, 'api', '.env'), 'TOKEN=in-the-copy\n')
      symlinkSync('.', join(copy, 'api', 'self'))
      symlinkSync('..', join(copy, 'api', 'root'))
      withheldIn(copy)
      expect(isLink(join(copy, 'api', 'self'))).toBe(true)
      expect(isLink(join(copy, 'api', 'root'))).toBe(true)
      expect(read(join(copy, 'api', 'self', '.env'))).toBe('content withheld: api/.env\n')
    },
  )

  test.skipIf(process.platform === 'win32')(
    'a link to a folder inside the copy that holds a .env is kept, and reads the .env withheld',
    () => {
      const copy = copyIn()
      mkdirSync(join(copy, 'api', 'config'))
      writeFileSync(join(copy, 'api', 'config', '.env.production'), 'TOKEN=in-the-copy\n')
      symlinkSync('config', join(copy, 'api', 'settings'))
      withheldIn(copy)
      expect(isLink(join(copy, 'api', 'settings'))).toBe(true)
      expect(read(join(copy, 'api', 'settings', '.env.production'))).toBe(
        'content withheld: api/config/.env.production\n',
      )
    },
  )

  test.skipIf(process.platform === 'win32')(
    'a link whose text stays in the copy but whose path leads out through another link is withheld',
    () => {
      const copy = copyIn()
      writeFileSync(join(work, 'reviews', 'secret.txt'), 'TOKEN=beside-the-copy\n')
      // `up` leads to the copy's root, so `up/..` is the folder above the copy, not `api`.
      symlinkSync('..', join(copy, 'api', 'up'))
      symlinkSync('up/../secret.txt', join(copy, 'api', 'beside'))
      withheldIn(copy)
      expect(isLink(join(copy, 'api', 'up'))).toBe(true)
      expect(read(join(copy, 'api', 'beside'))).toBe('content withheld: api/beside\n')
    },
  )

  test('a reviewer reading a withheld file while its copy is reused (a Retry) keeps reading it', () => {
    const copy = copyIn()
    writeFileSync(join(copy, 'api', '.env'), 'TOKEN=in-the-copy\n')
    withheldIn(copy)
    const path = join(copy, 'api', '.env')
    // The reader opened the stand-in before the reuse, and still holds it.
    const reader = openSync(path, 'r')
    try {
      const opened = fstatSync(reader, { bigint: true }).ino
      withheldIn(copy)
      expect(statSync(path, { bigint: true }).ino).toBe(opened)
      expect(readFileSync(reader, 'utf8')).toBe('content withheld: api/.env\n')
    } finally {
      closeSync(reader)
    }
    expect(read(path)).toBe('content withheld: api/.env\n')
  })

  test('withholding a copy twice leaves it as once', () => {
    const copy = copyIn()
    writeFileSync(join(copy, 'api', '.env'), 'TOKEN=in-the-copy\n')
    withheldIn(copy)
    withheldIn(copy)
    expect(read(join(copy, 'api', '.env'))).toBe('content withheld: api/.env\n')
  })
})

describe('The findings and their fate', () => {
  test(
    'a contradicting finding becomes a decision need and never reaches the Builder; "the Spec is right" makes a special task; Review waits for the answer',
    SLOW,
    async () => {
      const { world, run } = ending()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(work, withReadme)
            const builder = yield* builderOf(mission.id)
            yield* builtAll(builder.grantId)
            yield* documented(world, mission.id)
            yield* reviewed(world, mission.id, 'spec-reviewer', [
              {
                severity: 'blocking',
                requirement: 'R1',
                repository: 'api',
                path: 'invoices.ts',
                text: 'The CSV has no header row, which the scenario R1.S1 asks for.',
                contradicts_spec: true,
                evidence: 'R1.S1: as CSV, it works; invoices.ts writes no header.',
              },
            ])
            yield* reviewed(world, mission.id, 'code-reviewer')
            yield* until(
              Effect.map(getMission(mission.id), (one) => one.needs.length > 0),
              LONG,
            )
            // Long enough for anything on its way to the Builder or to Review to arrive.
            yield* Effect.sleep('1 second')
            const waiting = yield* getMission(mission.id)
            const toldBefore = yield* toBuilder(mission.id, builder.session.lineage)
            // What the Builder reads of the Memory: that a decision waits, never the finding.
            yield* until(
              Effect.map(journalOf(mission.id), (lines) =>
                lines.some((line) => line.includes('waits on the user')),
              ),
              LONG,
            )
            const read = {
              now: yield* call(builder.grantId, 'memory_read', { part: 'now' }),
              journal: yield* call(builder.grantId, 'memory_read', { part: 'journal' }),
              brief: yield* Memory.use((memory) => memory.briefBlock(mission.id)),
            }
            const need = waiting.needs[0]
            yield* answerNeed({
              id: need?.id ?? '',
              answer: ChosenAnswer.make({ option: SPEC_IS_RIGHT }),
              key: 'spec-right',
            })
            yield* specialAvailable(mission.id, 'RV1')
            // The ready set reaches the Builder once the task is available.
            yield* until(
              Effect.map(toBuilder(mission.id, builder.session.lineage), (told) =>
                told.join('\n').includes('RV1'),
              ),
              LONG,
            )
            const toldAfter = yield* toBuilder(mission.id, builder.session.lineage)
            yield* specialDone(
              builder.grantId,
              'RV1',
              'invoices.ts',
              'export const header = true\n',
            )
            yield* documented(world, mission.id, 2)
            yield* inReview(mission.id)
            return {
              waiting,
              toldBefore,
              read,
              toldAfter,
              review: yield* autoReviewOf(mission.id),
            }
          }),
        ),
      )
      expect(seen.waiting.stage).toBe('building')
      const fields = seen.waiting.needs[0]?.fields
      expect(Predicate.isTagged(fields, 'Decision')).toBe(true)
      if (Predicate.isTagged(fields, 'Decision')) {
        expect(fields.question).toContain('The CSV has no header row')
        expect(fields.options).toEqual([
          'The Spec is right: make the code follow it',
          'The result is right: record it as a decision',
          'Dismiss',
        ])
      }
      expect(seen.toldBefore.join('\n')).not.toContain('header row')
      for (const [part, read] of Object.entries(seen.read)) {
        expect(read, part).not.toContain('header row')
        expect(read, part).not.toContain('invoices.ts writes no header')
        expect(read, part).toContain('a finding of the automatic review')
      }
      expect(seen.toldAfter.join('\n')).toContain('RV1')
      const finding = seen.review?.findings[0]
      expect(finding).toMatchObject({ fate: 'special_task', taskId: 'RV1', contradictsSpec: true })
    },
  )

  test(
    'a special task is numbered per mission: after an earlier Building with RV1 and RV2 the next one gets RV3, and another mission’s numbers do not count',
    SLOW,
    async () => {
      const { world, run } = ending()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(work, withReadme)
            const builder = yield* builderOf(mission.id)
            const database = yield* Database
            const secrets = yield* Secrets
            // Rounds do not exist yet: an earlier Building of the mission is seeded in storage, and
            // so is a Building of another mission holding a higher number.
            const [own] = yield* database.select().from(missions).where(eq(missions.id, mission.id))
            if (own === undefined) return yield* Effect.die(new Error('no mission'))
            const other = { ...own, id: crypto.randomUUID(), keyNumber: own.keyNumber + 100 }
            yield* database.insert(missions).values({ ...other, idempotencyKey: null })
            const earlier = (missionId: string, numbers: ReadonlyArray<number>) =>
              Effect.gen(function* () {
                const id = crypto.randomUUID()
                // Earlier than the Building the mission is in, which is the latest one.
                const at = '2026-01-01T00:00:00.000Z'
                yield* database.insert(buildings).values({
                  id,
                  missionId,
                  label: 'Building',
                  round: 1,
                  workspaceId: null,
                  bases: '[]',
                  phase: 'ended',
                  state: 'ended',
                  startedAt: at,
                  endedAt: at,
                  tasksDoneAt: at,
                  endCalledAt: at,
                  reviewCheckpointId: null,
                  builderTurnedAt: null,
                  summary: null,
                })
                for (const [rank, number] of numbers.entries()) {
                  yield* database.insert(buildingTasks).values({
                    buildingId: id,
                    id: `RV${String(number)}`,
                    rank,
                    origin: 'review',
                    decisionId: null,
                    title: secrets.mask(`Earlier special task ${String(number)}`),
                    result: secrets.mask('Done.'),
                    requirements: '[]',
                    scenarios: '[]',
                    targets: secrets.mask('[]'),
                    dependsOn: '[]',
                    state: 'done',
                    replacedBy: '[]',
                    changes: '[]',
                  })
                }
              })
            yield* earlier(mission.id, [1, 2])
            yield* earlier(other.id, [1, 2, 3, 4, 5, 6, 7])
            yield* builtAll(builder.grantId)
            yield* documented(world, mission.id)
            yield* reviewed(world, mission.id, 'spec-reviewer')
            yield* reviewed(world, mission.id, 'code-reviewer', [
              warning('invoices.ts', 'Say how to export the invoices as Markdown.'),
            ])
            yield* specialAvailable(mission.id, 'RV3')
            const view = yield* buildingNow(mission.id)
            const review = yield* autoReviewOf(mission.id)
            return { ids: view.tasks.filter((one) => one.origin === 'review'), review }
          }),
        ),
      )
      expect(seen.ids.map((one) => one.id)).toEqual(['RV3'])
      expect(seen.review?.findings[0]).toMatchObject({ fate: 'special_task', taskId: 'RV3' })
    },
  )

  test(
    'a written answer to a contradicting finding is taken as "the Spec is right": its special task carries the user’s words',
    SLOW,
    async () => {
      const { world, run } = ending()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(work, withReadme)
            const builder = yield* builderOf(mission.id)
            yield* builtAll(builder.grantId)
            yield* documented(world, mission.id)
            yield* reviewed(world, mission.id, 'spec-reviewer', [
              {
                severity: 'blocking',
                requirement: 'R1',
                repository: 'api',
                path: 'invoices.ts',
                text: 'The CSV has no header row, which the scenario R1.S1 asks for.',
                contradicts_spec: true,
                evidence: 'R1.S1: as CSV, it works; invoices.ts writes no header.',
              },
            ])
            yield* reviewed(world, mission.id, 'code-reviewer')
            yield* until(
              Effect.map(getMission(mission.id), (one) => one.needs.length > 0),
              LONG,
            )
            const need = (yield* getMission(mission.id)).needs[0]
            yield* answerNeed({
              id: need?.id ?? '',
              answer: WrittenAnswer.make({ text: 'Add the header, and keep the column order.' }),
              key: 'written',
            })
            yield* specialAvailable(mission.id, 'RV1')
            const database = yield* Database
            return {
              tasks: yield* database
                .select({ id: buildingTasks.id, result: buildingTasks.result })
                .from(buildingTasks)
                .where(eq(buildingTasks.origin, 'review')),
              review: yield* autoReviewOf(mission.id),
            }
          }),
        ),
      )
      expect(seen.tasks).toHaveLength(1)
      expect(seen.tasks[0]?.result).toContain('The CSV has no header row')
      expect(seen.tasks[0]?.result).toContain('Add the header, and keep the column order.')
      const finding = seen.review?.findings[0]
      expect(finding).toMatchObject({ fate: 'special_task', taskId: 'RV1' })
    },
  )

  test(
    'two agreeing findings become RV1 and RV2, absent from the Spec’s tasks, delivered to the Builder, judged by checks; one red three times gives an error need; with no check, RV2 is done, not verified; neither counts in proven requirements; the percentage shows them apart',
    SLOW,
    async () => {
      const { world, run } = ending({
        checks: ({ scope, subject }) => (scope === 'task' && subject === 'RV1' ? [RED] : []),
      })
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(work, withReadme)
            const builder = yield* builderOf(mission.id)
            yield* builtAll(builder.grantId)
            yield* documented(world, mission.id)
            yield* reviewed(world, mission.id, 'spec-reviewer')
            yield* reviewed(world, mission.id, 'code-reviewer', [
              warning('invoices.ts', 'Write the header row of the CSV.'),
              warning('README.md', 'Say how to export as Markdown.'),
            ])
            yield* specialAvailable(mission.id, 'RV2')
            // The ready set is stored for the Builder a moment after the tasks are available.
            yield* until(
              Effect.map(toBuilder(mission.id, builder.session.lineage), (said) =>
                ['RV1', 'RV2'].every((task) => said.join('\n').includes(task)),
              ),
              LONG,
            )
            const told = yield* toBuilder(mission.id, builder.session.lineage)
            const plan = yield* buildingPartOf(mission.id)
            const rv2 = yield* specialDone(
              builder.grantId,
              'RV2',
              'README.md',
              'Acme api, as Markdown\n',
            )
            // A red attempt stays the runner's: it fixes and finishes again, twice.
            const reds = [
              yield* specialDone(
                builder.grantId,
                'RV1',
                'invoices.ts',
                'export const header = 1\n',
              ),
            ]
            for (const _ of [2, 3]) {
              reds.push(
                yield* call(builder.grantId, 'task_finished', { task: 'RV1', summary: 'Again.' }),
              )
            }
            yield* taskIn(mission.id, 'RV1', 'blocked')
            return {
              told,
              plan,
              rv2,
              reds,
              view: yield* buildingNow(mission.id),
              mission: yield* getMission(mission.id),
            }
          }),
        ),
      )
      expect(seen.told.join('\n')).toMatch(/RV1/)
      expect(seen.told.join('\n')).toMatch(/RV2/)
      // spec_read's effective plan keeps the Spec's tasks; the special tasks are listed apart.
      const [tasksPart, specialPart] = (seen.plan ?? '').split('## Special tasks')
      expect(tasksPart).not.toContain('RV1')
      expect(specialPart).toContain('RV1')
      expect(specialPart).toContain('RV2')
      expect(seen.rv2).toMatch(/RV2 is done, not verified/)
      expect(seen.reds.at(-1)).toMatch(/red for the third time/)
      const rv1 = seen.view.tasks.find((one) => one.id === 'RV1')
      expect(rv1).toMatchObject({
        origin: 'review',
        state: 'blocked',
        scenarios: [],
        requirements: [],
      })
      expect(seen.mission.needs.some((need) => Predicate.isTagged(need.fields, 'Error'))).toBe(true)
      expect(seen.mission.stage).toBe('building')
      expect(seen.view.counts).toMatchObject({ tasksDone: 4, tasks: 4 })
      expect(seen.view.special).toEqual({ done: 1, total: 2 })
      expect(seen.view.requirements.map((one) => one.id)).toEqual(['R1'])
      expect(seen.view.percent).toBe(83)
    },
  )

  test('no second review runs after the special tasks', SLOW, async () => {
    const { world, run } = ending()
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launched(work, withReadme)
          const builder = yield* builderOf(mission.id)
          yield* builtAll(builder.grantId)
          yield* documented(world, mission.id)
          yield* reviewed(world, mission.id, 'spec-reviewer')
          yield* reviewed(world, mission.id, 'code-reviewer', [
            warning('invoices.ts', 'Write the header row of the CSV.'),
          ])
          yield* specialAvailable(mission.id, 'RV1')
          yield* specialDone(builder.grantId, 'RV1', 'invoices.ts', 'export const header = true\n')
          yield* documented(world, mission.id, 2)
          yield* inReview(mission.id)
          yield* Effect.sleep('500 millis')
          const sessions = yield* sessionsIn(SESSION_STATES, {
            kind: 'mission',
            missionId: mission.id,
          })
          return {
            passes: yield* Database.use((database) => database.select().from(reviewPasses)),
            reviewers: sessions.filter((one) => one.role.endsWith('-reviewer')),
            started: yield* eventsOf(mission.id, 'review.pass_started'),
          }
        }),
      ),
    )
    expect(seen.passes).toHaveLength(2)
    expect(seen.reviewers).toHaveLength(2)
    expect(seen.started).toHaveLength(2)
  })
})

describe('The documenter’s delta', () => {
  test(
    'RV1 changing src/x.ts outside the doc recipes triggers one documenter delta; a change only in README.md does not',
    SLOW,
    async () => {
      const outside = ending()
      const seen = await outside.run(({ profile }) =>
        within(profile, throughSpecial(outside.world, 'src/x.ts', true)),
      )
      expect(seen.passes.map((one) => one.mode)).toEqual(['full', 'delta'])
      expect(JSON.parse(seen.passes[1]?.files ?? '[]')).toEqual([
        { repository: 'api', path: 'src/x.ts', status: 'A' },
      ])
      expect(seen.deltas).toHaveLength(1)

      newFolders('building-end-readme')
      const inRecipe = ending()
      const only = await inRecipe.run(({ profile }) =>
        within(profile, throughSpecial(inRecipe.world, 'README.md', false)),
      )
      expect(only.passes.map((one) => one.mode)).toEqual(['full'])
      expect(only.deltas).toHaveLength(0)
    },
  )
})

describe('What the review saw, and what changed after it', () => {
  test('review_changed_after lists src/x.ts, attributed to RV1', SLOW, async () => {
    const { world, run } = ending()
    const seen = await run(({ profile }) =>
      within(profile, throughSpecial(world, 'src/x.ts', true)),
    )
    expect(seen.review?.changedAfter).toContainEqual(
      expect.objectContaining({ repository: 'api', path: 'src/x.ts', status: 'M', by: 'RV1' }),
    )
    expect(seen.review?.checkpoint?.files.map((one) => `${one.repository}/${one.path}`)).toContain(
      'api/src/x.ts',
    )
  })

  test('a proof made stale by RV1 is re-run before Review', SLOW, async () => {
    const { world, run } = ending()
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launched(
            work,
            withReadme,
            undefined,
            PLAN,
            undefined,
            undefined,
            exportProof,
          )
          const builder = yield* builderOf(mission.id)
          yield* proofState(mission.id, 'R1.S2', 'red_recorded')
          yield* builtAll(builder.grantId)
          yield* documented(world, mission.id)
          yield* reviewed(world, mission.id, 'spec-reviewer')
          yield* reviewed(world, mission.id, 'code-reviewer', [
            warning('export.ts', 'Export a function, not a flag.'),
          ])
          yield* specialAvailable(mission.id, 'RV1')
          yield* specialDone(
            builder.grantId,
            'RV1',
            'export.ts',
            'export const toMarkdown = () => ""\n',
          )
          yield* documented(world, mission.id, 2)
          yield* inReview(mission.id)
          const database = yield* Database
          return {
            runs: yield* database
              .select()
              .from(proofRuns)
              .where(and(eq(proofRuns.missionId, mission.id), eq(proofRuns.scenario, 'R1.S2')))
              .orderBy(asc(proofRuns.at)),
            refreshed: yield* eventsOf(mission.id, 'building.proofs_refreshed'),
            types: yield* typesOf(mission.id),
            view: yield* buildingNow(mission.id),
          }
        }),
      ),
    )
    expect(seen.runs.map((one) => one.phase)).toContain('rerun')
    expect(JSON.parse(seen.refreshed.at(-1)?.payload ?? '{}')).toMatchObject({ proofs: ['R1.S2'] })
    expect(seen.types.indexOf('building.proofs_refreshed')).toBeLessThan(
      seen.types.indexOf('building.ended'),
    )
    const proof = seen.view.requirements
      .flatMap((one) => one.scenarios)
      .find((one) => one.scenario === 'R1.S2')
    expect(proof).toMatchObject({ state: 'green', upToDate: true })
  })
})

describe('The reviewers count in the cap', () => {
  test('with three sub-agents running, the reviewers wait for slots', SLOW, async () => {
    const { world, run } = ending()
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, mission } = yield* launched(work, withReadme)
          const builder = yield* builderOf(mission.id)
          const limits = yield* projectLimits(project.id)
          yield* setProjectLimits(project.id, { ...limits, cap: 4 })
          yield* builtAll(builder.grantId)
          const documenter = yield* agentOf(world, mission.id, 'documenter')
          const owner = { kind: 'mission' as const, missionId: mission.id }
          const helpers: RoleSession[] = []
          for (const _ of [1, 2, 3]) {
            helpers.push(
              yield* Sessions.use((sessions) =>
                sessions.open({
                  owner,
                  role: 'helper',
                  folder: builder.session.folder,
                  requestedBy: 'agent',
                }),
              ),
            )
          }
          yield* setProjectLimits(project.id, { ...limits, cap: 3 })
          const answer = yield* callTool(documenter.grantId, 'docs_report', {
            changed: [],
            no_change_reason: NO_DOC,
          })
          if (!answer.ok) return yield* Effect.die(new Error(answer.text))
          world.release(documenter.index)
          const now = Memory.use((memory) => memory.now(mission.id))
          yield* until(
            Effect.map(now, (state) => state.slotWait !== null),
            LONG,
          )
          const waiting = yield* now
          const passes = (yield* autoReviewOf(mission.id))?.passes ?? []
          yield* Sessions.use((sessions) => sessions.end(helpers[0]?.lineage ?? '', 'done'))
          const passesNow = Effect.map(autoReviewOf(mission.id), (review) => review?.passes ?? [])
          yield* until(
            Effect.map(passesNow, (rows) => rows.some((row) => row.state === 'running')),
            LONG,
          )
          const one = yield* passesNow
          yield* Sessions.use((sessions) => sessions.end(helpers[1]?.lineage ?? '', 'done'))
          yield* reviewing(mission.id)
          return {
            waiting,
            passes,
            one,
            waited: yield* eventsOf(mission.id, 'review.pass_waiting'),
          }
        }),
      ),
    )
    expect(seen.waiting.slotWait).toBe(
      'Automatic review waits for a free agent slot (3 of 3 in use)',
    )
    expect(seen.passes.map((one) => one.state)).toEqual(['waiting', 'waiting'])
    expect(seen.one.map((one) => one.state).toSorted()).toEqual(['running', 'waiting'])
    expect(seen.waited).toHaveLength(2)
  })

  test(
    'a restart while a reviewer runs and three sub-agents hold the cap: the rebuilt reviewer waits for a slot',
    SLOW,
    async () => {
      const before = ending()
      const left = await before.run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { project, mission } = yield* launched(work, withReadme)
            const builder = yield* builderOf(mission.id)
            const limits = yield* projectLimits(project.id)
            yield* setProjectLimits(project.id, { ...limits, cap: 6 })
            yield* builtAll(builder.grantId)
            const owner = { kind: 'mission' as const, missionId: mission.id }
            const helpers: string[] = []
            for (const _ of [1, 2, 3]) {
              const helper = yield* Sessions.use((sessions) =>
                sessions.open({
                  owner,
                  role: 'helper',
                  folder: builder.session.folder,
                  requestedBy: 'agent',
                }),
              )
              helpers.push(helper.lineage)
            }
            yield* documented(before.world, mission.id)
            yield* reviewing(mission.id)
            // The cap lowered while the engine was stopped: three slots for five sessions.
            yield* setProjectLimits(project.id, { ...limits, cap: 3 })
            return { mission, helpers }
          }),
        ),
      )
      // The reviewers start only once the three sub-agents hold every slot.
      const reviewersHeld = held()
      const after = ending({
        resumed: true,
        sessionHold: (at, session) =>
          at === 'starting' && REVIEWERS.some((one) => one === session.role)
            ? Effect.promise(() => reviewersHeld.promise)
            : Effect.void,
      })
      const missionId = left.mission.id
      const seen = await after.run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const live = Effect.map(
              sessionsIn(['starting', 'working', 'idle'], { kind: 'mission', missionId }),
              (rows) => rows.filter((row) => row.role !== 'builder'),
            )
            const running = Effect.map(live, (rows) =>
              rows.filter((row) => row.state !== 'starting'),
            )
            yield* until(
              Effect.map(
                running,
                (rows) => rows.filter((row) => row.role === 'helper').length === 3,
              ),
              LONG,
            )
            reviewersHeld.release()
            const now = Memory.use((memory) => memory.now(missionId))
            yield* until(
              Effect.map(now, (state) => state.slotWait !== null),
              LONG,
            )
            // Long enough for a reviewer that took no slot to start working.
            yield* Effect.sleep('1 second')
            const full = { now: yield* now, live: yield* live, running: yield* running }
            yield* Sessions.use((sessions) => sessions.end(left.helpers[0] ?? '', 'done'))
            yield* until(
              Effect.map(running, (rows) =>
                rows.some((row) => REVIEWERS.some((one) => one === row.role)),
              ),
              LONG,
            )
            yield* Effect.sleep('1 second')
            return { full, freed: yield* running }
          }),
        ),
      )
      expect(seen.full.live.filter((row) => row.role !== 'helper').map((row) => row.state)).toEqual(
        ['starting', 'starting'],
      )
      expect(seen.full.running.map((row) => row.role)).toEqual(['helper', 'helper', 'helper'])
      expect(seen.full.now.slotWait).toContain('3 of 3 in use')
      // A slot freed: one reviewer takes it, never more than the cap.
      expect(seen.freed).toHaveLength(3)
      expect(seen.freed.filter((row) => row.role === 'helper')).toHaveLength(2)
    },
  )

  test(
    'a restart while one pass runs, the other waits for its slot, and three sub-agents hold the cap: never more agents than the cap',
    SLOW,
    async () => {
      const before = ending()
      const left = await before.run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { project, mission } = yield* launched(work, withReadme)
            const builder = yield* builderOf(mission.id)
            const limits = yield* projectLimits(project.id)
            yield* setProjectLimits(project.id, { ...limits, cap: 4 })
            yield* builtAll(builder.grantId)
            yield* agentOf(before.world, mission.id, 'documenter')
            const owner = { kind: 'mission' as const, missionId: mission.id }
            for (const _ of [1, 2, 3]) {
              yield* Sessions.use((sessions) =>
                sessions.open({
                  owner,
                  role: 'helper',
                  folder: builder.session.folder,
                  requestedBy: 'agent',
                }),
              )
            }
            yield* documented(before.world, mission.id)
            // The documenter's slot goes to one reviewer; the other waits for one.
            yield* until(
              Effect.map(
                autoReviewOf(mission.id),
                (review) =>
                  (review?.passes.map((one) => one.state).toSorted() ?? []).join() ===
                  'running,waiting',
              ),
              LONG,
            )
            yield* setProjectLimits(project.id, { ...limits, cap: 3 })
            // What runs when the engine stops: rows the next start ends, not its agents.
            const stale = yield* sessionsIn(['working', 'idle'], owner)
            return { mission, stale: new Set(stale.map((row) => row.id)) }
          }),
        ),
      )
      const after = ending({ resumed: true })
      const seen = await after.run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const running = Effect.map(
              sessionsIn(['working', 'idle'], { kind: 'mission', missionId: left.mission.id }),
              (rows) => rows.filter((row) => row.role !== 'builder' && !left.stale.has(row.id)),
            )
            // Every look from the start: the most agents seen running at once.
            let most = 0
            const look = Effect.map(running, (rows) => {
              most = Math.max(most, rows.length)
              return rows
            })
            yield* until(
              Effect.map(look, (rows) => rows.length === 3),
              LONG,
            )
            for (const _ of Array.from({ length: 50 })) {
              yield* look
              yield* Effect.sleep('20 millis')
            }
            const full = yield* running
            const passes = (yield* autoReviewOf(left.mission.id))?.passes ?? []
            const first = full[0]
            if (first === undefined) return yield* Effect.die(new Error('nothing runs'))
            yield* Sessions.use((sessions) => sessions.end(first.lineage, 'done'))
            yield* until(
              Effect.map(
                look,
                (rows) => rows.length === 3 && !rows.some((row) => row.id === first.id),
              ),
              LONG,
            )
            for (const _ of Array.from({ length: 50 })) {
              yield* look
              yield* Effect.sleep('20 millis')
            }
            return { most, full, passes, freed: yield* running }
          }),
        ),
      )
      expect(seen.most).toBe(3)
      expect(seen.full).toHaveLength(3)
      expect(seen.freed).toHaveLength(3)
      // No pass is recorded again for the restart.
      expect(seen.passes).toHaveLength(2)
    },
  )
})

describe('What the review read is kept', () => {
  test(
    'retention run over a finished Building keeps its review checkpoint, and the database refuses to drop it',
    SLOW,
    async () => {
      const { world, run } = ending()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(work, withReadme)
            const builder = yield* builderOf(mission.id)
            yield* builtAll(builder.grantId)
            yield* documented(world, mission.id)
            yield* reviewed(world, mission.id, 'spec-reviewer')
            yield* reviewed(world, mission.id, 'code-reviewer')
            yield* inReview(mission.id)
            const database = yield* Database
            // The mission is over: nothing of it is live for the sweep any more.
            yield* database
              .update(missions)
              .set({ stage: 'done' })
              .where(eq(missions.id, mission.id))
            const [building] = yield* database
              .select()
              .from(buildings)
              .where(eq(buildings.missionId, mission.id))
            const kept = building?.reviewCheckpointId ?? ''
            const filesOf = database
              .select()
              .from(checkpointFiles)
              .where(eq(checkpointFiles.checkpointId, kept))
            const before = yield* filesOf
            // Retention driven a year ahead, its total bound at nothing: all it may sweep goes.
            const swept = yield* sweepDiagnostics(data, {
              now: Date.now() + 365 * 24 * 60 * 60 * 1000,
              maxTotalBytes: 0,
            })
            const dropped = yield* Effect.exit(
              database.delete(checkpoints).where(eq(checkpoints.id, kept)),
            )
            return {
              kept,
              swept,
              before,
              after: yield* filesOf,
              checkpoints: yield* database
                .select()
                .from(checkpoints)
                .where(eq(checkpoints.id, kept)),
              passes: yield* database
                .select()
                .from(reviewPasses)
                .where(eq(reviewPasses.missionId, mission.id)),
              dropped,
            }
          }),
        ),
      )
      expect(seen.swept.runs.length + seen.swept.threads.length).toBeGreaterThan(0)
      expect(seen.checkpoints).toHaveLength(1)
      expect(seen.before.length).toBeGreaterThan(0)
      expect(seen.after).toEqual(seen.before)
      expect(seen.passes.map((one) => one.checkpointId)).toEqual([seen.kept, seen.kept])
      // A review pass and the Building point to it: the database itself refuses to drop it.
      expect(Exit.isFailure(seen.dropped)).toBe(true)
    },
  )
})
