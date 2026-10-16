/**
 * `pnpm fixtures`, development only (#420): the application opened in a named state built from
 * fixtures, never on a real profile.
 *
 *   pnpm fixtures --list               the groups, and what to test once each is open
 *   pnpm fixtures <group>              builds the group if it is not built, then opens Hemera on it
 *   pnpm fixtures <group> --rebuild    throws the group's folder away and builds it again first
 *
 * Every group lives in a folder of its own under the fixtures root, a folder of the user's own.
 * The application is the development run (`dev.ts`), pointed at the fixture's profile with
 * `--fixture-profile`, the fake `gh` and `bkt` first on its `PATH`.
 */

import { spawn } from 'node:child_process'
import { join } from 'node:path'

import { Result } from 'effect'

import { FIXTURE_FLAG, fixtureEnvironment, fixturesRoot } from '../src/main/fixture-profile.ts'
import { buildFixture, fixtureList } from './build.ts'

const application = join(import.meta.dirname, '..')
const USAGE = 'pnpm fixtures --list | pnpm fixtures <group> [--rebuild]'

const args = process.argv.slice(2)
const flags = args.filter((word) => word.startsWith('--'))
const words = args.filter((word) => !word.startsWith('--'))
const unknown = flags.filter((flag) => flag !== '--list' && flag !== '--rebuild')

if (unknown.length > 0 || words.length > 1) {
  process.stderr.write(`${USAGE}\n`)
  process.exit(2)
}

const [group] = words
if (flags.includes('--list') || group === undefined) {
  process.stdout.write(`${fixtureList()}\nThe fixtures root: ${fixturesRoot()}\n${USAGE}\n`)
  process.exit(0)
}

const built = await buildFixture({
  root: fixturesRoot(),
  group,
  rebuild: flags.includes('--rebuild'),
  log: (line) => process.stdout.write(`${line}\n`),
}).catch((failure: Error) => {
  const cause = failure.cause instanceof Error ? `\n${failure.cause.message}` : ''
  process.stderr.write(`${failure.message}${cause}\n`)
  process.exit(1)
})

// The fakes' folder first on the PATH, as main puts it on a fixture whoever opens it.
const forge = fixtureEnvironment(built.profile, process.env)
if (Result.isFailure(forge)) {
  process.stderr.write(`${forge.failure}\n`)
  process.exit(1)
}
const env = { ...process.env, ...forge.success }

process.stdout.write(`opening Hemera on ${built.profile}\n`)
const opened = spawn(
  process.execPath,
  [join(application, 'dev.ts'), `${FIXTURE_FLAG}=${built.profile}`],
  {
    cwd: application,
    stdio: 'inherit',
    env,
  },
)
opened.on('close', (code) => process.exit(code ?? 0))
