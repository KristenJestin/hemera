/**
 * The Commands section of a Project's settings says the engine's views and hands them back
 * without losing anything (D8-07, D8-10, recette 1): read without a DOM, from the module the page
 * hands the components from.
 */

import { describe, expect, test } from 'vite-plus/test'

import type { Command } from '@hemera/ipc'
import { commandLineOf, commandWriteOf } from '#renderer/project-lines.ts'

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
