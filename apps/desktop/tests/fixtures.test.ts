/**
 * The fixtures (#420): named groups, each built from an empty base in a marked folder of its own
 * under a fixtures root, its state reached through the engine's services, the same twice.
 */

import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { Effect, Predicate, Result } from 'effect'
import { afterEach, describe, expect, test } from 'vite-plus/test'

import { EXPORT_TEST_PATH, MASKING_PLACES } from '../fixtures/agents.ts'
import { FIXTURE_GROUPS, buildFixture, fixtureList } from '../fixtures/build.ts'
import { reached } from '../fixtures/missions.ts'
import { FAKE_PAYMENTS_KEY } from '../fixtures/larkspur.ts'
import { chatsOf, transcriptOf } from '../src/engine/chat/store.ts'
import { FIXTURE_MARKER, checkFixtureFolder } from '../src/main/fixture-profile.ts'
import { buildingOf } from '../src/engine/building/builder.ts'
import { proofsRead } from '../src/engine/building/proofs.ts'
import { listColdReads } from '../src/engine/planning/cold-read-store.ts'
import { freezeReadiness } from '../src/engine/planning/freeze.ts'
import { readSpec } from '../src/engine/planning/store.ts'
import type { EngineServices } from '../src/engine/profile.ts'
import { listMissions } from '../src/engine/missions.ts'
import { listNeeds } from '../src/engine/needs.ts'
import { listProjects } from '../src/engine/projects.ts'
import { listRuns, runOutput } from '../src/engine/runs.ts'
import { listWorkspaces } from '../src/engine/workspaces.ts'
import { listVariables, revealVariable } from '../src/engine/variables.ts'
import { commandsEngine } from './commands-engine.ts'
import { git } from './repositories.ts'
import { removeFolders, temporaryFolder } from './storage.ts'

afterEach(removeFolders)

/** A fixtures root of the test's own, and a normal profile beside it that no fixture touches. */
const places = () => {
  const base = temporaryFolder('fixtures')
  return { root: join(base, 'fixtures'), normalProfile: join(base, 'config', 'Hemera') }
}

const built = (group: string, root: string, rebuild = false) =>
  buildFixture({ root, group, rebuild, log: () => undefined })

/** What a fixture's profile holds, as the services answer it, without the ids they draw. */
const stateOf = (profile: string) =>
  commandsEngine(profile)(({ profile: started }) =>
    started.use(
      Effect.gen(function* () {
        const projects = yield* listProjects
        return yield* Effect.forEach(projects, (project) =>
          Effect.gen(function* () {
            const scope = { projectId: project.id, workspaceId: null }
            const variables = yield* listVariables(scope)
            const revealed = yield* Effect.forEach(variables, ({ key }) =>
              Effect.map(revealVariable({ ...scope, key }), (value) => [key, value] as const),
            )
            const missions = yield* listMissions(project.id)
            return {
              name: project.name,
              keyPrefix: project.keyPrefix,
              mainCheckout: project.mainCheckout,
              repositories: project.repositories.map((repository) => ({
                path: repository.path,
                remote: repository.remote,
                baseBranch: repository.baseBranch,
              })),
              variables: Object.fromEntries(revealed),
              missions: missions.map((mission) => ({ stage: mission.stage })),
            }
          }),
        )
      }),
    ),
  )

/** Every branch of every repository a fixture made, with the commit it points at. */
const refsOf = (work: string) => {
  const found: Record<string, string> = {}
  const walk = (folder: string) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const path = join(folder, entry.name)
      if (existsSync(join(path, '.git')) || entry.name.endsWith('.git')) {
        found[path.slice(work.length)] = git(
          path,
          'for-each-ref',
          '--format=%(refname) %(objectname)',
        )
      } else walk(path)
    }
  }
  walk(work)
  return found
}

describe('The fixtures command', () => {
  test('it lists every group with what to test once it is open', () => {
    const listed = fixtureList()
    for (const group of FIXTURE_GROUPS) {
      expect(listed).toContain(group.name)
      expect(listed).toContain(group.look)
    }
    expect(FIXTURE_GROUPS.map((group) => group.name)).toEqual(
      expect.arrayContaining(['empty', 'project-ready']),
    )
  })

  test('a fixture folder carries the marker, and its profile is one the flag opens', async () => {
    const { root, normalProfile } = places()
    const fixture = await built('empty', root)
    expect(existsSync(join(fixture.folder, FIXTURE_MARKER))).toBe(true)
    expect(Result.isSuccess(checkFixtureFolder(fixture.profile, { root, normalProfile }))).toBe(
      true,
    )
  })

  test('the command refuses to build over a folder without the marker, and leaves it as it was', async () => {
    const { root } = places()
    const folder = join(root, 'empty')
    mkdirSync(folder, { recursive: true })
    writeFileSync(join(folder, 'notes.txt'), 'kept\n')
    await expect(built('empty', root)).rejects.toThrow(/carries no fixture marker/)
    await expect(built('empty', root, true)).rejects.toThrow(/carries no fixture marker/)
    expect(readdirSync(folder)).toEqual(['notes.txt'])
  })

  test('the command refuses a group it does not know', async () => {
    const { root } = places()
    await expect(built('../outside', root)).rejects.toThrow(/no fixture group/)
    expect(existsSync(root)).toBe(false)
  })
})

describe('Each group reaches its state from an empty base, checked through the services', () => {
  test('empty: the first launch, no project', async () => {
    const { root } = places()
    const fixture = await built('empty', root)
    expect(await stateOf(fixture.profile)).toEqual([])
  })

  test('project-ready: one project with two repositories, variables and a fake secret, nothing launched', async () => {
    const { root } = places()
    const fixture = await built('project-ready', root)
    const [project, ...others] = await stateOf(fixture.profile)
    expect(others).toEqual([])
    expect(project?.repositories.map((repository) => repository.path)).toEqual(['api', 'web'])
    for (const repository of project?.repositories ?? []) {
      // Each one's remote is a bare repository of the fixture, on the same disk: no network.
      expect(repository.remote).not.toBeNull()
      const checkout = join(project?.mainCheckout ?? '', repository.path)
      expect(git(checkout, 'remote', 'get-url', 'origin').startsWith(fixture.folder)).toBe(true)
      expect(Number(git(checkout, 'rev-list', '--count', '--all'))).toBeGreaterThan(2)
      expect(
        git(checkout, 'branch', '--format=%(refname:short)').split('\n').length,
      ).toBeGreaterThan(1)
      expect(existsSync(join(checkout, 'README.md'))).toBe(true)
    }
    expect(Object.keys(project?.variables ?? {})).toEqual(
      expect.arrayContaining(['API_BASE_URL', 'PAYMENTS_API_KEY']),
    )
    expect(project?.variables['PAYMENTS_API_KEY']).toMatch(/^sk-fixture-/)
    expect(project?.missions).toEqual([])
  })
})

/** Reads a fixture's profile through the services, once. */
const readIn = <A, E>(profile: string, program: Effect.Effect<A, E, EngineServices>) =>
  commandsEngine(profile)(({ profile: started }) => started.use(program))

/** The one mission of a fixture's one project. */
const onlyMission = Effect.gen(function* () {
  const [project] = yield* listProjects
  const [mission] = yield* listMissions(project?.id ?? '')
  if (mission === undefined) return yield* Effect.die(new Error('the fixture has no mission'))
  return mission
})

describe('The mission groups reach their state through the engine, with scripted agents', () => {
  test('planning: a mission in Planning with a plan to read and judge', async () => {
    const { root } = places()
    const fixture = await built('planning', root)
    const seen = await readIn(
      fixture.profile,
      Effect.gen(function* () {
        const mission = yield* onlyMission
        return {
          mission,
          spec: yield* readSpec(mission.id),
          coldReads: yield* listColdReads(mission.id),
          readiness: yield* freezeReadiness(mission.id),
        }
      }),
    )
    expect(seen.mission.stage).toBe('planning')
    expect(seen.mission.frozen).toBe(false)
    // The Planner wrote it whole and declared it complete; the cold read found nothing.
    expect(seen.spec.declaredCompleteVersion).toBe(seen.spec.version)
    expect(seen.spec.requirements.length).toBeGreaterThan(0)
    expect(seen.spec.tasks.length).toBeGreaterThan(1)
    expect(seen.coldReads.map((pass) => pass.state)).toEqual(['done'])
    expect(seen.readiness.ready).toBe(true)
  })

  test('building-red: a mission in Building; one scenario has a red proof waiting, another is green', async () => {
    const { root } = places()
    const fixture = await built('building-red', root)
    const seen = await readIn(
      fixture.profile,
      Effect.gen(function* () {
        const mission = yield* onlyMission
        return { mission, proofs: yield* proofsRead(mission.id) }
      }),
    )
    expect(seen.mission.stage).toBe('building')
    const states = Object.fromEntries(
      (seen.proofs?.scenarios ?? []).map((one) => [one.scenario, one.state]),
    )
    expect(states).toEqual({ 'R1.S1': 'red_recorded', 'R1.S2': 'green' })
  }, 120_000)

  test("permission-request: an agent's call waiting for approval", async () => {
    const { root } = places()
    const fixture = await built('permission-request', root)
    const seen = await readIn(
      fixture.profile,
      Effect.gen(function* () {
        const mission = yield* onlyMission
        return { mission, needs: (yield* listNeeds).flatMap((group) => group.needs) }
      }),
    )
    expect(seen.mission.stage).toBe('building')
    // A pending request survives the engine's restart: the application opens on it.
    const asking = seen.needs.filter((need) => need.choices.length > 0)
    expect(asking).toHaveLength(1)
    expect(asking[0]?.requestedBy).toBe('builder')
    expect(asking[0]?.choices).toEqual(expect.arrayContaining(['allow-once', 'deny']))
  }, 120_000)

  test('building-not-proven: a quiet Builder and the "not proven" question pending', async () => {
    const { root } = places()
    const fixture = await built('building-not-proven', root)
    const seen = await readIn(
      fixture.profile,
      Effect.gen(function* () {
        const mission = yield* onlyMission
        return { mission, needs: (yield* listNeeds).flatMap((group) => group.needs) }
      }),
    )
    expect(seen.mission.stage).toBe('building')
    const questions = seen.needs.flatMap((need) =>
      Predicate.isTagged(need.fields, 'Decision') ? [need.fields.question] : [],
    )
    expect(questions).toEqual([expect.stringContaining('R1.S1 is not proven')])
  }, 120_000)

  test('building-outside-change: a fix written outside Hemera while a proof failed', async () => {
    const { root } = places()
    const fixture = await built('building-outside-change', root)
    const seen = await readIn(
      fixture.profile,
      Effect.gen(function* () {
        const mission = yield* onlyMission
        return { mission, proofs: yield* proofsRead(mission.id) }
      }),
    )
    expect(seen.mission.stage).toBe('building')
    expect(seen.mission.marks.map((mark) => mark.sentence)).toEqual(
      expect.arrayContaining([expect.stringMatching(/outside Hemera/i)]),
    )
    const s1 = seen.proofs?.scenarios.find((one) => one.scenario === 'R1.S1')
    // Red at the start, its green failed on the Builder's export, then passed on the user's fix.
    expect(s1?.runs.map((run) => [run.phase, run.classification])).toEqual([
      ['red', 'assertion_failed'],
      ['green', 'assertion_failed'],
      ['green', 'passed'],
    ])
  }, 120_000)

  test('masking: tool outputs that hold the fake secrets: headers, URLs, JSON in prose, JSON in a JSON string', async () => {
    const { root } = places()
    const fixture = await built('masking', root)
    const said = await readIn(
      fixture.profile,
      Effect.gen(function* () {
        const [project] = yield* listProjects
        const [chat] = yield* chatsOf(project?.id ?? '')
        const [run] = yield* listRuns(project?.id ?? '', null)
        return {
          chat: JSON.stringify((yield* transcriptOf(chat?.id ?? '', null)).entries),
          run: (yield* runOutput(run?.id ?? '')).output,
        }
      }),
    )
    // Every place the key was put is shown, the key in none of them.
    for (const shown of [said.chat, said.run]) {
      expect(shown).not.toContain(FAKE_PAYMENTS_KEY)
      for (const place of MASKING_PLACES) expect(shown).toContain(place)
      expect(shown.split('•••').length - 1).toBeGreaterThanOrEqual(MASKING_PLACES.length)
    }
  }, 120_000)

  test('review-findings: Review with findings RV1, RV2 and a special task', async () => {
    const { root } = places()
    const fixture = await built('review-findings', root)
    const seen = await readIn(
      fixture.profile,
      Effect.gen(function* () {
        const mission = yield* onlyMission
        return { mission, building: yield* buildingOf(mission.id) }
      }),
    )
    expect(seen.mission.stage).toBe('review')
    const special = (seen.building?.tasks ?? []).filter((task) => task.id.startsWith('RV'))
    expect(special.map((task) => [task.id, task.state])).toEqual([
      ['RV1', 'done'],
      ['RV2', 'done'],
    ])
  }, 180_000)

  test('exit-during-run: a proof run going on when the application closes, to test the exit and the restart', async () => {
    const { root } = places()
    const fixture = await built('exit-during-run', root)
    const seen = await readIn(
      fixture.profile,
      Effect.gen(function* () {
        const mission = yield* onlyMission
        const [workspace] = yield* listWorkspaces(mission.projectId)
        return {
          mission,
          proofs: yield* proofsRead(mission.id),
          runs: yield* listRuns(mission.projectId, workspace?.id ?? null),
        }
      }),
    )
    expect(seen.mission.stage).toBe('building')
    // The green of R1.S1 was going when the engine closed: cut, and not recorded.
    const s1 = seen.proofs?.scenarios.find((one) => one.scenario === 'R1.S1')
    expect(s1?.state).toBe('red_recorded')
    expect(s1?.runs.map((run) => run.phase)).toEqual(['red'])
    const cut = seen.runs.filter(
      (run) => run.line.includes(EXPORT_TEST_PATH) && run.state !== 'failed',
    )
    expect(cut.map((run) => run.state)).toEqual([expect.stringMatching(/^(stopped|interrupted)$/)])
    // Opened again, the engine runs that green again at its start.
    const again = await readIn(
      fixture.profile,
      Effect.gen(function* () {
        const mission = yield* onlyMission
        const [workspace] = yield* listWorkspaces(mission.projectId)
        const running = Effect.map(listRuns(mission.projectId, workspace?.id ?? null), (runs) =>
          runs.filter((run) => run.line.includes(EXPORT_TEST_PATH) && run.state === 'running'),
        )
        yield* reached(
          'the green running again',
          Effect.map(running, (runs) => runs.length > 0),
        )
        return yield* running
      }),
    )
    expect(again).toHaveLength(1)
  }, 120_000)

  test('ended: listed with its state, and refused while no service reaches Done', async () => {
    const { root } = places()
    const ended = FIXTURE_GROUPS.find((group) => group.name === 'ended')
    expect(ended?.notYet).toMatch(/Done/)
    expect(fixtureList()).toContain(`not built yet: ${ended?.notYet ?? ''}`)
    await expect(built('ended', root)).rejects.toThrow(/ended cannot be built yet/)
    expect(existsSync(root)).toBe(false)
  })

  test('cancelled: a planned mission the user cancelled', async () => {
    const { root } = places()
    const fixture = await built('cancelled', root)
    const mission = await readIn(fixture.profile, onlyMission)
    expect(mission.stage).toBe('cancelled')
    expect(mission.ball).toBeNull()
  })
})

describe('--rebuild', () => {
  test('--rebuild gives the same state twice', async () => {
    const { root } = places()
    const first = await built('project-ready', root)
    const state = await stateOf(first.profile)
    const refs = refsOf(first.work)
    const again = await built('project-ready', root, true)
    expect(again.folder).toBe(first.folder)
    expect(await stateOf(again.profile)).toEqual(state)
    // The same commits, to the hash: fixed authors, fixed dates, no randomness.
    expect(refsOf(again.work)).toEqual(refs)
    expect(Object.keys(refs).length).toBeGreaterThan(3)
  })

  test('without --rebuild, a fixture already built is opened as it is', async () => {
    const { root } = places()
    const first = await built('project-ready', root)
    writeFileSync(join(first.work, 'left-by-hand.txt'), 'kept\n')
    await built('project-ready', root)
    expect(existsSync(join(first.work, 'left-by-hand.txt'))).toBe(true)
  })
})
