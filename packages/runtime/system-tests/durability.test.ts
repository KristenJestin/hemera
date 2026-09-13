import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { listSessions, openProfile, readMessages } from '../src/index.ts'

const runtime = resolve(import.meta.dir, '..')
const surface = join(runtime, 'src', 'index.ts').replaceAll('\\', '/')

/**
 * A real process that records messages and is then killed without closing anything.
 *
 * Durability after a brutal stop cannot be shown by closing a database politely: the process
 * has to die while holding it.
 */
const WRITER = `
import { createProject, createSession, openProfile, recordMessage } from '${surface}'

const directory = process.argv[2]
const profile = openProfile({ directory, now: Date.now() })
let count = 0
const context = { database: profile.database, ids: { next: () => \`id-\${(count += 1)}\` }, now: Date.now() }

const { project } = createProject(context, { name: 'Hemera', path: directory })
const session = createSession(context, project.id)
for (const body of ['one', 'two', 'three']) recordMessage(context, session.id, body)

console.log(JSON.stringify({ projectId: project.id, sessionId: session.id }))
// Hold the profile open, without ever closing it, until the test kills the process.
setTimeout(() => process.exit(0), 30_000)
`

interface WriterReport {
  projectId: string
  sessionId: string
}

async function readReport(child: { stdout: ReadableStream<Uint8Array> }): Promise<WriterReport> {
  const reader = child.stdout.getReader()
  const decoder = new TextDecoder()
  let buffered = ''
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    // oxlint-disable-next-line no-await-in-loop
    const { value, done } = await reader.read()
    if (done) break
    buffered += decoder.decode(value, { stream: true })
    const line = buffered.split('\n').find((candidate) => candidate.trim().startsWith('{'))
    if (line !== undefined) return JSON.parse(line) as WriterReport
  }
  throw new Error('the writer never reported what it wrote')
}

describe('Arrêt brutal', () => {
  test('messages committed before a process is killed are found again at the next launch', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'hemera-durability-'))
    const script = join(directory, 'writer.ts')
    writeFileSync(script, WRITER)

    const writer = Bun.spawn(['bun', script, directory], { stdout: 'pipe', stderr: 'pipe' })
    try {
      const written = await readReport(writer)

      // Killed while holding the profile: nothing was closed, nothing was flushed by hand.
      writer.kill()
      await writer.exited

      const reopened = openProfile({ directory, now: Date.now() })
      try {
        expect(listSessions(reopened.database, written.projectId)).toHaveLength(1)
        expect(
          readMessages(reopened.database, written.sessionId).map((entry) => entry.body),
        ).toEqual(['one', 'two', 'three'])
      } finally {
        reopened.database.close()
      }
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  }, 60_000)
})

describe('Deux Sessions retrouvées', () => {
  test('two sessions and their messages survive a clean restart', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'hemera-durability-'))
    const script = join(directory, 'writer.ts')
    writeFileSync(script, WRITER)

    const writer = Bun.spawn(['bun', script, directory], { stdout: 'pipe', stderr: 'pipe' })
    const written = await readReport(writer)
    writer.kill()
    await writer.exited

    try {
      const second = openProfile({ directory, now: Date.now() })
      let count = 100
      const context = {
        database: second.database,
        ids: { next: () => `id-${(count += 1)}` },
        now: Date.now(),
      }
      const { createSession, recordMessage } = await import('../src/index.ts')
      const other = createSession(context, written.projectId)
      recordMessage(context, other.id, 'a second thread')
      second.database.close()

      const third = openProfile({ directory, now: Date.now() })
      try {
        expect(listSessions(third.database, written.projectId)).toHaveLength(2)
        expect(readMessages(third.database, written.sessionId)).toHaveLength(3)
        expect(readMessages(third.database, other.id).map((entry) => entry.body)).toEqual([
          'a second thread',
        ])
      } finally {
        third.database.close()
      }
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  }, 60_000)
})
