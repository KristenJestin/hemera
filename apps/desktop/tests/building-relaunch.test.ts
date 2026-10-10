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

import { Effect, Result } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { backToPlanningFromCheck, checkMission } from '../src/engine/building/check.ts'
import { launchMission, preparationOf } from '../src/engine/building/launch.ts'
import { getMission, moveMission } from '../src/engine/missions.ts'
import { getNeed, retryNeed } from '../src/engine/needs.ts'
import { getProject } from '../src/engine/projects.ts'
import { saveRecipe } from '../src/engine/recipe.ts'
import { getWorkspace } from '../src/engine/workspaces.ts'
import {
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
  refrozen,
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
          return { branch: hasBranch(api, BRANCH), mission: yield* getMission(mission.id) }
        }),
      ),
    )
    expect(seen.mission.stage).toBe('cancelled')
    expect(seen.branch).toBe(false)
    expect(starts.missions).toEqual([])
  })
})
