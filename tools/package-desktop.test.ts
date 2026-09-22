import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, test } from 'vite-plus/test'

import {
  BUNDLED_ADAPTERS,
  DESCRIBE_ARGUMENTS,
  adaptersProblems,
  closureOf,
  channelAsked,
  channelProblems,
  identityOf,
  inspectPackage,
  localesProblems,
  migrationsProblems,
  packagingOptions,
  refusalFor,
  refusedEntries,
  refusedInClosure,
  unpackedFolderOf,
  versionFrom,
} from './package-desktop.ts'

const repository = resolve(import.meta.dirname, '..')
const unpacked = join(repository, 'dist', 'package', unpackedFolderOf())

describe('Locales réduites', () => {
  test('one locale is what a package speaking one language carries', () => {
    expect(localesProblems(['en-US.pak'])).toEqual([])
  })

  test('a locale of a language the application does not speak is reported', () => {
    const problems = localesProblems(['en-US.pak', 'fr.pak', 'de.pak'])
    expect(problems.map((problem) => problem.entry).toSorted()).toEqual(['de.pak', 'fr.pak'])
  })

  test('an empty locales folder is reported rather than taken for a small package', () => {
    // Electron refuses to start on one, so emptying it by hand trades 47 MB for a crash.
    expect(localesProblems([])[0]?.problem).toContain('will not start')
  })
})

describe('Paquet sans les sources', () => {
  test.each(['spikes/proto-motion/index.html', 'packages/core/src/index.ts'])(
    '%p in a package is reported as belonging to the sources',
    (entry) => {
      expect(refusedEntries([entry])).toHaveLength(1)
    },
  )

  test('a development node_modules is reported wherever it sits', () => {
    expect(refusedEntries(['resources/app/node_modules/vite-plus/index.js'])).toHaveLength(1)
  })

  test('what a package is made of is not mistaken for a source', () => {
    expect(
      refusedEntries([
        'Hemera.exe',
        'locales/en-US.pak',
        'resources/app.asar',
        'chrome_100_percent.pak',
      ]),
    ).toEqual([])
  })

  test.runIf(existsSync(unpacked))(
    'the package built on this machine carries what it should and nothing else',
    () => {
      expect(inspectPackage(unpacked)).toEqual([])
      expect(readdirSync(join(unpacked, 'locales'))).toEqual(['en-US.pak'])
    },
  )

  test('each target names the folder its unpacked application lands in', () => {
    expect(unpackedFolderOf('win32')).toBe('win-unpacked')
    expect(unpackedFolderOf('linux')).toBe('linux-unpacked')
  })
})

describe('Le défaut est dev', () => {
  test('packaging asked for nothing in particular produces a dev package', () => {
    expect(channelAsked([])).toBe('dev')
    expect(refusalFor(channelAsked([]), {})).toBeNull()
  })

  test('a dev package says so in its own manifest, and calls itself apart from prod', () => {
    expect(packagingOptions('dev', '0.3.0-12-gabc1')).toContain(
      '--config.extraMetadata.hemera.channel=dev',
    )
    expect(identityOf('dev').appId).not.toBe(identityOf('prod').appId)
    expect(identityOf('dev').productName).not.toBe(identityOf('prod').productName)
  })
})

describe('prod et beta sont réservés à la CI', () => {
  test.each(['prod', 'beta'] as const)(
    'asking for a %s package outside the pipeline is refused, and explains why',
    (channel) => {
      const refusal = refusalFor(channel, {})
      expect(refusal).not.toBeNull()
      expect(refusal).toContain(channel)
      expect(refusal).toContain('continuous integration')
    },
  )

  test.each(['prod', 'beta'] as const)('the pipeline itself may build %s', (channel) => {
    expect(refusalFor(channel, { CI: 'true' })).toBeNull()
  })

  test('a channel that does not exist is refused before anything is built', () => {
    expect(refusalFor('staging', { CI: 'true' })).toContain('no such channel')
  })

  test('the flag is read written either way round', () => {
    expect(channelAsked(['--channel', 'beta'])).toBe('beta')
    expect(channelAsked(['--channel=beta'])).toBe('beta')
  })
})

describe('Un paquet lit son canal dans son manifeste', () => {
  test('a package built as beta installs beside prod rather than over it', () => {
    expect(identityOf('beta')).toEqual({
      appId: 'dev.hemera.app.beta',
      productName: 'Hemera Beta',
      executableName: 'hemera-beta',
    })
    expect(identityOf('prod')).toEqual({
      appId: 'dev.hemera.app',
      productName: 'Hemera',
      executableName: 'hemera',
    })
  })

  test.each(['prod', 'beta', 'dev'] as const)(
    'the %s executable is named something every target accepts in a path',
    (channel) => {
      expect(identityOf(channel).executableName).toMatch(/^[a-z][a-z0-9-]*$/)
    },
  )

  test('a package whose manifest says another channel is reported rather than shipped', () => {
    expect(channelProblems('dev', 'beta')).toHaveLength(1)
    expect(channelProblems('dev', 'beta')[0]?.problem).toContain('built as beta')
    expect(channelProblems('beta', 'beta')).toEqual([])
    expect(channelProblems(null, 'dev')[0]?.problem).toContain('nothing at all')
  })

  test('the version a package carries is the label the repository answered, without its v', () => {
    expect(versionFrom('v0.3.0-12-gabc1\n')).toBe('0.3.0-12-gabc1')
    expect(versionFrom('0.3.0\n')).toBe('0.3.0')
  })

  test('a repository with no tag answers a hash, carried behind a version that starts with a digit', () => {
    expect(versionFrom('abc1234\n')).toBe('0.0.0-abc1234')
    expect(versionFrom('3dcdb99\n')).toBe('3dcdb99')
  })

  test('a beta tag closer than the version tag is not what a package is named after, on this OS', () => {
    const folder = mkdtempSync(join(tmpdir(), 'hemera-describe-'))
    const git = (...args: string[]) => {
      const run = spawnSync('git', args, { cwd: folder, encoding: 'utf8' })
      expect(run.status, run.stderr).toBe(0)
      return run.stdout.trim()
    }
    const commit = (message: string) =>
      git(
        '-c',
        'user.name=t',
        '-c',
        'user.email=t@t',
        'commit',
        '-q',
        '--allow-empty',
        '-m',
        message,
      )
    try {
      git('init', '-q')
      commit('one')
      git('tag', 'v0.0.0')
      commit('two')
      git('tag', 'beta-0.0.0-1-gabc')
      commit('three')
      // The exclusion holds only when the pattern reaches git without a shell in between.
      expect(git(...DESCRIBE_ARGUMENTS)).toMatch(/^v0\.0\.0-2-g[0-9a-f]+$/)
      expect(DESCRIBE_ARGUMENTS.join(' ')).not.toContain("'")
    } finally {
      rmSync(folder, { recursive: true, force: true })
    }
  })
})

describe('Migrations embarquées', () => {
  test('a package with no migrations in it is refused: the profile could not be migrated', () => {
    expect(migrationsProblems(['dist/main/index.js'])).toHaveLength(1)
  })

  test('a package carrying the generated migration is accepted', () => {
    expect(
      migrationsProblems(['drizzle/20260916123330_profile_and_preferences/migration.sql']),
    ).toEqual([])
  })
})

describe('Adaptateurs embarqués', () => {
  const carried = BUNDLED_ADAPTERS.map(
    (name) => `resources/adapters/node_modules/${name}/package.json`,
  )
  const forked = ['dist/adapter/index.js']

  test('the adapters travel in the one node_modules a package is allowed', () => {
    // Everything under the adapters' own folder is a package this application declares, laid out
    // where Node resolves one: it is the exception, and it is an exception to that folder alone.
    expect(refusedEntries(carried)).toEqual([])
  })

  test('a development node_modules anywhere else is refused as it always was', () => {
    expect(refusedEntries(['resources/app/node_modules/vite-plus/index.js'])).toHaveLength(1)
  })

  test('a package without its adapters is refused: no agent of the two could be started', () => {
    const problems = adaptersProblems([], forked)
    expect(problems.map((problem) => problem.entry)).toEqual(carried)
  })

  test('a package without the program that forks them is refused too', () => {
    expect(adaptersProblems(carried, ['dist/main/index.js'])[0]?.entry).toBe('dist/adapter')
  })

  test('a package carrying both is accepted', () => {
    expect(adaptersProblems(carried, forked)).toEqual([])
  })

  test('an agent carried as a platform binary is refused wherever it came from', () => {
    // Each adapter declares the agent itself as a dependency of its own, hundreds of megabytes
    // per platform, and Hemera runs the one the reader installed instead (D5-21).
    expect(
      refusedInClosure(['@anthropic-ai/claude-agent-sdk-win32-x64', '@openai/codex']),
    ).toHaveLength(2)
    expect(refusedInClosure(['@anthropic-ai/claude-agent-sdk', 'zod'])).toEqual([])
  })

  test('the closure is what the packages declare, each walked once', () => {
    const declared = {
      adapter: ['sdk', 'zod'],
      sdk: ['zod'],
      zod: [],
    } satisfies Record<string, readonly string[]>
    // SAFETY: the walk only ever asks about a name this very table put in front of it.
    const closure = closureOf([{ name: 'adapter', folder: '/a' }], (found) =>
      (declared[found.name as keyof typeof declared] ?? []).map((name) => ({
        name,
        folder: `/${name}`,
      })),
    )
    expect(closure.map((found) => found.name)).toEqual(['adapter', 'sdk', 'zod'])
  })
})
