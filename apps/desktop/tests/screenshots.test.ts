/**
 * Hemera's own screenshots (#253): which path names one, decided on the path's words before any is
 * resolved, so that a network path is never touched; the path given back is the real one checked.
 */

import { join, sep } from 'node:path'

import { describe, expect, test } from 'vite-plus/test'

import { screenshotIn } from '../src/engine/screenshots.ts'

const FOLDER = join(sep, 'data', 'screenshots')

/** A resolver over a fixed map of real paths, which counts what it was asked. */
const resolver = (real: Readonly<Record<string, string>>) => {
  const asked: string[] = []
  const resolve = (path: string): string | null => {
    asked.push(path)
    return real[path] ?? null
  }
  return { asked, resolve }
}

describe('A screenshot is named under its folder before anything is resolved', () => {
  test.each([
    ['a Windows network path', String.raw`\\host\share\shot.png`],
    ['a network path written with slashes', '//host/share/shot.png'],
    // Written as an agent would give it: join() would take the `..` out.
    [
      'a .. segment, even one that comes back inside',
      [FOLDER, '..', 'screenshots', 'x.png'].join(sep),
    ],
    ['a path outside the folder', join(sep, 'data', 'hemera.db')],
    ['the folder itself', FOLDER],
    ['a relative path', 'shot.png'],
  ])('%s is refused without resolving anything', (_case, path) => {
    const { asked, resolve } = resolver({ [FOLDER]: FOLDER })
    expect(screenshotIn(FOLDER, resolve)(path)).toBeNull()
    expect(asked).toEqual([])
  })

  test('a screenshot under the folder gives back its real path', () => {
    const shot = join(FOLDER, 'link.png')
    const real = join(FOLDER, 'shot.png')
    const { resolve } = resolver({ [FOLDER]: FOLDER, [shot]: real })
    expect(screenshotIn(FOLDER, resolve)(shot)).toBe(real)
  })

  test('a screenshot whose real path is elsewhere is refused', () => {
    const shot = join(FOLDER, 'shot.png')
    const { resolve } = resolver({ [FOLDER]: FOLDER, [shot]: join(sep, 'home', 'id_ed25519') })
    expect(screenshotIn(FOLDER, resolve)(shot)).toBeNull()
  })
})
