import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { currentLockOwner, lockPathOf } from '../src/index.ts'

const runtime = resolve(import.meta.dir, '..')

/**
 * A real process that takes the lock of a profile, reports what happened, and waits.
 *
 * The lock has to hold across processes, not merely across calls, so the second instance is
 * a second process.
 */
const INSTANCE = `
import { acquireInstanceLock } from '${join(runtime, 'src', 'index.ts').replaceAll('\\', '/')}'

const directory = process.argv[2]
const outcome = acquireInstanceLock({
  directory,
  pid: process.pid,
  activationToken: \`window-\${process.pid}\`,
  now: Date.now(),
})
console.log(JSON.stringify({ kind: outcome.kind, pid: process.pid, owner: outcome.owner.pid }))
if (outcome.kind === 'busy') process.exit(0)
// Hold the lock until the test stops the process.
setTimeout(() => process.exit(0), 30_000)
`

interface InstanceReport {
  kind: string
  pid: number
  owner: number
}

async function readReport(child: ReturnType<typeof Bun.spawn>): Promise<InstanceReport> {
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
    if (line !== undefined) return JSON.parse(line) as InstanceReport
  }
  throw new Error('the instance never reported what it did')
}

describe('Deuxième lancement, deux processus réels', () => {
  test('the second process is refused and names the one holding the profile', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'hemera-lock-system-'))
    const script = join(directory, 'instance.ts')
    writeFileSync(script, INSTANCE)
    const holder = Bun.spawn(['bun', script, directory], { stdout: 'pipe', stderr: 'pipe' })
    try {
      const first = await readReport(holder)
      expect(first.kind).toBe('acquired')
      expect(currentLockOwner(directory)?.pid).toBe(first.pid)

      const second = Bun.spawn(['bun', script, directory], { stdout: 'pipe', stderr: 'pipe' })
      try {
        const refused = await readReport(second)
        expect(refused.kind).toBe('busy')
        expect(refused.owner).toBe(first.pid)
        expect(refused.pid).not.toBe(first.pid)
      } finally {
        second.kill()
        await second.exited
      }
    } finally {
      holder.kill()
      await holder.exited
      rmSync(directory, { recursive: true, force: true })
    }
  }, 60_000)

  test('the lock of a process that is gone is reclaimed by the next one', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'hemera-lock-system-'))
    const script = join(directory, 'instance.ts')
    writeFileSync(script, INSTANCE)

    const holder = Bun.spawn(['bun', script, directory], { stdout: 'pipe', stderr: 'pipe' })
    const first = await readReport(holder)
    holder.kill()
    await holder.exited

    try {
      // The lock file is still there, naming a process that no longer exists.
      expect(currentLockOwner(directory)).toBeNull()

      const next = Bun.spawn(['bun', script, directory], { stdout: 'pipe', stderr: 'pipe' })
      try {
        const reclaimed = await readReport(next)
        expect(reclaimed.kind).toBe('reclaimed')
        expect(reclaimed.pid).not.toBe(first.pid)
        expect(currentLockOwner(directory)?.pid).toBe(reclaimed.pid)
      } finally {
        next.kill()
        await next.exited
      }
    } finally {
      rmSync(lockPathOf(directory), { force: true })
      rmSync(directory, { recursive: true, force: true })
    }
  }, 60_000)
})
