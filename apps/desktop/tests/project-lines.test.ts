/**
 * The Commands and Repositories sections of a Project's settings say the engine's views and hand
 * them back without losing anything (D8-04, D8-07, D8-10, recette 1 and 2): read without a DOM,
 * from the module the page hands the components from.
 */

import { describe, expect, test } from 'vite-plus/test'

import type { Command } from '@hemera/ipc'
import {
  commandLineOf,
  commandWriteOf,
  folderBasePath,
  folderUnderBase,
  repositoryLinesOf,
} from '#renderer/project-lines.ts'

/** A command of `atlas`'s catalogue, as the engine lists one. */
function command(change: Partial<Command> = {}): Command {
  return {
    id: 'command-dev',
    projectId: 'atlas',
    name: 'dev',
    line: 'pnpm dev',
    lineWindows: 'pnpm.cmd dev',
    lineLinux: null,
    type: 'serve',
    folderBase: './sources/front',
    folder: './web',
    scope: 'project',
    portless: true,
    portlessName: 'atlas-front',
    createdAt: 0,
    ...change,
  }
}

describe('A command is read and saved with nothing lost', () => {
  test('its base, its folder under it and its Portless name go to the dialog and come back', () => {
    const line = commandLineOf(command())

    expect(line).toMatchObject({
      folderBase: './sources/front',
      folder: 'web',
      portless: true,
      portlessName: 'atlas-front',
    })
    // Saved unchanged, it is written as it was read: the folder the engine keeps as `./web`.
    expect(commandWriteOf(line)).toEqual({
      name: 'dev',
      line: 'pnpm dev',
      lineWindows: 'pnpm.cmd dev',
      lineLinux: null,
      type: 'serve',
      folderBase: './sources/front',
      folder: 'web',
      scope: 'project',
      portless: true,
      portlessName: 'atlas-front',
    })
  })

  test('a command run at its base itself is an empty folder in the dialog and null for the engine', () => {
    const line = commandLineOf(command({ folderBase: null, folder: null, portlessName: null }))

    expect(line).toMatchObject({ folderBase: null, folder: '', portlessName: null })
    expect(commandWriteOf(line)).toMatchObject({ folderBase: null, folder: null })
  })
})

describe('A folder the picker answered is written relative to where a command runs', () => {
  test('a folder under the base, and the base itself, are the path under it', () => {
    expect(folderUnderBase('/work/atlas', null, '/work/atlas')).toBe('.')
    expect(folderUnderBase('/work/atlas', null, '/work/atlas/apps/api')).toBe('apps/api')
    expect(folderUnderBase('/work/atlas', './sources/api', '/work/atlas/sources/api/src')).toBe(
      'src',
    )
  })

  test('a folder beside the base, or above it, climbs back out of it', () => {
    expect(folderUnderBase('/work/atlas', './sources/api', '/work/atlas/sources/web')).toBe(
      '../web',
    )
    expect(folderUnderBase('/work/atlas', './sources/api', '/work/atlas')).toBe('../..')
  })

  test('a folder outside the Project is the `..` that would reach it, which the field refuses', () => {
    expect(folderUnderBase('/work/atlas', './sources/api', '/home/kris/scratch')).toBe(
      '../../../../home/kris/scratch',
    )
  })

  test('a Windows path is compared as Windows does, whatever the case of its drive', () => {
    expect(folderUnderBase('D:\\Projects\\atlas', null, 'd:\\projects\\atlas\\apps')).toBe('apps')
    expect(folderUnderBase('D:\\Projects\\atlas', './sources/api', 'D:\\Projects\\atlas')).toBe(
      '../..',
    )
  })
})

describe('The folder picker opens where a command runs', () => {
  test("the Workspace root is the Project's own folder, a base is the repository under it", () => {
    expect(folderBasePath('/work/atlas', null)).toBe('/work/atlas')
    expect(folderBasePath('/work/atlas', './sources/api')).toBe('/work/atlas/sources/api')
  })

  test('a base is joined the way its own system writes a path', () => {
    expect(folderBasePath('D:\\Projects\\atlas', './sources/api')).toBe(
      'D:\\Projects\\atlas\\sources\\api',
    )
  })
})

describe('A repository wears the icon the Project gave it', () => {
  test("its icon and its inclusion are the Project's, beside what the disk says", () => {
    const lines = repositoryLinesOf(
      [
        { path: './sources/api', git: 'main', exists: true },
        { path: './sources/front', git: null, exists: false },
      ],
      { included: ['./sources/api'], repositoryIcons: { './sources/api': 'server' } },
    )

    expect(lines).toEqual([
      {
        path: './sources/api',
        branch: 'main',
        exists: true,
        includedByDefault: true,
        icon: 'server',
      },
      {
        path: './sources/front',
        branch: null,
        exists: false,
        includedByDefault: false,
        icon: null,
      },
    ])
  })
})
