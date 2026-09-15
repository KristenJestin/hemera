import { describe, expect, test } from 'bun:test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  CHANNEL_OVERRIDE_VARIABLE,
  PROFILE_OVERRIDE_VARIABLE,
  UnsupportedPlatformError,
  profileFolderOf,
  resolveChannel,
  resolveProfileLocation,
} from '#index.ts'

const HOME = '/home/kris'

describe('Premier lancement sur chaque système', () => {
  test('Windows places the profile under the local application data', () => {
    const location = resolveProfileLocation({
      platform: 'win32',
      env: { LOCALAPPDATA: 'C:\\Users\\kris\\AppData\\Local' },
      channel: 'prod',
      home: 'C:\\Users\\kris',
    })
    expect(location.source).toBe('localAppData')
    expect(location.directory).toBe(join('C:\\Users\\kris\\AppData\\Local', 'Hemera'))
  })

  test('Linux places the profile under the data home', () => {
    const location = resolveProfileLocation({
      platform: 'linux',
      env: { XDG_DATA_HOME: '/home/kris/.local/share' },
      channel: 'prod',
      home: HOME,
    })
    expect(location.source).toBe('xdgDataHome')
    expect(location.directory).toBe(join('/home/kris/.local/share', 'Hemera'))
  })

  test('Linux falls back to the documented path when the variable is absent', () => {
    const location = resolveProfileLocation({
      platform: 'linux',
      env: {},
      channel: 'prod',
      home: HOME,
    })
    expect(location.source).toBe('xdgFallback')
    expect(location.directory).toBe(join(HOME, '.local', 'share', 'Hemera'))
  })

  test('Windows without its variable refuses rather than inventing a place', () => {
    expect(() =>
      resolveProfileLocation({ platform: 'win32', env: {}, channel: 'prod', home: 'C:\\' }),
    ).toThrow(/LOCALAPPDATA/)
  })

  test('a platform with no defined location is refused by name', () => {
    expect(() =>
      resolveProfileLocation({ platform: 'darwin', env: {}, channel: 'prod', home: HOME }),
    ).toThrow(UnsupportedPlatformError)
  })
})

describe('Profil de test', () => {
  test('an explicit path is used instead of the real profile', () => {
    const location = resolveProfileLocation({
      platform: 'win32',
      env: { LOCALAPPDATA: 'C:\\Users\\kris\\AppData\\Local' },
      channel: 'prod',
      home: 'C:\\Users\\kris',
      override: 'D:\\fixtures',
    })
    expect(location.source).toBe('explicit')
    expect(location.directory).toBe(join('D:\\fixtures', 'Hemera'))
  })

  test('the reserved variable names the alternative path', () => {
    const location = resolveProfileLocation({
      platform: 'linux',
      env: { [PROFILE_OVERRIDE_VARIABLE]: '/fixtures', XDG_DATA_HOME: '/home/kris/.local/share' },
      channel: 'dev',
      home: HOME,
    })
    expect(location.source).toBe('explicit')
    expect(location.directory).toBe(join('/fixtures', 'Hemera-dev'))
  })

  test('the profile is never placed in a temporary directory of the system', () => {
    const location = resolveProfileLocation({
      platform: 'linux',
      env: {},
      channel: 'prod',
      home: HOME,
    })
    expect(location.directory.startsWith(tmpdir())).toBe(false)
  })
})

describe('Paquet dev distribué', () => {
  test('each channel keeps its own profile folder', () => {
    expect(profileFolderOf('prod')).toBe('Hemera')
    expect(profileFolderOf('dev')).toBe('Hemera-dev')

    const environment = { LOCALAPPDATA: 'C:\\Local' }
    const production = resolveProfileLocation({
      platform: 'win32',
      env: environment,
      channel: 'prod',
      home: 'C:\\Users\\kris',
    })
    const development = resolveProfileLocation({
      platform: 'win32',
      env: environment,
      channel: 'dev',
      home: 'C:\\Users\\kris',
    })
    expect(production.directory).not.toBe(development.directory)
  })

  test('a dev package never resolves to the prod profile', () => {
    const channel = resolveChannel({ packaged: 'dev', env: {}, development: false })
    const location = resolveProfileLocation({
      platform: 'win32',
      env: { LOCALAPPDATA: 'C:\\Local' },
      channel,
      home: 'C:\\Users\\kris',
    })
    expect(location.directory).toContain('Hemera-dev')
    expect(location.directory).not.toBe(join('C:\\Local', 'Hemera'))
  })
})

describe('Surcharge de canal hors test', () => {
  test('without the reserved variable the packaged channel applies', () => {
    expect(resolveChannel({ packaged: 'prod', env: {}, development: false })).toBe('prod')
    expect(
      resolveChannel({
        packaged: 'prod',
        env: { [CHANNEL_OVERRIDE_VARIABLE]: '' },
        development: false,
      }),
    ).toBe('prod')
  })
})
