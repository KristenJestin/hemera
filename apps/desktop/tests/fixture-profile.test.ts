/**
 * The profile a fixture opens the application on (#420): only a marked folder under the fixtures
 * root, never the profile the application uses normally, and never in a packaged build. Without
 * the flag, nothing changes.
 */

import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { Result } from 'effect'
import { afterEach, describe, expect, test } from 'vite-plus/test'

import {
  FIXTURE_FLAG,
  FIXTURE_MARKER,
  checkFixtureFolder,
  fixtureProfileOf,
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
    const checked = checkFixtureFolder(fixture, { root, normalProfile })
    expect(Result.isSuccess(checked)).toBe(true)
  })

  test('the command refuses a path outside the fixtures root', () => {
    const { base, root, normalProfile } = world()
    const outside = join(base, 'elsewhere')
    mkdirSync(outside)
    writeFileSync(join(outside, FIXTURE_MARKER), '{}\n')
    expect(refusal(checkFixtureFolder(outside, { root, normalProfile }))).toMatch(
      /is not under the fixtures root/,
    )
    // The root itself holds the fixtures; it is none of them.
    writeFileSync(join(root, FIXTURE_MARKER), '{}\n')
    expect(refusal(checkFixtureFolder(root, { root, normalProfile }))).toMatch(
      /is not under the fixtures root/,
    )
    // A way out through `..` is outside too.
    expect(
      refusal(
        checkFixtureFolder(join(root, 'empty', '..', '..', 'elsewhere'), { root, normalProfile }),
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
    expect(refusal(checkFixtureFolder(link, { root, normalProfile }))).toMatch(
      /is not under the fixtures root/,
    )
  })

  test('the command refuses a folder without the marker', () => {
    const { root, normalProfile } = world()
    const unmarked = join(root, 'unmarked')
    mkdirSync(unmarked)
    expect(refusal(checkFixtureFolder(unmarked, { root, normalProfile }))).toMatch(
      /carries no fixture marker/,
    )
    expect(refusal(checkFixtureFolder(join(root, 'missing'), { root, normalProfile }))).toMatch(
      /carries no fixture marker/,
    )
  })

  test('the command refuses the normal profile', () => {
    const { root } = world()
    // Even marked and under the root, the profile the application uses normally is never opened.
    const normalProfile = join(root, 'Hemera')
    mkdirSync(normalProfile)
    writeFileSync(join(normalProfile, FIXTURE_MARKER), '{}\n')
    expect(refusal(checkFixtureFolder(normalProfile, { root, normalProfile }))).toMatch(
      /is the profile Hemera uses normally/,
    )
    // Nor a folder inside it.
    const inside = join(normalProfile, 'nested')
    mkdirSync(inside)
    writeFileSync(join(inside, FIXTURE_MARKER), '{}\n')
    expect(refusal(checkFixtureFolder(inside, { root, normalProfile }))).toMatch(
      /is the profile Hemera uses normally/,
    )
    // Nor a folder that holds it.
    const holder = join(root, 'holder')
    mkdirSync(join(holder, 'Hemera'), { recursive: true })
    writeFileSync(join(holder, FIXTURE_MARKER), '{}\n')
    expect(
      refusal(checkFixtureFolder(holder, { root, normalProfile: join(holder, 'Hemera') })),
    ).toMatch(/is the profile Hemera uses normally/)
  })
})

describe('The application is pointed at a fixture by its own flag only', () => {
  test('without the flag, the profile is the normal one', () => {
    const { root, normalProfile } = world()
    expect(
      fixtureProfileOf({ argv: ['electron', '.'], packaged: false, root, normalProfile }),
    ).toBeNull()
  })

  test('the flag names the fixture folder, written either way round', () => {
    const { root, fixture, normalProfile } = world()
    for (const argv of [
      ['electron', '.', `${FIXTURE_FLAG}=${fixture}`],
      ['electron', '.', FIXTURE_FLAG, fixture],
    ]) {
      const asked = fixtureProfileOf({ argv, packaged: false, root, normalProfile })
      expect(asked !== null && Result.isSuccess(asked)).toBe(true)
    }
  })

  test('the flag without a folder is refused, not ignored', () => {
    const { root, normalProfile } = world()
    const asked = fixtureProfileOf({
      argv: ['electron', '.', FIXTURE_FLAG],
      packaged: false,
      root,
      normalProfile,
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
      normalProfile,
    })
    expect(asked !== null && refusal(asked)).toMatch(/packaged build of Hemera has no fixtures/)
    // And a package carries none of the fixtures' code: only what was built, by name.
    const packaging = readFileSync(join(import.meta.dirname, '..', 'electron-builder.yml'), 'utf8')
    const files = packaging.slice(packaging.indexOf('files:'), packaging.indexOf('extraResources:'))
    expect(files).not.toMatch(/fixtures/)
    expect(files).toMatch(/- dist\/\*\*/)
  })
})
