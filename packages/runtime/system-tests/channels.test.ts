import { describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { LOCK_FILE, listProjects, openProfile } from '../src/index.ts'

const runtime = resolve(import.meta.dir, '..')
const surface = join(runtime, 'src', 'index.ts').replaceAll('\\', '/')

/**
 * A real instance of a channel: it resolves its own profile, owns it and holds it open until
 * the test kills it. Two of them run at the same time, as an installed Hemera and a
 * development one do on the same machine.
 */
const INSTANCE = `
import {
  acquireInstanceLock,
  createProject,
  openProfile,
  resolveChannel,
  resolveProfileLocation,
} from '${surface}'

const channel = resolveChannel({ packaged: 'prod', env: process.env, development: false })
const { directory } = resolveProfileLocation({
  platform: 'win32',
  env: process.env,
  channel,
  home: process.env.HOME ?? 'C:\\\\Users\\\\nobody',
})

const lock = acquireInstanceLock({
  directory,
  pid: process.pid,
  activationToken: \`hemera-\${channel}\`,
  now: Date.now(),
})
if (lock.kind === 'busy') {
  console.log(JSON.stringify({ channel, directory, busy: true }))
  process.exit(1)
}

const profile = openProfile({ directory, now: Date.now() })
let count = 0
createProject(
  { database: profile.database, ids: { next: () => \`\${channel}-\${(count += 1)}\` }, now: Date.now() },
  { name: channel, path: directory },
)

console.log(JSON.stringify({ channel, directory, busy: false }))
setTimeout(() => process.exit(0), 30_000)
`

interface Report {
  channel: string
  directory: string
  busy: boolean
}

async function readReport(child: { stdout: ReadableStream<Uint8Array> }): Promise<Report> {
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
    if (line !== undefined) return JSON.parse(line) as Report
  }
  throw new Error('the instance never reported which profile it opened')
}

describe('Deux canaux en parallèle', () => {
  test('an installed and a development instance run at once without seeing each other', async () => {
    const local = mkdtempSync(join(tmpdir(), 'hemera-channels-'))
    const script = join(local, 'instance.ts')
    await Bun.write(script, INSTANCE)

    const spawn = (channel: string) =>
      Bun.spawn(['bun', script], {
        env: { ...process.env, LOCALAPPDATA: local, HEMERA_CHANNEL: channel },
        stdout: 'pipe',
        stderr: 'pipe',
      })

    const installed = spawn('prod')
    const development = spawn('dev')
    try {
      const [first, second] = await Promise.all([readReport(installed), readReport(development)])

      expect(first.busy).toBe(false)
      expect(second.busy).toBe(false)
      expect(first.directory).not.toBe(second.directory)
      expect(first.directory).toBe(join(local, 'Hemera'))
      expect(second.directory).toBe(join(local, 'Hemera-dev'))

      // Both own their profile at the same time: neither lock is waiting on the other.
      expect(existsSync(join(first.directory, LOCK_FILE))).toBe(true)
      expect(existsSync(join(second.directory, LOCK_FILE))).toBe(true)
    } finally {
      installed.kill()
      development.kill()
      await Promise.all([installed.exited, development.exited])
    }

    // Each channel kept only what it wrote itself.
    for (const [channel, folder] of [
      ['prod', join(local, 'Hemera')],
      ['dev', join(local, 'Hemera-dev')],
    ]) {
      const profile = openProfile({ directory: folder!, now: Date.now() })
      try {
        expect(listProjects(profile.database).map((project) => project.name)).toEqual([channel!])
      } finally {
        profile.database.close()
      }
    }

    rmSync(local, { recursive: true, force: true })
  }, 60_000)
})
