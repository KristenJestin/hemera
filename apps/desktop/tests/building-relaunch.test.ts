/**
 * A launch that does not end in Building (#139): sent back to Planning, cancelled, or whose
 * Workspace could not be made, it leaves nothing that stops the next launch; Retry after it does
 * nothing; a check that no longer holds, or whose agent did not answer, is not launched as is.
 *
 * On the engine as it starts, with the fake agent of #32 as every agent, Acme's real repositories
 * and a bare remote in temporary folders. Every wait is on state.
 */

import { realpathSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { CHECK_EXPIRED } from '@hemera/core/domain'
import { Effect, Result } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { backToPlanningFromCheck, checkMission } from '../src/engine/building/check.ts'
import { launchMission, preparationOf } from '../src/engine/building/launch.ts'
import { getMission, moveMission } from '../src/engine/missions.ts'
import { getNeed, retryNeed } from '../src/engine/needs.ts'
import { getProject, removeRepository } from '../src/engine/projects.ts'
import { returnToPlanning } from '../src/engine/planning/freeze.ts'
import { saveRecipe } from '../src/engine/recipe.ts'
import { getWorkspace, removeWorkspace } from '../src/engine/workspaces.ts'
import {
  PACKAGE,
  QUIET,
  READING,
  acmeAt,
  agents,
  buildingEngine,
  checked,
  eventsOf,
  frozenIn,
  heldRecipe,
  inStage,
  pushedOnRemote,
  refrozen,
  refusedWith,
  startedIn,
} from './building-world.ts'
import { git } from './repositories.ts'
import { until, within } from './sessions-world.ts'
import { removeFolders, temporaryFolder } from './storage.ts'

let data: string
let work: string

beforeEach(() => {
  data = realpathSync.native(temporaryFolder('building-relaunch'))
  work = realpathSync.native(temporaryFolder('building-relaunch-work'))
})
afterEach(removeFolders)

const BRANCH = 'acme/acme-1-invoices-as-csv'

/** Whether a branch is in a repository. */
const hasBranch = (folder: string, branch: string) =>
  git(folder, 'branch', '--list', branch).trim() !== ''

/** Whether a Workspace is still recorded. */
const workspaceKept = (id: string) =>
  Effect.map(Effect.result(getWorkspace(id)), (found) => Result.isSuccess(found))

/** The recipe copies `.env`, which is gone by the launch: its step fails, `restore` puts it back. */
const failingRecipe = (projectId: string, api: string) =>
  Effect.gen(function* () {
    const fresh = yield* getProject(projectId)
    const apiId = fresh.repositories.find((one) => one.path === 'api')?.id ?? null
    writeFileSync(join(api, '.env'), 'TOKEN=local\n')
    yield* saveRecipe({
      projectId,
      version: fresh.version,
      steps: [{ kind: 'copy', repositoryId: apiId, path: '.env', commandId: null, line: null }],
    })
    rmSync(join(api, '.env'))
    return { restore: () => writeFileSync(join(api, '.env'), 'TOKEN=local\n') }
  })

/** A Ready mission checked, and its check. */
const checkedReady = (projectId: string, main: string) =>
  Effect.gen(function* () {
    const { mission } = yield* frozenIn(projectId, main)
    yield* checkMission(mission.id)
    return { mission, view: yield* checked(mission.id) }
  })

describe('Back to Planning ends the launch under way', () => {
  test('a failed launch, then Back to Planning: the launch is cancelled, its need withdrawn, its Workspace and branch removed; Retry does nothing; after a new Freeze the mission launches again', async () => {
    // The cold read, then the fresh Planner, then the second cold read.
    const { run, starts } = buildingEngine(data, work, agents(QUIET, READING))
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main, api } = yield* acmeAt(work)
          const recipe = yield* failingRecipe(project.id, api)
          const { mission, view } = yield* checkedReady(project.id, main)
          yield* launchMission(mission.id, view.id, 'launch')
          yield* until(Effect.map(preparationOf(mission.id), (one) => one?.state === 'failed'))
          const failed = yield* preparationOf(mission.id)
          yield* backToPlanningFromCheck(mission.id, view.id)
          yield* until(Effect.map(preparationOf(mission.id), (one) => one?.state === 'cancelled'))
          yield* until(Effect.map(workspaceKept(failed?.workspaceId ?? ''), (kept) => !kept))
          // The branch goes after the Workspace, in the same cleanup.
          yield* until(Effect.sync(() => !hasBranch(api, BRANCH)))
          recipe.restore()
          yield* retryNeed(failed?.needId ?? '')
          const afterRetry = yield* getMission(mission.id)
          const need = yield* getNeed(failed?.needId ?? '')
          const branchAfter = hasBranch(api, BRANCH)
          yield* refrozen(mission.id)
          yield* checkMission(mission.id)
          const again = yield* checked(mission.id)
          yield* launchMission(mission.id, again.id, 'launch')
          yield* inStage(mission.id, 'building')
          yield* startedIn(starts)
          return {
            afterRetry,
            need,
            branchAfter,
            launched: yield* eventsOf(mission.id, 'building.launched'),
          }
        }),
      ),
    )
    expect(seen.need.state).toBe('withdrawn')
    expect(seen.afterRetry.stage).toBe('planning')
    expect(seen.branchAfter).toBe(false)
    expect(seen.launched).toHaveLength(1)
    expect(starts.missions).toHaveLength(1)
  })

  test('a launch preparing, then Back to Planning and a new Freeze before its recipe ends: the recipe’s end moves nothing, and its Workspace goes', async () => {
    const { run, starts } = buildingEngine(data, work, agents(QUIET, READING))
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main, api } = yield* acmeAt(work)
          const held = yield* heldRecipe(work, project.id)
          const { mission, view } = yield* checkedReady(project.id, main)
          const preparing = yield* launchMission(mission.id, view.id, 'launch')
          yield* backToPlanningFromCheck(mission.id, view.id)
          yield* refrozen(mission.id)
          held.release()
          yield* until(Effect.map(workspaceKept(preparing.workspaceId ?? ''), (kept) => !kept))
          // The branch goes after the Workspace, in the same cleanup.
          yield* until(Effect.sync(() => !hasBranch(api, BRANCH)))
          return {
            mission: yield* getMission(mission.id),
            preparation: yield* preparationOf(mission.id),
            launched: yield* eventsOf(mission.id, 'building.launched'),
            branch: hasBranch(api, BRANCH),
          }
        }),
      ),
    )
    expect(seen.mission.stage).toBe('ready')
    expect(seen.preparation?.state).toBe('cancelled')
    expect(seen.launched).toEqual([])
    expect(seen.branch).toBe(false)
    expect(starts.missions).toEqual([])
  })

  test('a check from before a return to Planning and a new Freeze no longer holds', async () => {
    const { run } = buildingEngine(data, work, agents(QUIET, READING))
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main } = yield* acmeAt(work)
          const { mission, view } = yield* checkedReady(project.id, main)
          yield* returnToPlanning(mission.id, 'The totals are missing.')
          yield* refrozen(mission.id)
          return yield* Effect.result(launchMission(mission.id, view.id, 'launch'))
        }),
      ),
    )
    const reasons = refusedWith(seen)
    expect(reasons?.[0]).toBe(CHECK_EXPIRED)
    expect(reasons?.join('\n')).toMatch(/The Spec changed since the check/)
  })
})

describe('A launch that did not end in Building leaves nothing in the way', () => {
  test('a mission cancelled during its preparation: the launch is cancelled, its Workspace and branch go once the recipe ends, and nothing starts', async () => {
    const { run, starts } = buildingEngine(data, work, agents())
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main, api } = yield* acmeAt(work)
          const held = yield* heldRecipe(work, project.id)
          const { mission, view } = yield* checkedReady(project.id, main)
          const preparing = yield* launchMission(mission.id, view.id, 'launch')
          yield* moveMission(mission.id, 'cancel', 'user')
          yield* until(Effect.map(preparationOf(mission.id), (one) => one?.state === 'cancelled'))
          held.release()
          yield* until(Effect.map(workspaceKept(preparing.workspaceId ?? ''), (kept) => !kept))
          // The branch goes after the Workspace, in the same cleanup.
          yield* until(Effect.sync(() => !hasBranch(api, BRANCH)))
          return { branch: hasBranch(api, BRANCH), mission: yield* getMission(mission.id) }
        }),
      ),
    )
    expect(seen.mission.stage).toBe('cancelled')
    expect(seen.branch).toBe(false)
    expect(starts.missions).toEqual([])
  })

  test('a Workspace that cannot be made: the launch is refused and its row goes, so the mission launches once the cause is gone', async () => {
    const { run } = buildingEngine(data, work, agents())
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main, api } = yield* acmeAt(work)
          const { mission, view } = yield* checkedReady(project.id, main)
          // Someone made the mission's branch by hand.
          git(api, 'branch', BRANCH)
          const refused = yield* Effect.result(launchMission(mission.id, view.id, 'launch'))
          const after = yield* preparationOf(mission.id)
          git(api, 'branch', '-D', BRANCH)
          yield* launchMission(mission.id, view.id, 'launch')
          yield* inStage(mission.id, 'building')
          return { refused, after }
        }),
      ),
    )
    expect(refusedWith(seen.refused)?.[0]).toMatch(/The Workspace could not be made/)
    expect(seen.after).toBeNull()
  })

  test('Retry when the failed launch’s Workspace was removed meanwhile: the launch stays failed and its need pending', async () => {
    const { run } = buildingEngine(data, work, agents())
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main, api } = yield* acmeAt(work)
          yield* failingRecipe(project.id, api)
          const { mission, view } = yield* checkedReady(project.id, main)
          yield* launchMission(mission.id, view.id, 'launch')
          yield* until(Effect.map(preparationOf(mission.id), (one) => one?.state === 'failed'))
          const failed = yield* preparationOf(mission.id)
          yield* removeWorkspace(failed?.workspaceId ?? '')
          yield* retryNeed(failed?.needId ?? '')
          return {
            preparation: yield* preparationOf(mission.id),
            need: yield* getNeed(failed?.needId ?? ''),
          }
        }),
      ),
    )
    expect(seen.preparation?.state).toBe('failed')
    expect(seen.need.state).toBe('pending')
  })
})

describe('A check is launched as is only when it checked everything it read', () => {
  test('a check whose agent did not answer needs Launch anyway', async () => {
    const { run } = buildingEngine(data, work, agents(QUIET))
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main, bare } = yield* acmeAt(work)
          const { mission } = yield* frozenIn(project.id, main)
          pushedOnRemote(work, bare, (clone) =>
            writeFileSync(join(clone, 'package.json'), PACKAGE.replace('{}', '{ "csv": "1.0.0" }')),
          )
          yield* checkMission(mission.id)
          const view = yield* checked(mission.id)
          const plain = yield* Effect.result(launchMission(mission.id, view.id, 'launch'))
          yield* launchMission(mission.id, view.id, 'launch_anyway')
          yield* inStage(mission.id, 'building')
          return { view, plain }
        }),
      ),
    )
    expect(seen.view.agent.state).toBe('unanswered')
    expect(refusedWith(seen.plain)?.join(' ')).toMatch(/Launch anyway/)
  })

  test('a repository removed from the Project since the check makes the check expire', async () => {
    const { run } = buildingEngine(data, work, agents())
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main } = yield* acmeAt(work)
          const { mission, view } = yield* checkedReady(project.id, main)
          const fresh = yield* getProject(project.id)
          const web = fresh.repositories.find((one) => one.path === 'web')
          yield* removeRepository({ id: web?.id ?? '', version: fresh.version })
          return yield* Effect.result(launchMission(mission.id, view.id, 'launch'))
        }),
      ),
    )
    const reasons = refusedWith(seen)
    expect(reasons?.[0]).toBe(CHECK_EXPIRED)
    expect(reasons?.join('\n')).toMatch(/web was removed from the Project since the check/)
  })
})
