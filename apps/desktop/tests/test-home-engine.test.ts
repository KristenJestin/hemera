/**
 * The home an engine of a suite reads (#488): the engine's Git guard keeps a baseline of the home's
 * Git configuration, and the Windows runner creates `~/.gitconfig` while a job runs. An engine a
 * test opens, however it is opened, reads the test file's own home unless the test hands another.
 */

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { Effect } from 'effect'
import { afterEach, describe, expect, test } from 'vite-plus/test'

import { testHome } from '../../../tools/test-home.ts'
import { DATABASE_FILE } from '../src/engine/migrate.ts'
import { createProject } from '../src/engine/projects.ts'
import { commandsEngine, until } from './commands-engine.ts'
import { git } from './repositories.ts'
import { removeFolders, temporaryFolder } from './storage.ts'

afterEach(removeFolders)

/** The paths the guard keeps its home baseline over, as the engine's database holds them. */
const baselineOf = (data: string): string | undefined => {
  const database = new DatabaseSync(join(data, DATABASE_FILE))
  const row = database.prepare("SELECT shapes FROM git_baselines WHERE id = '~'").get()
  database.close()
  return row === undefined ? undefined : String(row['shapes'])
}

/**
 * The engine over `data`, a Project added over a repository: the guard sees the home then, off the
 * start, and the baseline it keeps is answered once it is there.
 */
const opened = (data: string, parts: Parameters<typeof commandsEngine>[1] = {}) => {
  const checkout = temporaryFolder('test-home-checkout')
  git(checkout, 'init', '-q', '-b', 'main')
  return commandsEngine(
    data,
    parts,
  )(({ profile }) =>
    Effect.gen(function* () {
      yield* profile.use(createProject({ name: 'Acme', mainCheckout: checkout, repositories: [] }))
      return yield* until(
        Effect.sync(() => baselineOf(data)),
        (seen) => seen !== undefined,
      )
    }),
  )
}

const escaped = (path: string) => JSON.stringify(path).slice(1, -1)

describe('An engine a test opens reads a home of the test’s own (#488)', () => {
  test('with no home handed, the Git guard keeps the test file’s home, never the machine’s', async () => {
    const data = temporaryFolder('test-home-data')
    writeFileSync(join(testHome().home, '.gitconfig'), '[user]\n\tname = t\n')
    const baseline = await opened(data)
    expect(baseline).toContain(escaped(join(testHome().home, '.gitconfig')))
    expect(baseline).not.toContain(escaped(join(testHome().machine, '.gitconfig')))
  })

  test('a test that hands a home of its own gets that one', async () => {
    const data = temporaryFolder('test-home-data')
    const own = temporaryFolder('test-home-own')
    writeFileSync(join(own, '.gitconfig'), '[user]\n\tname = t\n')
    const baseline = await opened(data, { tools: { home: own } })
    expect(baseline).toContain(escaped(join(own, '.gitconfig')))
    expect(baseline).not.toContain(escaped(join(testHome().home, '.gitconfig')))
  })
})
