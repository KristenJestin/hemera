/**
 * The Jev key in main: sealed by the system's protected storage before anything is stored, the
 * engine handed only the ciphertext to keep and the decrypted key to hold; restored at start; the
 * plain-text fallback of Linux refused; and the status the settings show, never the key.
 */

import type { JevKeyState } from '@hemera/ipc'
import { Effect } from 'effect'
import { describe, expect, test } from 'vite-plus/test'

import {
  type JevKeyEngine,
  type ProtectedStorage,
  jevKeyHandling,
  keyStatus,
  storageReady,
} from '../src/main/jev-key.ts'

const KEY = 'jev-test-key-0123456789'

/** A system's protected storage that seals by reversing and marking, and counts its uses. */
const storage = (
  options: { available?: boolean; backend?: string; decrypts?: boolean } = {},
): ProtectedStorage & { uses: number } => {
  const sealedOf = (text: string) => Buffer.from(`sealed:${[...text].toReversed().join('')}`)
  const kept = {
    uses: 0,
    isEncryptionAvailable: () => {
      kept.uses += 1
      return options.available ?? true
    },
    getSelectedStorageBackend: () => {
      kept.uses += 1
      return options.backend ?? 'gnome_libsecret'
    },
    encryptString: (text: string) => {
      kept.uses += 1
      return sealedOf(text)
    },
    decryptString: (sealed: Buffer) => {
      kept.uses += 1
      if (options.decrypts === false) throw new Error(`cannot decrypt ${sealed.toString()}`)
      return [...sealed.toString().slice('sealed:'.length)].toReversed().join('')
    },
  }
  return kept
}

/** What the engine's side keeps of the key. */
interface EngineSide {
  ciphertext: string | null
  key: string | null
  refused: boolean
  consent: boolean
  handed: string[]
}

/** The engine's side of the key, in memory: what it was handed, as it would keep it. */
const engine = (start: Partial<JevKeyState> & { ciphertext?: string | null } = {}) => {
  const kept: EngineSide = {
    ciphertext: start.ciphertext ?? null,
    key: null,
    refused: start.refused ?? false,
    consent: start.consent ?? true,
    handed: [],
  }
  const port: JevKeyEngine = {
    state: Effect.sync(() => ({
      stored: kept.ciphertext !== null,
      held: kept.key !== null,
      refused: kept.refused,
      consent: kept.consent,
    })),
    ciphertext: Effect.sync(() => kept.ciphertext),
    store: (ciphertext) =>
      Effect.sync(() => {
        kept.handed.push(ciphertext)
        kept.ciphertext = ciphertext
        kept.key = null
      }),
    restore: (key) =>
      Effect.sync(() => {
        kept.key = key
      }),
    remove: Effect.sync(() => {
      kept.ciphertext = null
      kept.key = null
    }),
  }
  return { kept, port }
}

const handling = (
  engineSide: ReturnType<typeof engine>,
  system: ProtectedStorage,
  platform: NodeJS.Platform = 'linux',
  missing: string | null = null,
) => {
  const lines: string[] = []
  return {
    lines,
    key: jevKeyHandling({
      engine: engineSide.port,
      storage: system,
      platform,
      missing: () => missing,
      log: (line) => lines.push(line),
    }),
  }
}

describe('Protected storage', () => {
  test('Linux’s basic_text backend protects nothing and counts as unavailable', () => {
    expect(storageReady(storage({ backend: 'basic_text' }), 'linux')).toBe(false)
    expect(storageReady(storage({ backend: 'gnome_libsecret' }), 'linux')).toBe(true)
    expect(storageReady(storage({ backend: 'kwallet6' }), 'linux')).toBe(true)
    expect(storageReady(storage({ available: false }), 'linux')).toBe(false)
  })

  test('on Windows and macOS the backend is not asked', () => {
    const system = storage({ backend: 'basic_text' })
    expect(storageReady(system, 'win32')).toBe(true)
    expect(storageReady(system, 'darwin')).toBe(true)
    expect(storageReady(storage({ available: false }), 'win32')).toBe(false)
  })
})

describe('The status the settings show', () => {
  const state = (more: Partial<JevKeyState>): JevKeyState => ({
    stored: false,
    held: false,
    refused: false,
    consent: false,
    ...more,
  })

  test('missing, saved, invalid, storage-unavailable', () => {
    expect(keyStatus(true, state({}))).toBe('missing')
    expect(keyStatus(true, state({ stored: true, held: true }))).toBe('saved')
    expect(keyStatus(true, state({ stored: true, held: false }))).toBe('invalid')
    expect(keyStatus(true, state({ stored: true, held: true, refused: true }))).toBe('invalid')
    expect(keyStatus(false, state({ stored: true, held: true }))).toBe('storage-unavailable')
  })
})

describe('Saving a key', () => {
  test('only the ciphertext reaches the engine’s storage; the key is then held in memory', async () => {
    const side = engine()
    const { key, lines } = handling(side, storage())
    const status = await Effect.runPromise(key.save(KEY))
    expect(side.kept.handed).toHaveLength(1)
    expect(side.kept.handed[0]).not.toContain(KEY)
    expect(side.kept.ciphertext).not.toBe(KEY)
    expect(side.kept.key).toBe(KEY)
    expect(status).toEqual({ key: 'saved', consent: true, judge: 'Jev', missing: null })
    expect(lines.join('\n')).not.toContain(KEY)
  })

  test('without protected storage nothing is stored, and the status says what is missing', async () => {
    const side = engine()
    const { key } = handling(
      side,
      storage({ backend: 'basic_text' }),
      'linux',
      'No Secret Service is running.',
    )
    const status = await Effect.runPromise(key.save(KEY))
    expect(side.kept.handed).toEqual([])
    expect(side.kept.key).toBeNull()
    expect(status).toEqual({
      key: 'storage-unavailable',
      consent: true,
      judge: 'Hemera asks',
      missing: 'No Secret Service is running.',
    })
  })

  test('an empty key is not stored', async () => {
    const side = engine()
    const { key } = handling(side, storage())
    const status = await Effect.runPromise(key.save('   '))
    expect(side.kept.handed).toEqual([])
    expect(status.key).toBe('missing')
  })

  test('without consent the key is saved, and nobody judges', async () => {
    const side = engine({ consent: false })
    const { key } = handling(side, storage())
    expect(await Effect.runPromise(key.save(KEY))).toMatchObject({
      key: 'saved',
      consent: false,
      judge: 'Hemera asks',
    })
  })

  test('removing it leaves nothing stored nor held', async () => {
    const side = engine()
    const { key } = handling(side, storage())
    await Effect.runPromise(key.save(KEY))
    const status = await Effect.runPromise(key.remove)
    expect(side.kept).toMatchObject({ ciphertext: null, key: null })
    expect(status.key).toBe('missing')
  })
})

describe('Restoring the key at start', () => {
  test('the ciphertext is decrypted and the key handed to the engine', async () => {
    const system = storage()
    const ciphertext = system.encryptString(KEY).toString('base64')
    const side = engine({ ciphertext })
    const { key } = handling(side, system)
    await Effect.runPromise(key.restore)
    expect(side.kept.key).toBe(KEY)
    expect(await Effect.runPromise(key.status)).toMatchObject({ key: 'saved' })
  })

  test('with no key stored, the system’s storage is not even asked', async () => {
    const system = storage()
    const { key } = handling(engine(), system)
    await Effect.runPromise(key.restore)
    expect(system.uses).toBe(0)
  })

  test('a ciphertext this system cannot decrypt stays unusable: invalid, said once, never the key', async () => {
    const system = storage({ decrypts: false })
    const side = engine({ ciphertext: Buffer.from('sealed:elsewhere').toString('base64') })
    const { key, lines } = handling(side, system)
    await Effect.runPromise(key.restore)
    await Effect.runPromise(key.restore)
    expect(side.kept.key).toBeNull()
    expect(await Effect.runPromise(key.status)).toMatchObject({ key: 'invalid' })
    expect(lines.filter((line) => line.includes('could not be decrypted'))).toHaveLength(1)
    expect(lines.join('\n')).not.toContain('elsewhere')
  })

  test('a key Jev refused is invalid', async () => {
    const system = storage()
    const side = engine({
      ciphertext: system.encryptString(KEY).toString('base64'),
      refused: true,
    })
    const { key } = handling(side, system)
    await Effect.runPromise(key.restore)
    expect(await Effect.runPromise(key.status)).toMatchObject({
      key: 'invalid',
      judge: 'Hemera asks',
    })
  })
})
