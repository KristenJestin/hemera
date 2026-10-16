/**
 * Builds a fixture group (#420) in its folder under the fixtures root, from nothing: where it
 * would be is checked first, before anything is written, then the root is made the user's alone,
 * then the marker, the fake forge, and the group's state through the engine, opened on the
 * fixture's own profile with every agent the scripted fake and every forge CLI the tests' fake.
 *
 * A folder already there is checked as the application checks it before anything is done to it:
 * one without the marker, outside the root, under a root that is a link or not the user's alone,
 * or holding a real profile is refused and left as it was. Without `rebuild`, a fixture already built is kept as it is; with it, it is thrown away and
 * built again, to the same state.
 */

import {
  appendFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import { DatabaseRefused } from '@hemera/ipc'
import { Effect, Match, Result, Schema, SubscriptionRef } from 'effect'

import { suiteAgent } from '../src/engine/agents/suite-agent.ts'
import { startProfile } from '../src/engine/profile.ts'
import { BACKUP_FOLDERS, RECONCILIATION_STEPS } from '../src/engine/registries.ts'
import { getSession } from '../src/engine/sessions/store.ts'
import {
  FIXTURE_FORGE,
  FIXTURE_MARKER,
  FORGE_KEYS,
  checkFixtureFolder,
  checkFixturePlace,
  checkFixturesRoot,
  profilesIn,
} from '../src/main/fixture-profile.ts'
import { fakeForge, ghSignedOut } from '../tests/fake-forge.ts'
import { scriptedAgents } from './agents.ts'
import { fixtureGit } from './git.ts'
import { FIXTURE_GROUPS, type FixtureGroup } from './groups.ts'

export { FIXTURE_GROUPS }

const application = join(import.meta.dirname, '..')

/** The migrations this application ships, which is what the application applies at start. */
const MIGRATIONS = join(application, 'drizzle')

/** The version a development run of the application says it is, so it opens what was built. */
const VERSION = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Struct({ version: Schema.String })),
)(readFileSync(join(application, 'package.json'), 'utf8')).version

/**
 * The profiles Hemera opens on this machine when no flag says otherwise: a development run's,
 * named after the package, and each channel's, named after its product. No fixture is ever built
 * in one of them, nor around one.
 */
export function machineProfiles(): ReadonlyArray<string> {
  const appData = Match.value(process.platform).pipe(
    Match.when('win32', () => process.env['APPDATA'] ?? join(homedir(), 'AppData', 'Roaming')),
    Match.when('darwin', () => join(homedir(), 'Library', 'Application Support')),
    Match.orElse(() => process.env['XDG_CONFIG_HOME'] ?? join(homedir(), '.config')),
  )
  return profilesIn(appData)
}

/** The list `pnpm fixtures --list` prints: each group, and what to test once it is open. */
export const fixtureList = (): string =>
  FIXTURE_GROUPS.map(
    (group) =>
      `${group.name}\n  ${group.look}\n${group.notYet === undefined ? '' : `  (not built yet: ${group.notYet})\n`}`,
  ).join('\n')

/** The file, in a fixture's folder, the engine's lines go to while it builds the group. */
export const BUILD_LOG = 'build.log'

export interface BuiltFixture {
  /** The fixture's folder, which carries the marker. */
  readonly folder: string
  /** The profile the application is opened on: `--fixture-profile=<profile>`. */
  readonly profile: string
  /** Where its repositories and their remotes are. */
  readonly work: string
  /** What the application runs with beside its own environment: the fake forge first on the `PATH`. */
  readonly env: Readonly<Record<string, string>>
}

export interface FixtureAsk {
  readonly root: string
  readonly group: string
  readonly rebuild: boolean
  readonly log: (line: string) => void
  /** The profiles no fixture may be or hold; this machine's otherwise. */
  readonly normalProfiles?: ReadonlyArray<string>
}

/** Refuses, with the sentence, what a check refuses. */
const sure = <A>(checked: Result.Result<A, string>): A => {
  if (Result.isFailure(checked)) throw new Error(checked.failure)
  return checked.success
}

/**
 * The fake forge's environment, in the fixture: `gh` signed out, `bkt` without an account. It
 * holds no state of the fixture's, so it is written again at each opening, and its environment
 * in the profile, where the application finds it whoever opens it.
 */
const forgeIn = (folder: string, profile: string) => {
  const place = join(folder, 'forge')
  rmSync(place, { recursive: true, force: true })
  const forge = fakeForge([...ghSignedOut()], ['gh', 'bkt'], place)
  // The fake's own configuration folder stays the fake's: the application keeps the user's
  // XDG_CONFIG_HOME, which is where Electron finds the profile it must not open.
  const { XDG_CONFIG_HOME: _config, ...env } = forge.env
  // Only its own places go in the profile: what Windows needs to run a shim is the user's own.
  const opened = Object.fromEntries(FORGE_KEYS.map((key) => [key, forge.env[key] ?? '']))
  writeFileSync(join(profile, FIXTURE_FORGE), `${JSON.stringify(opened)}\n`)
  return env
}

/**
 * The fixtures root, made for the user alone when it is not there yet, then checked as main checks
 * it: a folder of the user's own that no other account can write to, and no link.
 */
const rootReady = (root: string): void => {
  if (lstatSync(root, { throwIfNoEntry: false }) === undefined) {
    mkdirSync(dirname(root), { recursive: true })
    mkdirSync(root, { mode: 0o700 })
  }
  sure(checkFixturesRoot(root))
}

/** The group's state, on the fixture's profile, through the engine's services. */
const buildState = (
  group: FixtureGroup,
  profile: string,
  work: string,
  env: BuiltFixture['env'],
  log: FixtureAsk['log'],
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const fakes = yield* suiteAgent
      // The role of the session an agent is started for, read once the Profile is open.
      let roleOf = (_sessionId: string): Effect.Effect<string | null> => Effect.succeed(null)
      const started = yield* startProfile(
        { dataFolder: profile, version: VERSION, migrations: MIGRATIONS },
        {
          backupFolders: BACKUP_FOLDERS,
          reconciliationSteps: RECONCILIATION_STEPS,
          gh: { path: env['PATH'] ?? '', env },
          forge: { env },
          sessions: {
            ...scriptedAgents(fakes, group.scripts ?? {}, (sessionId) => roleOf(sessionId)),
            // A new mission starts its Planner on its own, as in the application.
            plannerStarts: true,
          },
          ticketSync: { schedules: false },
        },
        log,
      )
      roleOf = (sessionId) =>
        started.use(getSession(sessionId)).pipe(
          Effect.map((session) => session.role),
          Effect.orElseSucceed(() => null),
        )
      const database = yield* SubscriptionRef.get(started.database)
      if (Schema.is(DatabaseRefused)(database)) {
        return yield* Effect.die(
          new Error(`the fixture's profile was refused: ${database.sentence}`),
        )
      }
      yield* started.use(group.build({ work, git: fixtureGit(dirname(work)) }))
    }),
  )

export async function buildFixture(asked: FixtureAsk): Promise<BuiltFixture> {
  const group = FIXTURE_GROUPS.find((one) => one.name === asked.group)
  if (group === undefined) {
    throw new Error(
      `There is no fixture group named ${asked.group}: pnpm fixtures --list names them.`,
    )
  }
  if (group.notYet !== undefined) {
    throw new Error(`${group.name} cannot be built yet: ${group.notYet}`)
  }
  const normalProfiles = asked.normalProfiles ?? machineProfiles()
  const folder = join(asked.root, group.name)
  const profile = join(folder, 'profile')
  const work = join(folder, 'work')
  const fixture = (env: BuiltFixture['env']): BuiltFixture => ({ folder, profile, work, env })

  const places = { root: asked.root, normalProfiles }
  // Where the fixture would be is checked before anything is written, the root included.
  sure(checkFixturePlace(profile, places))
  rootReady(asked.root)

  if (existsSync(folder)) {
    sure(checkFixtureFolder(folder, places))
    if (!asked.rebuild) {
      sure(checkFixtureFolder(profile, places))
      asked.log(`${group.name} is already built in ${folder}; --rebuild builds it again`)
      return fixture(forgeIn(folder, profile))
    }
    rmSync(folder, { recursive: true, force: true })
  }

  const marker = `${JSON.stringify({ group: group.name, builtBy: 'pnpm fixtures' })}\n`
  mkdirSync(profile, { recursive: true })
  writeFileSync(join(folder, FIXTURE_MARKER), marker)
  writeFileSync(join(profile, FIXTURE_MARKER), marker)
  mkdirSync(work)
  const env = forgeIn(folder, profile)
  asked.log(`building ${group.name} in ${folder}`)
  // What the engine says while it builds goes to the fixture's own log, not to the terminal.
  const engineLog = join(folder, BUILD_LOG)
  const started = Date.now()
  await Effect.runPromise(
    buildState(group, profile, work, env, (line) => appendFileSync(engineLog, `${line}\n`)),
  ).catch((failure: Error) => {
    throw new Error(`${group.name} could not be built (the engine's lines: ${engineLog})`, {
      cause: failure,
    })
  })
  asked.log(`built ${group.name} in ${String(Math.round((Date.now() - started) / 1000))} s`)
  return fixture(env)
}
