/**
 * The fixtures (#420): named groups, each built from an empty base in a marked folder of its own
 * under a fixtures root, its state reached through the engine's services, the same twice.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { Effect, Exit, Predicate, Result } from 'effect'
import { afterEach, describe, expect, test } from 'vite-plus/test'

import { EXPORT_TEST_PATH, MASKING_PLACES } from '../fixtures/agents.ts'
import { FIXTURE_GROUPS, buildFixture, fixtureList, notBuilt } from '../fixtures/build.ts'
import { checkLaunchable, reached } from '../fixtures/missions.ts'
import { FAKE_PAYMENTS_KEY } from '../fixtures/larkspur.ts'
import { chatsOf, transcriptOf } from '../src/engine/chat/store.ts'
import {
  FIXTURE_FLAG,
  FIXTURE_FORGE,
  FIXTURE_MARKER,
  checkFixtureFolder,
  fixtureEnvironment,
  fixtureOpenedBy,
} from '../src/main/fixture-profile.ts'
import { buildingOf } from '../src/engine/building/builder.ts'
import { DATABASE_FILE } from '../src/engine/migrate.ts'
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
  const normalProfile = join(base, 'config', 'Hemera')
  return { base, root: join(base, 'fixtures'), normalProfile, normalProfiles: [normalProfile] }
}

/** The normal profile of every build, for a test that does not name its own: a folder of the test's. */
const NORMAL = [join(temporaryFolder('fixtures-normal'), 'Hemera')]

/**
 * The home every build and every reading of the suite runs on: its own, so what the machine's home
 * configuration does while the suite runs never stops the engine's Git (#483).
 */
const HOME = temporaryFolder('fixtures-home')

/** What an engine of the suite opened on a fixture's profile is handed: the suite's home. */
const SUITE_PARTS = { tools: { home: HOME } }

const built = (
  group: string,
  root: string,
  rebuild = false,
  normalProfiles: ReadonlyArray<string> = NORMAL,
) => buildFixture({ root, group, rebuild, log: () => undefined, normalProfiles, home: HOME })

/** What a fixture's profile holds, as the services answer it, without the ids they draw. */
const stateOf = (profile: string) =>
  commandsEngine(
    profile,
    SUITE_PARTS,
  )(({ profile: started }) =>
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
    const { root, normalProfiles } = places()
    const fixture = await built('empty', root, false, normalProfiles)
    expect(existsSync(join(fixture.folder, FIXTURE_MARKER))).toBe(true)
    expect(Result.isSuccess(checkFixtureFolder(fixture.profile, { root, normalProfiles }))).toBe(
      true,
    )
  })

  test('the command checks where it would build before it writes anything: a root inside a normal profile stays untouched', async () => {
    const { base } = places()
    const normalProfile = join(base, 'config', 'Hemera')
    mkdirSync(normalProfile, { recursive: true })
    writeFileSync(join(normalProfile, 'hemera.db'), "the user's own\n")
    const root = join(normalProfile, 'fixtures')
    await expect(built('empty', root, false, [normalProfile])).rejects.toThrow(
      /is the profile Hemera uses normally/,
    )
    expect(readdirSync(normalProfile)).toEqual(['hemera.db'])
  })

  test('the command refuses a root that is a link, and writes nothing where it leads', async () => {
    const { base } = places()
    const outside = join(base, 'outside')
    mkdirSync(outside)
    writeFileSync(join(outside, 'precious.txt'), 'kept\n')
    const root = join(base, 'fixtures')
    // A junction needs no privilege on Windows; elsewhere the type is ignored.
    symlinkSync(outside, root, 'junction')
    await expect(built('empty', root)).rejects.toThrow(/is a link/)
    await expect(built('empty', root, true)).rejects.toThrow(/is a link/)
    expect(readdirSync(outside)).toEqual(['precious.txt'])
  })

  test.skipIf(process.platform === 'win32')(
    'the command makes the root for the user alone',
    async () => {
      const { root } = places()
      await built('empty', root)
      expect(statSync(root).mode & 0o777).toBe(0o700)
    },
  )

  test('the application opened by its flag alone, without the command, runs the fake gh and bkt, never the real ones', async () => {
    const { root } = places()
    const fixture = await built('empty', root)
    const real = join(temporaryFolder('fixtures-real-path'), 'bin')
    const pathKey = process.platform === 'win32' ? 'Path' : 'PATH'
    const opened = fixtureEnvironment(fixture.profile, { [pathKey]: real, HOME: '/home/someone' })
    if (Result.isFailure(opened)) throw new Error(opened.failure)
    const [fakes, ...rest] = (opened.success[pathKey] ?? '').split(delimiter)
    expect(rest).toEqual([real])
    // The fakes come first, from the fixture's own folder, and so do their account and log.
    expect(fakes?.startsWith(fixture.folder)).toBe(true)
    const shims = readdirSync(fakes ?? '')
    for (const cli of ['gh', 'bkt'])
      expect(shims).toContainEqual(expect.stringMatching(new RegExp(`^${cli}(\\.cmd)?$`)))
    for (const name of ['GH_CONFIG_DIR', 'FAKE_FORGE_LOG', 'FAKE_FORGE_RULES']) {
      expect(opened.success[name]?.startsWith(fixture.folder)).toBe(true)
    }
    // What main opens on the flag: the profile, and that environment with it.
    const asked = {
      argv: ['electron', '.', `${FIXTURE_FLAG}=${fixture.profile}`],
      packaged: false,
      root,
      normalProfiles: NORMAL,
      env: { [pathKey]: real },
    }
    const main = fixtureOpenedBy(asked)
    expect(main !== null && Result.isSuccess(main) && main.success.env[pathKey]).toBe(
      opened.success[pathKey],
    )
    // A fixture whose fake forge is missing is refused rather than opened on the real CLIs.
    rmSync(join(fixture.profile, FIXTURE_FORGE))
    expect(Result.isFailure(fixtureEnvironment(fixture.profile, { [pathKey]: real }))).toBe(true)
    const refused = fixtureOpenedBy(asked)
    expect(refused !== null && Result.isFailure(refused) && refused.failure).toMatch(
      /has no fake forge/,
    )
  })

  test('a fixture opened on a forge file of any other shape is refused: never the real gh', async () => {
    const { base, root } = places()
    const fixture = await built('empty', root)
    const file = join(fixture.profile, FIXTURE_FORGE)
    // SAFETY: the command writes the file as JSON of string values, read back here as written.
    const written = JSON.parse(readFileSync(file, 'utf8')) as Record<string, string>
    const refusalWith = (forge: Readonly<Record<string, string>>) => {
      writeFileSync(file, JSON.stringify(forge))
      const opened = fixtureEnvironment(fixture.profile, { PATH: '/usr/bin' })
      return Result.isFailure(opened) ? opened.failure : 'accepted'
    }
    expect(refusalWith(written)).toBe('accepted')
    // A variable the fake forge does not write, NODE_OPTIONS first among them.
    expect(refusalWith({ ...written, NODE_OPTIONS: '--require /elsewhere/evil.js' })).toMatch(
      /NODE_OPTIONS is not a variable of the fake forge/,
    )
    // A PATH outside the fixture, or more than the fakes' one folder.
    const outside = join(base, 'realbin')
    mkdirSync(outside)
    for (const cli of ['gh', 'bkt', 'gh.cmd', 'bkt.cmd']) writeFileSync(join(outside, cli), '')
    expect(refusalWith({ ...written, PATH: outside })).toMatch(/is not inside the fixture/)
    expect(
      refusalWith({ ...written, PATH: `${written['PATH'] ?? ''}${delimiter}${outside}` }),
    ).toMatch(/is not inside the fixture/)
    // Another of its places outside the fixture.
    expect(refusalWith({ ...written, GH_CONFIG_DIR: outside })).toMatch(/is not inside the fixture/)
    // A forge file that is a link, even to a file the command wrote.
    writeFileSync(file, JSON.stringify(written))
    const elsewhere = join(base, 'forge.json')
    writeFileSync(elsewhere, JSON.stringify(written))
    rmSync(file)
    symlinkSync(elsewhere, file, 'file')
    const linked = fixtureEnvironment(fixture.profile, { PATH: '/usr/bin' })
    expect(Result.isFailure(linked) && linked.failure).toMatch(/is a link/)
  })

  test('a fixture whose fakes are gone is refused rather than opened on the real gh', async () => {
    const { root } = places()
    const fixture = await built('empty', root)
    // SAFETY: the command writes the file as JSON of string values, read back here as written.
    const written = JSON.parse(
      readFileSync(join(fixture.profile, FIXTURE_FORGE), 'utf8'),
    ) as Record<string, string>
    const fakes = written['PATH'] ?? ''
    const bkt = readdirSync(fakes).find((name) => name.startsWith('bkt')) ?? 'bkt'
    rmSync(join(fakes, bkt))
    const missing = fixtureEnvironment(fixture.profile, { PATH: '/usr/bin' })
    expect(Result.isFailure(missing) && missing.failure).toMatch(/holds no fake bkt/)
    rmSync(fakes, { recursive: true })
    const gone = fixtureEnvironment(fixture.profile, { PATH: '/usr/bin' })
    expect(Result.isFailure(gone) && gone.failure).toMatch(/holds no fake gh/)
  })

  test('a fixture opens with every forge token of the user emptied', async () => {
    const { root } = places()
    const fixture = await built('empty', root)
    const tokens = [
      'GH_TOKEN',
      'GITHUB_TOKEN',
      'GH_ENTERPRISE_TOKEN',
      'GITHUB_ENTERPRISE_TOKEN',
      'BKT_TOKEN',
    ]
    const opened = fixtureEnvironment(fixture.profile, {
      PATH: '/usr/bin',
      ...Object.fromEntries(tokens.map((name) => [name, 'the-user-s-own'])),
    })
    if (Result.isFailure(opened)) throw new Error(opened.failure)
    for (const name of tokens) expect(opened.success[name]).toBe('')
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

describe('A fixture that could not be built says why where the test prints it (#483)', () => {
  test("the error holds the engine's last lines, not only where they are", () => {
    const folder = temporaryFolder('fixtures-log')
    const log = join(folder, 'build.log')
    writeFileSync(log, Array.from({ length: 100 }, (_, at) => `line ${String(at + 1)}\n`).join(''))
    const error = notBuilt('review-findings', log, new Error('the check failed'))
    expect(error.message).toContain(log)
    expect(error.message).toContain('line 61\nline 62')
    expect(error.message).toContain('line 100')
    expect(error.message).not.toContain('line 60\n')
    expect(error.cause).toEqual(new Error('the check failed'))
  })

  test('a pre-launch check that failed stops the fixture with what it said', async () => {
    const failed = { state: 'failed', verdict: { said: 'The base of api could not be read: held' } }
    const exit = await Effect.runPromiseExit(checkLaunchable(failed))
    expect(String(exit)).toContain(
      'the pre-launch check failed: The base of api could not be read: held',
    )
    const done = { state: 'done', verdict: { said: 'Nothing moved since the Freeze: launch.' } }
    expect(Exit.isSuccess(await Effect.runPromiseExit(checkLaunchable(done)))).toBe(true)
  })

  test('a build that wrote no line says so', () => {
    const log = join(temporaryFolder('fixtures-log'), 'build.log')
    expect(notBuilt('empty', log, new Error('stopped')).message).toContain('no line')
  })
})

describe('A fixture is built and read against the home the suite hands it (#483)', () => {
  test('the Git guard of a build keeps the suite’s home, never the machine’s', async () => {
    const { root } = places()
    const home = temporaryFolder('fixtures-own-home')
    writeFileSync(join(home, '.gitconfig'), '[user]\n\tname = t\n')
    const fixture = await buildFixture({
      root,
      group: 'planning',
      rebuild: false,
      log: () => undefined,
      normalProfiles: NORMAL,
      home,
    })
    const database = new DatabaseSync(join(fixture.profile, DATABASE_FILE))
    const row = database.prepare("SELECT shapes FROM git_baselines WHERE id = '~'").get()
    database.close()
    expect(String(row?.['shapes'])).toContain(JSON.stringify(join(home, '.gitconfig')).slice(1, -1))
    expect(String(row?.['shapes'])).not.toContain(
      JSON.stringify(join(homedir(), '.gitconfig')).slice(1, -1),
    )
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
  commandsEngine(profile, SUITE_PARTS)(({ profile: started }) => started.use(program))

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

/** What a fixture's missions hold, as the services answer it, without the ids they draw. */
const missionsOf = (profile: string) =>
  readIn(
    profile,
    Effect.gen(function* () {
      const projects = yield* listProjects
      const missions = yield* Effect.forEach(projects, (project) =>
        Effect.flatMap(listMissions(project.id), (found) =>
          Effect.forEach(found, (mission) =>
            Effect.gen(function* () {
              const building = yield* buildingOf(mission.id)
              const proofs = yield* proofsRead(mission.id)
              return {
                title: mission.title,
                stage: mission.stage,
                tasks: (building?.tasks ?? []).map((task) => [task.id, task.state]),
                proofs: (proofs?.scenarios ?? []).map((one) => [one.scenario, one.state]),
              }
            }),
          ),
        ),
      )
      const needs = (yield* listNeeds).flatMap((group) =>
        group.needs.map(
          (need) => `${need.requestedBy ?? 'Hemera'} ${need.state} ${String(need.choices.length)}`,
        ),
      )
      return { missions: missions.flat(), needs: needs.toSorted() }
    }),
  )

const BUILDABLE = FIXTURE_GROUPS.filter((group) => group.notYet === undefined).map(
  (group) => group.name,
)

describe('--rebuild', () => {
  test.each(BUILDABLE)(
    '--rebuild gives the same state twice: %s',
    async (group) => {
      const { root } = places()
      const first = await built(group, root)
      const refs = refsOf(first.work)
      const state = { projects: await stateOf(first.profile), ...(await missionsOf(first.profile)) }
      const again = await built(group, root, true)
      expect(again.folder).toBe(first.folder)
      // The same commits, to the hash: fixed authors, fixed dates, no randomness.
      expect(refsOf(again.work)).toEqual(refs)
      expect({
        projects: await stateOf(again.profile),
        ...(await missionsOf(again.profile)),
      }).toEqual(state)
    },
    360_000,
  )

  test('without --rebuild, a fixture already built is opened as it is', async () => {
    const { root } = places()
    const first = await built('project-ready', root)
    writeFileSync(join(first.work, 'left-by-hand.txt'), 'kept\n')
    await built('project-ready', root)
    expect(existsSync(join(first.work, 'left-by-hand.txt'))).toBe(true)
  })
})
