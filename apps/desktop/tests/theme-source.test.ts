/**
 * What the application is allowed to say about colour, which is nothing: the theme says it.
 *
 * Each suite is named after the scenario of `specs/design-system/spec.md` it covers.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, test } from 'vite-plus/test'

const application = resolve(import.meta.dirname, '..')

function filesUnder(directory: string): string[] {
  if (!existsSync(directory)) return []
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry)
    return statSync(path).isDirectory() ? filesUnder(path) : [path]
  })
}

describe('Fichiers de couleurs du lot 0 retirés', () => {
  test.each(['src/window-colors.ts', 'src/renderer/application.css'])(
    '%s is gone, because the theme took its place',
    (path) => {
      expect(existsSync(join(application, path))).toBe(false)
    },
  )

  test('no file of the application declares a theme of its own', () => {
    const declaring = filesUnder(join(application, 'src'))
      .filter((file) => readFileSync(file, 'utf8').includes(':root'))
      .map((file) => relative(application, file).replaceAll('\\', '/'))
    expect(declaring).toEqual([])
  })

  test('the application ships no stylesheet at all', () => {
    const stylesheets = filesUnder(join(application, 'src'))
      .filter((file) => file.endsWith('.css'))
      .map((file) => relative(application, file).replaceAll('\\', '/'))
    expect(stylesheets).toEqual([])
  })
})
