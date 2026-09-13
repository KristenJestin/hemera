import { describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  acquireInstanceLock,
  currentLockOwner,
  lockPathOf,
  openProfile,
  processExists,
} from '../src/index.ts'

const NOW = 1_789_000_000_000

function profileDirectory(): string {
  return mkdtempSync(join(tmpdir(), 'hemera-lock-'))
}

function withDirectory(body: (directory: string) => void): void {
  const directory = profileDirectory()
  try {
    body(directory)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

const ALIVE = () => true
const GONE = () => false

describe('Deuxième lancement', () => {
  test('the first instance takes the lock and opens the database', () => {
    withDirectory((directory) => {
      const outcome = acquireInstanceLock({
        directory,
        pid: 101,
        activationToken: 'window-101',
        now: NOW,
        isProcessAlive: ALIVE,
      })
      expect(outcome.kind).toBe('acquired')
      expect(existsSync(lockPathOf(directory))).toBe(true)

      const profile = openProfile({ directory, now: NOW })
      profile.database.close()
    })
  })

  test('a second instance does not open the database and names the running one', () => {
    withDirectory((directory) => {
      acquireInstanceLock({
        directory,
        pid: 101,
        activationToken: 'window-101',
        now: NOW,
        isProcessAlive: ALIVE,
      })

      const second = acquireInstanceLock({
        directory,
        pid: 202,
        activationToken: 'window-202',
        now: NOW + 1,
        isProcessAlive: ALIVE,
      })
      expect(second.kind).toBe('busy')
      if (second.kind !== 'busy') throw new Error('expected the lock to be busy')
      // The activation token is how the second instance brings the first window forward.
      expect(second.owner.pid).toBe(101)
      expect(second.owner.activationToken).toBe('window-101')
    })
  })

  test('the owner releases its own lock and never another', () => {
    withDirectory((directory) => {
      const first = acquireInstanceLock({
        directory,
        pid: 101,
        activationToken: 'window-101',
        now: NOW,
        isProcessAlive: ALIVE,
      })
      if (first.kind === 'busy') throw new Error('expected the lock to be free')

      const intruder = acquireInstanceLock({
        directory,
        pid: 202,
        activationToken: 'window-202',
        now: NOW,
        isProcessAlive: GONE,
      })
      if (intruder.kind === 'busy') throw new Error('expected the lock to be reclaimed')

      // The first instance is no longer the owner: releasing does not clear someone else's lock.
      first.release()
      expect(currentLockOwner(directory, ALIVE)?.pid).toBe(202)
    })
  })
})

describe('Verrou résiduel après arrêt brutal', () => {
  test('a lock left by a process that no longer exists is reclaimed', () => {
    withDirectory((directory) => {
      acquireInstanceLock({
        directory,
        pid: 404,
        activationToken: 'window-404',
        now: NOW,
        isProcessAlive: ALIVE,
      })

      const outcome = acquireInstanceLock({
        directory,
        pid: 505,
        activationToken: 'window-505',
        now: NOW + 1,
        isProcessAlive: GONE,
      })
      expect(outcome.kind).toBe('reclaimed')
      if (outcome.kind !== 'reclaimed') throw new Error('expected the lock to be reclaimed')
      expect(outcome.previous.pid).toBe(404)
      expect(outcome.owner.pid).toBe(505)
      // Nobody was asked to delete a file by hand.
      expect(existsSync(lockPathOf(directory))).toBe(true)
    })
  })

  test('an unreadable lock holds nothing', () => {
    withDirectory((directory) => {
      writeFileSync(lockPathOf(directory), 'not json at all')
      const outcome = acquireInstanceLock({
        directory,
        pid: 606,
        activationToken: 'window-606',
        now: NOW,
        isProcessAlive: ALIVE,
      })
      // A lock naming no owner blocks nobody, and needs no manual deletion either.
      expect(outcome.kind).toBe('acquired')
      expect(currentLockOwner(directory, ALIVE)?.pid).toBe(606)
    })
  })

  test('liveness of a real process is decided without touching it', () => {
    expect(processExists(process.pid)).toBe(true)
    // A pid no process can have on any supported system.
    expect(processExists(2_147_483_646)).toBe(false)
  })
})

describe('Profils distincts', () => {
  test('two profiles are two locks and never exclude each other', () => {
    withDirectory((first) => {
      withDirectory((second) => {
        const one = acquireInstanceLock({
          directory: first,
          pid: 101,
          activationToken: 'window-101',
          now: NOW,
          isProcessAlive: ALIVE,
        })
        const two = acquireInstanceLock({
          directory: second,
          pid: 202,
          activationToken: 'window-202',
          now: NOW,
          isProcessAlive: ALIVE,
        })
        expect(one.kind).toBe('acquired')
        expect(two.kind).toBe('acquired')
        expect(currentLockOwner(first, ALIVE)?.pid).toBe(101)
        expect(currentLockOwner(second, ALIVE)?.pid).toBe(202)
      })
    })
  })
})
