/**
 * The profile a fixture opens the application on (#420): only a marked folder under the fixtures
 * root, never the profile the application uses normally, and never in a packaged build. Without
 * the flag, nothing changes.
 */

import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { Result } from 'effect'
import { afterEach, describe, expect, test } from 'vite-plus/test'

import {
  FIXTURE_FLAG,
  FIXTURE_MARKER,
  type FixtureSystem,
  checkFixtureFolder,
  fixtureProfileOf,
  fixturesRoot,
  isWithin,
  profilesIn,
} from '../src/main/fixture-profile.ts'
import { removeFolders, temporaryFolder } from './storage.ts'

afterEach(removeFolders)

/** A fixtures root with one marked fixture folder in it, and a normal profile beside it. */
const world = () => {
  const base = temporaryFolder('fixture-profile')
  const root = join(base, 'fixtures')
  const fixture = join(root, 'empty')
  mkdirSync(fixture, { recursive: true })
  writeFileSync(join(fixture, FIXTURE_MARKER), '{"group":"empty"}\n')
  const normalProfile = join(base, 'config', 'Hemera')
  mkdirSync(normalProfile, { recursive: true })
  return { base, root, fixture, normalProfile }
}

const refusal = (checked: Result.Result<string, string>): string =>
  Result.isFailure(checked) ? checked.failure : 'accepted'

describe('The fixture profile is refused anywhere but a marked folder of the fixtures root', () => {
  test('a marked folder under the fixtures root is the profile opened', () => {
    const { root, fixture, normalProfile } = world()
    const checked = checkFixtureFolder(fixture, { root, normalProfiles: [normalProfile] })
    expect(Result.isSuccess(checked)).toBe(true)
  })

  test('the command refuses a path outside the fixtures root', () => {
    const { base, root, normalProfile } = world()
    const outside = join(base, 'elsewhere')
    mkdirSync(outside)
    writeFileSync(join(outside, FIXTURE_MARKER), '{}\n')
    expect(refusal(checkFixtureFolder(outside, { root, normalProfiles: [normalProfile] }))).toMatch(
      /is not under the fixtures root/,
    )
    // The root itself holds the fixtures; it is none of them.
    writeFileSync(join(root, FIXTURE_MARKER), '{}\n')
    expect(refusal(checkFixtureFolder(root, { root, normalProfiles: [normalProfile] }))).toMatch(
      /is not under the fixtures root/,
    )
    // A way out through `..` is outside too.
    expect(
      refusal(
        checkFixtureFolder(join(root, 'empty', '..', '..', 'elsewhere'), {
          root,
          normalProfiles: [normalProfile],
        }),
      ),
    ).toMatch(/is not under the fixtures root/)
  })

  test('the command refuses a link under the fixtures root that leads outside it', () => {
    const { base, root, normalProfile } = world()
    const outside = join(base, 'elsewhere')
    mkdirSync(outside)
    writeFileSync(join(outside, FIXTURE_MARKER), '{}\n')
    const link = join(root, 'linked')
    // A junction needs no privilege on Windows; elsewhere the type is ignored.
    symlinkSync(outside, link, 'junction')
    expect(refusal(checkFixtureFolder(link, { root, normalProfiles: [normalProfile] }))).toMatch(
      /is not under the fixtures root/,
    )
  })

  test('the command refuses a folder without the marker', () => {
    const { root, normalProfile } = world()
    const unmarked = join(root, 'unmarked')
    mkdirSync(unmarked)
    expect(
      refusal(checkFixtureFolder(unmarked, { root, normalProfiles: [normalProfile] })),
    ).toMatch(/carries no fixture marker/)
    expect(
      refusal(checkFixtureFolder(join(root, 'missing'), { root, normalProfiles: [normalProfile] })),
    ).toMatch(/carries no fixture marker/)
  })

  test('the command refuses the normal profile', () => {
    const { root } = world()
    // Even marked and under the root, the profile the application uses normally is never opened.
    const normalProfile = join(root, 'Hemera')
    mkdirSync(normalProfile)
    writeFileSync(join(normalProfile, FIXTURE_MARKER), '{}\n')
    expect(
      refusal(checkFixtureFolder(normalProfile, { root, normalProfiles: [normalProfile] })),
    ).toMatch(/is the profile Hemera uses normally/)
    // Nor a folder inside it.
    const inside = join(normalProfile, 'nested')
    mkdirSync(inside)
    writeFileSync(join(inside, FIXTURE_MARKER), '{}\n')
    expect(refusal(checkFixtureFolder(inside, { root, normalProfiles: [normalProfile] }))).toMatch(
      /is the profile Hemera uses normally/,
    )
    // Nor a folder that holds it.
    const holder = join(root, 'holder')
    mkdirSync(join(holder, 'Hemera'), { recursive: true })
    writeFileSync(join(holder, FIXTURE_MARKER), '{}\n')
    expect(
      refusal(checkFixtureFolder(holder, { root, normalProfiles: [join(holder, 'Hemera')] })),
    ).toMatch(/is the profile Hemera uses normally/)
  })
})

describe('The application is pointed at a fixture by its own flag only', () => {
  test('without the flag, the profile is the normal one', () => {
    const { root, normalProfile } = world()
    expect(
      fixtureProfileOf({
        argv: ['electron', '.'],
        packaged: false,
        root,
        normalProfiles: [normalProfile],
      }),
    ).toBeNull()
  })

  test('the flag names the fixture folder, written either way round', () => {
    const { root, fixture, normalProfile } = world()
    for (const argv of [
      ['electron', '.', `${FIXTURE_FLAG}=${fixture}`],
      ['electron', '.', FIXTURE_FLAG, fixture],
    ]) {
      const asked = fixtureProfileOf({
        argv,
        packaged: false,
        root,
        normalProfiles: [normalProfile],
      })
      expect(asked !== null && Result.isSuccess(asked)).toBe(true)
    }
  })

  test('the flag without a folder is refused, not ignored', () => {
    const { root, normalProfile } = world()
    const asked = fixtureProfileOf({
      argv: ['electron', '.', FIXTURE_FLAG],
      packaged: false,
      root,
      normalProfiles: [normalProfile],
    })
    expect(asked !== null && refusal(asked)).toMatch(/names no folder/)
  })

  test('a packaged build has no fixtures', () => {
    const { root, fixture, normalProfile } = world()
    // A packaged build refuses the flag, even on a folder the command built.
    const asked = fixtureProfileOf({
      argv: ['hemera', `${FIXTURE_FLAG}=${fixture}`],
      packaged: true,
      root,
      normalProfiles: [normalProfile],
    })
    expect(asked !== null && refusal(asked)).toMatch(/packaged build of Hemera has no fixtures/)
    // And a package carries none of the fixtures' code: only what was built, by name.
    const packaging = readFileSync(join(import.meta.dirname, '..', 'electron-builder.yml'), 'utf8')
    const files = packaging.slice(packaging.indexOf('files:'), packaging.indexOf('extraResources:'))
    expect(files).not.toMatch(/fixtures/)
    expect(files).toMatch(/- dist\/\*\*/)
  })
})

/** The system as the checks see it: the account running them, and what a path is, as found. */
const seen = (
  stat: ReturnType<FixtureSystem['stat']>,
  user: number | null = 1000,
): FixtureSystem => ({
  user,
  stat: () => stat,
})

describe("The fixtures root is the user's own", () => {
  test('the root is in a folder of the user, never in the temporary directory every account shares', () => {
    expect(fixturesRoot('linux', { XDG_CACHE_HOME: '/home/someone/.cache' })).toBe(
      join('/home/someone/.cache', 'hemera-fixtures'),
    )
    expect(fixturesRoot('linux', {})).toBe(join(homedir(), '.cache', 'hemera-fixtures'))
    // A relative XDG_CACHE_HOME is not one: the specification says to ignore it.
    expect(fixturesRoot('linux', { XDG_CACHE_HOME: 'cache' })).toBe(
      join(homedir(), '.cache', 'hemera-fixtures'),
    )
  })

  test('a root that is a link is refused', () => {
    const { base, fixture, normalProfile } = world()
    const linked = join(base, 'linked-root')
    // A junction needs no privilege on Windows; elsewhere the type is ignored.
    symlinkSync(join(base, 'fixtures'), linked, 'junction')
    const through = join(linked, 'empty')
    expect(fixture.startsWith(join(base, 'fixtures'))).toBe(true)
    expect(
      refusal(checkFixtureFolder(through, { root: linked, normalProfiles: [normalProfile] })),
    ).toMatch(/is a link/)
  })

  test('a root another account owns is refused', () => {
    const { root, fixture, normalProfile } = world()
    const system = seen({ link: false, owner: 1001, mode: 0o40700 })
    expect(
      refusal(checkFixtureFolder(fixture, { root, normalProfiles: [normalProfile], system })),
    ).toMatch(/belongs to another account/)
  })

  test('a root its group or other accounts can write to is refused', () => {
    const { root, fixture, normalProfile } = world()
    for (const mode of [0o40770, 0o40707, 0o40720, 0o40702]) {
      const system = seen({ link: false, owner: 1000, mode })
      expect(
        refusal(checkFixtureFolder(fixture, { root, normalProfiles: [normalProfile], system })),
      ).toMatch(/other accounts can write to/)
    }
    // Owned by the user and written by the user alone, it is the root.
    const system = seen({ link: false, owner: 1000, mode: 0o40755 })
    expect(
      Result.isSuccess(
        checkFixtureFolder(fixture, { root, normalProfiles: [normalProfile], system }),
      ),
    ).toBe(true)
  })

  test('where the system has no owner to read (Windows), a link is still refused', () => {
    const { root, fixture, normalProfile } = world()
    const owned = seen({ link: false, owner: 0, mode: 0o40777 }, null)
    expect(
      Result.isSuccess(
        checkFixtureFolder(fixture, { root, normalProfiles: [normalProfile], system: owned }),
      ),
    ).toBe(true)
    const linked = seen({ link: true, owner: 0, mode: 0o40777 }, null)
    expect(
      refusal(
        checkFixtureFolder(fixture, { root, normalProfiles: [normalProfile], system: linked }),
      ),
    ).toMatch(/is a link/)
  })

  test('a root that does not exist holds no fixture', () => {
    const { base, normalProfile } = world()
    const root = join(base, 'no-root')
    expect(
      refusal(checkFixtureFolder(join(root, 'empty'), { root, normalProfiles: [normalProfile] })),
    ).toMatch(/does not exist/)
  })
})

describe('Paths are compared as the system compares them', () => {
  test('on Windows, a path on another drive is not under the root', () => {
    expect(isWithin('D:\\fixtures\\empty', 'C:\\fixtures', 'win32')).toBe(false)
    expect(isWithin('C:\\fixtures\\empty', 'C:\\fixtures', 'win32')).toBe(true)
  })

  test('on Windows, case does not tell two paths apart; elsewhere it does', () => {
    expect(isWithin('c:\\Fixtures\\Empty', 'C:\\fixtures', 'win32')).toBe(true)
    expect(isWithin('C:\\fixtures', 'c:\\FIXTURES\\', 'win32')).toBe(true)
    expect(isWithin('/tmp/Fixtures/empty', '/tmp/fixtures', 'linux')).toBe(false)
  })
})

describe('No fixture is the profile of any build of Hemera', () => {
  test('the profiles of every channel, and of the development run, are the normal ones', () => {
    const appData = join('/home/someone/.config')
    expect(profilesIn(appData)).toEqual(
      expect.arrayContaining(
        ['@hemera/desktop', 'Hemera', 'Hemera Beta', 'Hemera Dev'].map((name) =>
          join(appData, name),
        ),
      ),
    )
  })
})
