/**
 * Builds a fixture group (#420) in its folder under the fixtures root, from nothing: the marker
 * first, then the fake forge, then the group's state through the engine, opened on the fixture's
 * own profile with every agent the scripted fake and every forge CLI the tests' fake.
 *
 * A folder already there is checked as the application checks it before anything is done to it:
 * one without the marker, outside the root or holding a real profile is refused and left as it
 * was. Without `rebuild`, a fixture already built is kept as it is; with it, it is thrown away and
 * built again, to the same state.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { DatabaseRefused } from '@hemera/ipc'
import { Effect, Match, Result, Schema, SubscriptionRef } from 'effect'

import { suiteAgent } from '../src/engine/agents/suite-agent.ts'
import { startProfile } from '../src/engine/profile.ts'
import { BACKUP_FOLDERS, RECONCILIATION_STEPS } from '../src/engine/registries.ts'
import { FIXTURE_MARKER, checkFixtureFolder } from '../src/main/fixture-profile.ts'
import { fakeForge, ghSignedOut } from '../tests/fake-forge.ts'
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
 * named after the package, and an installed one's, named after the product. No fixture is ever
 * built in one of them, nor around one.
 */
export function machineProfiles(): ReadonlyArray<string> {
  const appData = Match.value(process.platform).pipe(
    Match.when('win32', () => process.env['APPDATA'] ?? join(homedir(), 'AppData', 'Roaming')),
    Match.when('darwin', () => join(homedir(), 'Library', 'Application Support')),
    Match.orElse(() => process.env['XDG_CONFIG_HOME'] ?? join(homedir(), '.config')),
  )
  return [join(appData, '@hemera', 'desktop'), join(appData, 'Hemera')]
}

/** The list `pnpm fixtures --list` prints: each group, and what to test once it is open. */
export const fixtureList = (): string =>
  FIXTURE_GROUPS.map((group) => `${group.name}\n  ${group.look}\n`).join('\n')

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

/** Refuses, with the sentence, a folder the application would refuse to open. */
const checked = (folder: string, root: string, normalProfiles: ReadonlyArray<string>): void => {
  for (const normalProfile of normalProfiles) {
    const result = checkFixtureFolder(folder, { root, normalProfile })
    if (Result.isFailure(result)) throw new Error(result.failure)
  }
}

/**
 * The fake forge's environment, in the fixture: `gh` signed out, `bkt` without an account. It
 * holds no state of the fixture's, so it is written again at each opening.
 */
const forgeIn = (folder: string) => {
  const place = join(folder, 'forge')
  rmSync(place, { recursive: true, force: true })
  const forge = fakeForge([...ghSignedOut()], ['gh', 'bkt'], place)
  // The fake's own configuration folder stays the fake's: the application keeps the user's
  // XDG_CONFIG_HOME, which is where Electron finds the profile it must not open.
  const { XDG_CONFIG_HOME: _config, ...env } = forge.env
  return env
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
      const started = yield* startProfile(
        { dataFolder: profile, version: VERSION, migrations: MIGRATIONS },
        {
          backupFolders: BACKUP_FOLDERS,
          reconciliationSteps: RECONCILIATION_STEPS,
          gh: { path: env['PATH'] ?? '', env },
          forge: { env },
          sessions: fakes.sessions,
          ticketSync: { schedules: false },
        },
        log,
      )
      const database = yield* SubscriptionRef.get(started.database)
      if (Schema.is(DatabaseRefused)(database)) {
        return yield* Effect.die(
          new Error(`the fixture's profile was refused: ${database.sentence}`),
        )
      }
      yield* started.use(group.build({ work, git: fixtureGit() }))
    }),
  )

export async function buildFixture(asked: FixtureAsk): Promise<BuiltFixture> {
  const group = FIXTURE_GROUPS.find((one) => one.name === asked.group)
  if (group === undefined) {
    throw new Error(
      `There is no fixture group named ${asked.group}: pnpm fixtures --list names them.`,
    )
  }
  const normalProfiles = asked.normalProfiles ?? machineProfiles()
  const folder = join(asked.root, group.name)
  const profile = join(folder, 'profile')
  const work = join(folder, 'work')
  const fixture = (env: BuiltFixture['env']): BuiltFixture => ({ folder, profile, work, env })

  if (existsSync(folder)) {
    checked(folder, asked.root, normalProfiles)
    if (!asked.rebuild) {
      asked.log(`${group.name} is already built in ${folder}; --rebuild builds it again`)
      return fixture(forgeIn(folder))
    }
    rmSync(folder, { recursive: true, force: true })
  }

  const marker = `${JSON.stringify({ group: group.name, builtBy: 'pnpm fixtures' })}\n`
  mkdirSync(profile, { recursive: true })
  writeFileSync(join(folder, FIXTURE_MARKER), marker)
  writeFileSync(join(profile, FIXTURE_MARKER), marker)
  checked(profile, asked.root, normalProfiles)
  mkdirSync(work)
  const env = forgeIn(folder)
  asked.log(`building ${group.name} in ${folder}`)
  await Effect.runPromise(buildState(group, profile, work, env, asked.log))
  return fixture(env)
}
