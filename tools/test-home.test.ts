import { spawnSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, parse, relative } from 'node:path'
import { describe, expect, test } from 'vite-plus/test'

import { SYSTEM_PROGRAMS, type SpawnRule, homeRefusedBy, takeRefused } from './spawn-guard.ts'
import { testHome } from './test-home.ts'

const within = (path: string, folder: string) => {
  const between = relative(folder, path)
  return between !== '' && !between.startsWith('..') && !between.startsWith('/')
}

describe('A suite runs on a home of its own', () => {
  test('the home, the configuration home and the global Git configuration are in the temporary folder', () => {
    for (const name of ['HOME', 'USERPROFILE', 'XDG_CONFIG_HOME', 'GIT_CONFIG_GLOBAL']) {
      expect(within(process.env[name] ?? '', tmpdir()), name).toBe(true)
    }
    expect(homedir()).toBe(testHome().home)
  })

  test('it is not the home the process started with', () => {
    expect(testHome().home).not.toBe(testHome().machine)
    expect(homedir()).not.toBe(testHome().machine)
  })

  test('a Git a test spawns reads the global configuration of that home, and no other', () => {
    writeFileSync(join(testHome().home, '.gitconfig'), '[user]\n\tname = Test Home\n')
    const read = spawnSync('git', ['config', '--show-origin', 'user.name'], {
      cwd: tmpdir(),
      encoding: 'utf8',
    })
    expect(read.stdout).toContain(join(testHome().home, '.gitconfig'))
    expect(read.stdout).toContain('Test Home')
  })
})

describe('A Git a test spawns runs on a home in the temporary folder', () => {
  const rule: SpawnRule = {
    folders: [tmpdir()],
    homes: [tmpdir()],
    names: SYSTEM_PROGRAMS,
    platform: 'linux',
  }
  const asked = (env: Record<string, string>) => ({
    file: 'git',
    args: ['status'],
    env,
    cwd: tmpdir(),
  })
  const own = join(tmpdir(), 'hemera-own-home')

  test.each(['HOME', 'USERPROFILE', 'XDG_CONFIG_HOME', 'GIT_CONFIG_GLOBAL'])(
    'a Git whose %s names the machine’s home is refused, naming it',
    (name) => {
      expect(homeRefusedBy(rule, asked({ [name]: '/home/someone' }))).toContain(name)
    },
  )

  test('a Git whose home variables are all in the temporary folder may run', () => {
    expect(
      homeRefusedBy(
        rule,
        asked({
          HOME: own,
          USERPROFILE: own,
          XDG_CONFIG_HOME: join(own, '.config'),
          GIT_CONFIG_GLOBAL: join(own, '.gitconfig'),
        }),
      ),
    ).toBeNull()
  })

  test('a Git told to read no global configuration, or handed no home, may run', () => {
    expect(homeRefusedBy(rule, asked({ GIT_CONFIG_GLOBAL: '/dev/null' }))).toBeNull()
    expect(homeRefusedBy(rule, asked({ PATH: '' }))).toBeNull()
  })

  test('a program that is not Git is none of this guard’s business', () => {
    expect(homeRefusedBy(rule, { ...asked({ HOME: '/home/someone' }), file: 'node' })).toBeNull()
  })

  test.skipIf(process.platform === 'win32')(
    'the suites’ guard refuses a Git on the machine’s home before it runs',
    () => {
      // A place outside the temporary folder, as the machine's home is.
      const machine = join(parse(tmpdir()).root, 'machine-home', '.config')
      expect(() =>
        spawnSync('git', ['--version'], { env: { ...process.env, XDG_CONFIG_HOME: machine } }),
      ).toThrow(/a test may not start git on the machine's home, XDG_CONFIG_HOME=/)
      // Kept for the setup, which fails the test that asked: taken here, as expected.
      expect(takeRefused()).toEqual([`git on XDG_CONFIG_HOME=${machine}`])
    },
  )

  test('a rule with no homes names none', () => {
    expect(
      homeRefusedBy({ ...rule, homes: undefined }, asked({ HOME: '/home/someone' })),
    ).toBeNull()
  })
})

/** The test sources the machine's Git configuration could be written from. */
const SOURCES = [
  'apps/desktop/tests',
  'apps/desktop/e2e',
  'apps/desktop/fixtures',
  'packages/core/tests',
  'packages/ipc/tests',
  'tools',
]

/**
 * Where `--global` stands in the sources today, each with the count and why it is not a write: a
 * command line handed to a judge or compared with a text, never run, or `pnpm`'s own option.
 */
const GLOBAL_NOT_RUN = {
  'apps/desktop/tests/agent-states.test.ts': 5,
  'apps/desktop/tests/delivery-pushes.test.ts': 1,
  'apps/desktop/tests/permissions.test.ts': 1,
  'packages/core/tests/permissions.test.ts': 3,
}

const FLAG = `--${'global'}`

function sourcesUnder(folder: string): string[] {
  return readdirSync(join(import.meta.dirname, '..', folder)).flatMap((entry) => {
    const path = join(folder, entry)
    if (entry === 'node_modules') return []
    if (statSync(join(import.meta.dirname, '..', path)).isDirectory()) return sourcesUnder(path)
    return /\.tsx?$/.test(entry) ? [path.replaceAll('\\', '/')] : []
  })
}

describe('No test writes the machine’s Git configuration', () => {
  test('`--global` stands only where it is handed to a judge or compared with a text', () => {
    const found: Record<string, number> = {}
    for (const file of SOURCES.flatMap(sourcesUnder)) {
      if (file === 'tools/test-home.test.ts') continue
      const count =
        readFileSync(join(import.meta.dirname, '..', file), 'utf8').split(FLAG).length - 1
      if (count > 0) found[file] = count
    }
    expect(found).toEqual(GLOBAL_NOT_RUN)
  })
})
