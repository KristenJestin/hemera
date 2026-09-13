/**
 * The assembled package, started as a user starts it.
 *
 * Nothing here reads the sources: the executable is copied into a folder whose path has
 * spaces, outside the monorepo, and is run from there.
 */

import { describe, expect, test } from 'bun:test'
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import {
  createProject,
  createSession,
  listProjects,
  listSessions,
  openProfile,
  readMessages,
  recordMessage,
} from '@hemera/runtime'

import { assemblePackage, executableNameOf } from '../../../tools/package-desktop.ts'
import { targetOfHost } from '../../../tools/environment-report.ts'

const repository = resolve(import.meta.dir, '..', '..', '..')

interface Installed {
  directory: string
  executable: string
  /** Folder the profile of the package lands under. */
  appData: string
}

/** Assembles a package and installs it in a folder whose path has spaces. */
async function install(channel: 'prod' | 'dev'): Promise<Installed> {
  const assembled = await assemblePackage(repository, channel)
  const root = mkdtempSync(join(tmpdir(), 'hemera-install-'))
  const directory = join(root, 'Program Files of the user')
  mkdirSync(directory, { recursive: true })
  cpSync(assembled.directory, directory, { recursive: true })
  const appData = join(root, 'Application Data')
  mkdirSync(appData, { recursive: true })
  return { directory, executable: join(directory, executableNameOf(targetOfHost())), appData }
}

/** Starts the installed package and reads what it announced, then stops it. */
async function start(installed: Installed, timeoutMs = 60_000): Promise<string[]> {
  const child = Bun.spawn([installed.executable], {
    cwd: installed.directory,
    env: {
      ...process.env,
      LOCALAPPDATA: installed.appData,
      XDG_DATA_HOME: installed.appData,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const lines: string[] = []
  const deadline = Date.now() + timeoutMs
  try {
    const reader = child.stdout.getReader()
    const decoder = new TextDecoder()
    let buffered = ''
    while (Date.now() < deadline) {
      // oxlint-disable-next-line no-await-in-loop
      const { value, done } = await reader.read()
      if (done) break
      buffered += decoder.decode(value, { stream: true })
      const parts = buffered.split('\n')
      buffered = parts.pop() ?? ''
      lines.push(...parts.map((line) => line.trim()).filter((line) => line.length > 0))
      if (lines.some((line) => line.startsWith('window opened'))) break
    }
  } finally {
    child.kill()
    await child.exited
  }
  return lines
}

/** The profile folder the package opened, read from what it announced. */
function profileOf(lines: string[]): string {
  const announcement = lines.find((line) => line.startsWith('channel '))
  const profile = announcement?.split('profile ')[1]
  if (profile === undefined) throw new Error('the package announced no profile')
  return profile
}

describe('Lancement hors checkout', () => {
  test('the package starts from a folder with spaces, outside the sources', async () => {
    const installed = await install('prod')
    try {
      const lines = await start(installed)

      expect(lines).toContain('[gpuix] created native window')
      expect(lines.some((line) => line.startsWith('window opened'))).toBe(true)
      expect(lines.some((line) => /^fonts registered (\d+)\/\1$/.test(line))).toBe(true)

      // The channel of the package applies, and its profile is the installed one.
      expect(lines.some((line) => line.startsWith('channel prod'))).toBe(true)
      expect(profileOf(lines).endsWith('Hemera')).toBe(true)
    } finally {
      rmSync(join(installed.directory, '..'), { recursive: true, force: true })
    }
  }, 180_000)
})

describe('Remplacement du paquet', () => {
  test('a replaced package restarts on the same profile and finds its data again', async () => {
    const installed = await install('prod')
    try {
      // A first start creates the profile the package will reopen.
      const profile = profileOf(await start(installed))

      // The user works: a project, a session, a message, written through the same storage.
      const opened = openProfile({ directory: profile, now: Date.now() })
      let count = 0
      const context = {
        database: opened.database,
        ids: { next: () => `id-${(count += 1)}` },
        now: Date.now(),
      }
      const { project } = createProject(context, { name: 'Hemera', path: installed.directory })
      const session = createSession(context, project.id)
      recordMessage(context, session.id, 'written before the package was replaced')
      opened.database.close()

      // The package is replaced by a freshly assembled one, as an update is done.
      const replacement = await assemblePackage(repository, 'prod')
      rmSync(installed.directory, { recursive: true, force: true })
      mkdirSync(installed.directory, { recursive: true })
      cpSync(replacement.directory, installed.directory, { recursive: true })

      const before = readdirSync(installed.directory).toSorted()
      const lines = await start(installed)
      expect(profileOf(lines)).toBe(profile)

      // Nothing was downloaded or installed beside the package at start-up.
      expect(readdirSync(installed.directory).toSorted()).toEqual(before)

      const reopened = openProfile({ directory: profile, now: Date.now() })
      try {
        expect(listProjects(reopened.database).map((entry) => entry.name)).toEqual(['Hemera'])
        expect(listSessions(reopened.database, project.id)).toHaveLength(1)
        expect(readMessages(reopened.database, session.id).map((entry) => entry.body)).toEqual([
          'written before the package was replaced',
        ])
      } finally {
        reopened.database.close()
      }
    } finally {
      rmSync(join(installed.directory, '..'), { recursive: true, force: true })
    }
  }, 240_000)
})
