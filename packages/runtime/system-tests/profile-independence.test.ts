import { describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import {
  DATABASE_FILE,
  listProjects,
  listSessions,
  openProfile,
  readMessages,
} from '../src/index.ts'

const runtime = resolve(import.meta.dir, '..')
const surface = join(runtime, 'src', 'index.ts').replaceAll('\\', '/')

/** A launch that creates a project around a folder of the user, then stops on its own. */
const LAUNCH = `
import { createProject, createSession, openProfile, recordMessage } from '${surface}'

const [directory, workspace] = process.argv.slice(2)
const profile = openProfile({ directory, now: Date.now() })
let count = 0
const context = {
  database: profile.database,
  ids: { next: () => \`id-\${(count += 1)}\` },
  now: Date.now(),
}

const { project } = createProject(context, { name: 'Hemera', path: workspace })
const session = createSession(context, project.id)
recordMessage(context, session.id, 'written while the workspace still existed')
profile.database.close()

console.log(JSON.stringify({ projectId: project.id, sessionId: session.id }))
`

describe("Nettoyage d'un Workspace produit", () => {
  test('deleting a product workspace leaves the profile and its data intact', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'hemera-profile-'))
    const workspace = mkdtempSync(join(tmpdir(), 'hemera-workspace-'))
    const script = join(directory, 'launch.ts')
    writeFileSync(script, LAUNCH)
    mkdirSync(join(workspace, 'sources'), { recursive: true })
    writeFileSync(join(workspace, 'sources', 'note.md'), 'a file of the user\n')

    try {
      const first = Bun.spawn(['bun', script, directory, workspace], {
        stdout: 'pipe',
        stderr: 'pipe',
      })
      const written = JSON.parse(
        (await new Response(first.stdout).text())
          .split('\n')
          .find((line) => line.startsWith('{')) ?? '{}',
      ) as { projectId: string; sessionId: string }
      await first.exited
      expect(written.projectId).toBeDefined()

      // The user cleans their working environment: the folder and everything under it goes.
      rmSync(workspace, { recursive: true, force: true })
      expect(existsSync(workspace)).toBe(false)

      // The profile lives outside it, so nothing of it was carried away.
      expect(existsSync(join(directory, DATABASE_FILE))).toBe(true)
      const reopened = openProfile({ directory, now: Date.now() })
      try {
        expect(listProjects(reopened.database).map((project) => project.name)).toEqual(['Hemera'])
        expect(listSessions(reopened.database, written.projectId)).toHaveLength(1)
        expect(
          readMessages(reopened.database, written.sessionId).map((entry) => entry.body),
        ).toEqual(['written while the workspace still existed'])
      } finally {
        reopened.database.close()
      }
    } finally {
      rmSync(directory, { recursive: true, force: true })
      rmSync(workspace, { recursive: true, force: true })
    }
  }, 60_000)
})
