/**
 * The Commands rows of the Project settings, over the whole engine (design D6-12).
 *
 * The page is drawn from the tools store: what is under test is that a command written there is
 * the catalogue the agent reads, that a repository of the Project is a folder it may run in, that
 * a name the catalogue already holds is refused in the engine's own words, and that a command is
 * edited and taken out by its name.
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { fakeAgent } from '#engine/agents/fake.ts'
import { catalogueOf, readCatalogue, removeCommand, saveCommand } from '#renderer/tools-store.ts'

import { type OpenWindow, install, openWindow } from './window.ts'

let dataFolder: string
let workspace: string
let opened: OpenWindow | null = null

beforeEach(() => {
  dataFolder = mkdtempSync(join(tmpdir(), 'hemera-project-commands-'))
  workspace = mkdtempSync(join(tmpdir(), 'hemera-project-commands-workspace-'))
  mkdirSync(join(workspace, 'api'))
})

afterEach(async () => {
  await opened?.close()
  opened = null
  rmSync(dataFolder, { recursive: true, force: true })
  rmSync(workspace, { recursive: true, force: true })
})

describe('The catalogue is edited and read', () => {
  test('a command in a repository is saved, listed, edited and taken out from the settings', async () => {
    opened = await openWindow(dataFolder, fakeAgent())
    install(opened.bridge)
    const made = await opened.bridge.invoke('projects.create', {
      name: 'Atlas',
      tone: 'primary',
      mainPath: workspace,
    })
    const project = await opened.bridge.invoke('repositories.add', {
      id: made.id,
      version: made.version,
      relativePath: 'api',
    })
    await readCatalogue(project.id)
    expect(catalogueOf(project.id)).toEqual([])

    const draft = { projectId: project.id, name: 'test', line: 'pnpm test', kind: 'check' as const }
    expect(await saveCommand({ ...draft, folder: './api' }, false)).toBeNull()
    expect(catalogueOf(project.id).map((one) => [one.name, one.kind, one.folder])).toEqual([
      ['test', 'check', './api'],
    ])
    // The agent reads the same catalogue, with the kind and the folder.
    expect(
      (await opened.bridge.invoke('commands.list', { projectId: project.id })).map(
        (one) => one.folder,
      ),
    ).toEqual(['./api'])

    // The same name again is refused, in the engine's sentence, and nothing changes.
    expect(await saveCommand({ ...draft, folder: null }, false)).toBe(
      'a command named test is already in this Project: it is refused, not replaced',
    )
    // A folder that is not one of the Project's repositories is refused as well.
    expect(await saveCommand({ ...draft, name: 'lint', folder: 'scripts' }, false)).toContain(
      "one of the Project's repositories",
    )

    // Edited in place, by its name.
    expect(await saveCommand({ ...draft, line: 'pnpm vitest', folder: null }, true)).toBeNull()
    expect(catalogueOf(project.id).map((one) => [one.name, one.line, one.folder])).toEqual([
      ['test', 'pnpm vitest', null],
    ])

    await removeCommand(project.id, 'test')
    expect(catalogueOf(project.id)).toEqual([])
  })
})
