/**
 * The Build section of a Project's settings, over the whole engine (D10-06).
 *
 * The section is drawn from the checks store and the mapping of `project-lines.ts`: what is under
 * test is that what the section writes through `checks.*` is what the engine then answers — the
 * checks proposed from the catalogue and saved only once accepted, a check added, edited and
 * removed — and that a refusal comes back in the engine's own words, for the dialog to say.
 */

import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import type { CommandType } from '@hemera/ipc'
import type { CheckLine } from '@hemera/ui'

import { fakeAgent } from '#engine/agents/fake.ts'
import {
  acceptProposed,
  checksOf,
  discardProposed,
  proposedOf,
  readChecks,
  removeCheck,
  saveCheck,
} from '#renderer/checks-store.ts'
import {
  checkCommandsOf,
  checkDraftOf,
  checkLineOf,
  proposedLinesOf,
} from '#renderer/project-lines.ts'

import { type OpenWindow, install, openWindow } from './window.ts'

let dataFolder: string
let main: string
let opened: OpenWindow | null = null

beforeEach(() => {
  dataFolder = realpathSync.native(mkdtempSync(join(tmpdir(), 'hemera-build-settings-')))
  main = realpathSync.native(mkdtempSync(join(tmpdir(), 'hemera-build-settings-main-')))
})

afterEach(async () => {
  await opened?.close()
  opened = null
  for (const folder of [dataFolder, main]) rmSync(folder, { recursive: true, force: true })
})

/** A window on a Project `Atlas` with the repository `api` and a catalogue of these commands. */
async function atlas(commands: readonly [string, CommandType][]) {
  opened = await openWindow(dataFolder, fakeAgent())
  install(opened.bridge)
  mkdirSync(join(main, 'api'))
  const made = await opened.bridge.invoke('projects.create', {
    name: 'Atlas',
    tone: 'primary',
    mainPath: main,
  })
  await opened.bridge.invoke('repositories.add', {
    id: made.id,
    version: made.version,
    relativePath: 'api',
  })
  for (const [name, type] of commands) {
    // oxlint-disable-next-line no-await-in-loop -- the catalogue is written in its order
    await opened.bridge.invoke('commands.create', {
      projectId: made.id,
      name,
      line: `pnpm ${name}`,
      lineWindows: null,
      lineLinux: null,
      type,
      folderBase: null,
      folder: null,
      scope: 'workspace',
      portless: false,
      portlessName: null,
    })
  }
  return made.id
}

/** A line of the user's, as the check dialog hands it back. */
const COVERAGE: CheckLine = {
  id: '',
  name: 'Coverage',
  commandId: null,
  line: 'pnpm vitest run --coverage {files}',
  where: 'repository',
  repository: 'api',
  when: 'task',
  expect: { pattern: 'All files\\s*\\|\\s*([0-9.]+)', minimum: 70 },
  files: 'src/**/*.test.ts',
}

describe('Defaults come from the catalogue', () => {
  test('checks are proposed from the types, and nothing is saved until the user accepts them', async () => {
    const projectId = await atlas([
      ['lint', 'lint'],
      ['test', 'test'],
      ['e2e', 'test'],
      ['build', 'build'],
      ['dev', 'serve'],
    ])

    await readChecks(projectId)
    expect(checksOf(projectId)).toEqual([])
    const proposals = proposedLinesOf(proposedOf(projectId))
    // One per command that ends, in the catalogue's order; a `serve` is never a check.
    expect(proposals.map((one) => [one.name, one.when, one.where]).toSorted()).toEqual([
      ['build', 'end', 'root'],
      ['e2e', 'end', 'root'],
      ['lint', 'task', 'changed'],
      ['test', 'story', 'changed'],
    ])
    // Proposed, and not saved: the engine still holds no check.
    expect((await opened?.bridge.invoke('checks.list', { projectId }))?.checks).toEqual([])

    // One left out, one edited in the dialog, the rest as proposed.
    const kept = proposals.filter((one) => one.name !== 'build')
    const edited = kept.find((one) => one.name === 'test')
    if (edited === undefined) throw new Error('no test was proposed')
    Object.assign(edited, { name: 'Unit tests', when: 'task' })
    expect(await acceptProposed(projectId, kept.map(checkDraftOf))).toBeNull()

    const saved = checksOf(projectId)
    // Saved in the order they were proposed in.
    expect(saved.map((one) => one.name)).toEqual(kept.map((one) => one.name))
    expect(saved.map((one) => [one.name, one.when]).toSorted()).toEqual([
      ['Unit tests', 'task'],
      ['e2e', 'end'],
      ['lint', 'task'],
    ])
    // Each runs its command, known to the section by the command's id.
    const commands = checkCommandsOf(
      (await opened?.bridge.invoke('commands.list', { projectId })) ?? [],
    )
    expect(
      saved.map((one) => commands.find((command) => command.id === one.commandId)?.name).toSorted(),
    ).toEqual(['e2e', 'lint', 'test'])
    // With a check saved, nothing is proposed any more.
    expect(proposedOf(projectId)).toEqual([])
  })

  test('discarded, the proposals are put away and proposed again once the settings are read again', async () => {
    const projectId = await atlas([['lint', 'lint']])
    await readChecks(projectId)
    expect(proposedOf(projectId)).toHaveLength(1)

    discardProposed(projectId)
    expect(proposedOf(projectId)).toEqual([])
    expect((await opened?.bridge.invoke('checks.list', { projectId }))?.checks).toEqual([])

    await readChecks(projectId)
    expect(proposedOf(projectId)).toHaveLength(1)
  })
})

describe('A check is added, edited and removed from the Build section', () => {
  test('a line of the user’s is saved as the dialog wrote it, edited in place and removed', async () => {
    const projectId = await atlas([])
    await readChecks(projectId)

    expect(await saveCheck(projectId, null, checkDraftOf(COVERAGE))).toBeNull()
    const [added] = checksOf(projectId)
    if (added === undefined) throw new Error('the check was not saved')
    expect(checkLineOf(added)).toEqual({ ...COVERAGE, id: added.id })

    const edited = { ...checkLineOf(added), when: 'story' as const, expect: null }
    expect(await saveCheck(projectId, edited.id, checkDraftOf(edited))).toBeNull()
    expect(checksOf(projectId).map(checkLineOf)).toEqual([edited])

    await removeCheck(projectId, added.id)
    expect(checksOf(projectId)).toEqual([])
  })

  test('a check refused is refused in the engine’s words, for the dialog to say', async () => {
    const projectId = await atlas([])
    await readChecks(projectId)
    expect(await saveCheck(projectId, null, checkDraftOf(COVERAGE))).toBeNull()

    expect(await saveCheck(projectId, null, checkDraftOf(COVERAGE))).toBe(
      'A check named “Coverage” already exists.',
    )
    expect(
      await saveCheck(projectId, null, checkDraftOf({ ...COVERAGE, name: 'Nothing', line: '' })),
    ).toBe('Choose a command of the catalogue or write a line to run.')
    expect(checksOf(projectId)).toHaveLength(1)
  })
})
