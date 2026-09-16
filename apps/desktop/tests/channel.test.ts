/**
 * Which build opens which profile, and what no build can be talked into (design D3-06).
 *
 * Each suite is named after the scenario of `specs/application-foundation/spec.md` it covers.
 * Nothing here touches a real profile: the paths are computed from an environment handed in,
 * and the one folder that exists is a temporary one holding a manifest.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, posix, resolve } from 'node:path'
import { describe, expect, test } from 'vite-plus/test'

import type { Channel } from '@hemera/ipc'

import {
  PROFILE_DIRECTORY_FLAG,
  VERSION_VARIABLE,
  applicationVersion,
  channel,
  chooseProfile,
  profileDirectory,
} from '#main/channel.ts'

const WINDOWS = { LOCALAPPDATA: 'C:\\Users\\kris\\AppData\\Local' }
const LINUX = { XDG_DATA_HOME: '/home/someone/.local/share' }

/** A package on disk, as Electron would have loaded it: a folder and the manifest it carries. */
function packaged(hemera: Record<string, string> | null): string {
  const root = mkdtempSync(join(tmpdir(), 'hemera-channel-'))
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify(hemera === null ? { name: 'hemera' } : { name: 'hemera', hemera }),
  )
  return root
}

describe('Un paquet prod et un paquet beta ouvrent le même profil', () => {
  test.each([
    ['windows', 'win32', WINDOWS],
    ['linux', 'linux', LINUX],
  ])('a prod package and a beta package resolve the same profile on %s', (_case, platform, env) => {
    const prod = profileDirectory('prod', platform, env)
    const beta = profileDirectory('beta', platform, env)
    expect(beta).toBe(prod)
    expect(prod).toMatch(/[/\\]hemera[/\\]prod$/)
  })
})

describe('Le canal dev a son propre profil', () => {
  test.each([
    ['windows', 'win32', WINDOWS],
    ['linux', 'linux', LINUX],
  ])('a dev build reads and writes nothing the real profile owns on %s', (_case, platform, env) => {
    const dev = profileDirectory('dev', platform, env)
    expect(dev).toMatch(/[/\\]hemera[/\\]dev$/)
    expect(dev).not.toBe(profileDirectory('prod', platform, env))
  })
})

describe('Le dossier suit la plateforme', () => {
  test('windows files the profile under the local data folder, never the roaming one', () => {
    const directory = profileDirectory('prod', 'win32', {
      ...WINDOWS,
      APPDATA: 'C:\\Users\\kris\\AppData\\Roaming',
    })
    expect(directory).toBe(`${WINDOWS.LOCALAPPDATA}\\hemera\\prod`)
    expect(directory).not.toContain('Roaming')
  })

  test('linux files the profile under the data folder, never under the configuration one', () => {
    const directory = profileDirectory('prod', 'linux', {
      ...LINUX,
      XDG_CONFIG_HOME: '/home/someone/.config',
    })
    expect(directory).toBe(`${LINUX.XDG_DATA_HOME}/hemera/prod`)
    expect(directory).not.toContain('.config')
  })

  test('linux falls back to the data folder the specification names when none is set', () => {
    const directory = profileDirectory('prod', 'linux', { HOME: '/home/someone' })
    expect(directory).toBe('/home/someone/.local/share/hemera/prod')
  })
})

describe('Non packagé, c’est dev', () => {
  test('an application started outside a package is dev whatever the environment says', () => {
    const root = packaged({ channel: 'prod' })
    try {
      // The manifest of the repository is right there and says `prod`; it is not a package, so
      // it is not read at all.
      expect(channel(false, root)).toBe('dev')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('a package whose manifest names no channel is dev, never prod by omission', () => {
    const root = packaged(null)
    try {
      expect(channel(true, root)).toBe('dev')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test.each<Channel>(['prod', 'beta', 'dev'])(
    'a package built as %s declares itself so',
    (built) => {
      const root = packaged({ channel: built })
      try {
        expect(channel(true, root)).toBe(built)
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    },
  )
})

describe('Le canal ne se change pas à l’exécution', () => {
  test('a prod package stays prod against an argument and an environment variable', () => {
    const root = packaged({ channel: 'prod' })
    const argv = ['--channel', 'dev', '--channel=beta']
    const environment = { ...LINUX, HEMERA_CHANNEL: 'dev', NODE_ENV: 'development' }
    try {
      expect(channel(true, root)).toBe('prod')
      // And what it opens follows the channel, not the argument: the flag is refused the
      // moment a build is not `dev`.
      const choice = chooseProfile('prod', 'linux', environment, [
        ...argv,
        PROFILE_DIRECTORY_FLAG,
        '/tmp/elsewhere',
      ])
      expect(choice.accepted && choice.directory).toBe(profileDirectory('prod', 'linux', LINUX))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('Un test démarre dans un dossier temporaire', () => {
  test('a dev build pointed at an empty folder opens that folder and nothing else', () => {
    // A real folder of this machine, so the platform asked about is this machine's: a Windows
    // path resolved by the Linux rule is not a folder anywhere.
    const elsewhere = mkdtempSync(join(tmpdir(), 'hemera-profile-'))
    const here = process.platform === 'win32' ? WINDOWS : LINUX
    try {
      const choice = chooseProfile('dev', process.platform, here, [
        PROFILE_DIRECTORY_FLAG,
        elsewhere,
      ])
      expect(choice.accepted && choice.directory).toBe(resolve(elsewhere))
    } finally {
      rmSync(elsewhere, { recursive: true, force: true })
    }
  })

  test('the flag is read written either way round', () => {
    const choice = chooseProfile('dev', 'linux', LINUX, [`${PROFILE_DIRECTORY_FLAG}=/tmp/apart`])
    expect(choice.accepted && choice.directory).toBe(posix.resolve('/tmp/apart'))
  })
})

describe('Le profil prod n’est pas atteignable par ce chemin', () => {
  test('a dev build pointed at the real profile refuses, and says which folder it refused', () => {
    const real = profileDirectory('prod', 'linux', LINUX)
    const choice = chooseProfile('dev', 'linux', LINUX, [PROFILE_DIRECTORY_FLAG, real])
    expect(choice.accepted).toBe(false)
    expect(choice.accepted || choice.reason).toContain(real)
  })

  test('the refusal holds however the path is written', () => {
    const real = profileDirectory('prod', 'linux', LINUX)
    const roundabout = `${real}/../prod`
    const choice = chooseProfile('dev', 'linux', LINUX, [PROFILE_DIRECTORY_FLAG, roundabout])
    expect(choice.accepted).toBe(false)
  })

  test('the refusal holds on windows, which does not tell the case of a path apart', () => {
    const real = profileDirectory('prod', 'win32', WINDOWS)
    const shouted = chooseProfile('dev', 'win32', WINDOWS, [PROFILE_DIRECTORY_FLAG, real])
    expect(shouted.accepted).toBe(false)

    // The same folder, spelled the way a shell or a script would hand it over.
    const whispered = chooseProfile('dev', 'win32', WINDOWS, [
      PROFILE_DIRECTORY_FLAG,
      real.toLowerCase(),
    ])
    expect(whispered.accepted).toBe(false)
    expect(whispered.accepted || whispered.reason).toContain(real)
  })
})

describe('Un paquet prod ignore l’argument', () => {
  test.each<Channel>(['prod', 'beta'])(
    'a %s package opens its own profile, argument or not',
    (built) => {
      const asked = mkdtempSync(join(tmpdir(), 'hemera-ignored-'))
      mkdirSync(asked, { recursive: true })
      try {
        const choice = chooseProfile(built, 'linux', LINUX, [PROFILE_DIRECTORY_FLAG, asked])
        expect(choice.accepted && choice.directory).toBe(profileDirectory(built, 'linux', LINUX))
      } finally {
        rmSync(asked, { recursive: true, force: true })
      }
    },
  )
})

describe('Un paquet porte sa version', () => {
  test('a package answers the version it was built with', () => {
    expect(applicationVersion(true, '0.3.0-12-gabc1', {})).toBe('0.3.0-12-gabc1')
  })

  test('an environment variable does not rename a package', () => {
    const environment = { [VERSION_VARIABLE]: '9.9.9' }
    expect(applicationVersion(true, '0.3.0-12-gabc1', environment)).toBe('0.3.0-12-gabc1')
  })

  test('a development run wears the label the repository answered', () => {
    const environment = { [VERSION_VARIABLE]: '0.2.0-4-gdeadbee' }
    expect(applicationVersion(false, '0.0.0', environment)).toBe('0.2.0-4-gdeadbee')
  })

  test('a development run and a package answer the same shape, tag or no tag', () => {
    // `git describe` answers a tag, and a tag is written with a `v` a version does not have.
    const environment = { [VERSION_VARIABLE]: 'v0.2.0-4-gdeadbee' }
    expect(applicationVersion(false, '0.0.0', environment)).toBe('0.2.0-4-gdeadbee')
  })

  test('a development run with no label falls back to the manifest rather than inventing one', () => {
    expect(applicationVersion(false, '0.0.0', {})).toBe('0.0.0')
    expect(applicationVersion(false, '0.0.0', { [VERSION_VARIABLE]: '' })).toBe('0.0.0')
  })
})
