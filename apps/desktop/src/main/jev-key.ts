/**
 * The Jev key in main, the one process that ever holds it in clear on its way in.
 *
 * Saving: the window sends the key; main seals it with the system's protected storage (Electron's
 * `safeStorage`) and hands the engine only the ciphertext to store, then the key decrypted from
 * that very ciphertext to hold in memory. Restoring: at start, before the window loads, main reads
 * the ciphertext back, decrypts it, and hands the key over. Never in clear on disk, never in an
 * environment variable, never in a log, never to the window. Linux's `basic_text` backend protects
 * nothing: it counts as no protected storage, and nothing is stored.
 *
 * The rules take the storage and the engine as ports, so they are tested without Electron.
 */

import {
  type HemeraAutoStatus,
  type JevKeyState,
  type JevKeyStatus,
  type StorageFailed,
  type EngineGone,
} from '@hemera/ipc'
import { whoJudges } from '@hemera/core/domain'
import { Effect } from 'effect'

import type { Log } from './diagnostic.ts'

/** The part of Electron's `safeStorage` the key needs. */
export interface ProtectedStorage {
  readonly isEncryptionAvailable: () => boolean
  /** Linux only: which keyring the system's storage stands on. */
  readonly getSelectedStorageBackend: () => string
  readonly encryptString: (text: string) => Buffer
  readonly decryptString: (sealed: Buffer) => string
}

/** Whether the system can protect the key: Linux's plain-text fallback cannot. */
export function storageReady(storage: ProtectedStorage, platform: NodeJS.Platform): boolean {
  return (
    storage.isEncryptionAvailable() &&
    (platform !== 'linux' || storage.getSelectedStorageBackend() !== 'basic_text')
  )
}

/** What the settings show of the key: where it stands, never the key. */
export function keyStatus(ready: boolean, state: JevKeyState): JevKeyStatus {
  if (!ready) return 'storage-unavailable'
  if (state.refused || (state.stored && !state.held)) return 'invalid'
  return state.held ? 'saved' : 'missing'
}

type Refused = StorageFailed | EngineGone

/** The engine's side of the key, over its link. */
export interface JevKeyEngine {
  readonly state: Effect.Effect<JevKeyState, Refused>
  readonly ciphertext: Effect.Effect<string | null, Refused>
  readonly store: (ciphertext: string) => Effect.Effect<void, Refused>
  readonly restore: (key: string) => Effect.Effect<void, Refused>
  readonly remove: Effect.Effect<void, Refused>
}

export interface JevKeySettings {
  readonly engine: JevKeyEngine
  readonly storage: ProtectedStorage
  readonly platform: NodeJS.Platform
  /** What the system lacks to protect a key, said once in the settings; null when nothing. */
  readonly missing: () => string | null
  readonly log: Log
}

/** What main does with the key: restore it at start, show where it stands, save, remove. */
export const jevKeyHandling = (settings: JevKeySettings) => {
  const { engine, storage, platform, log } = settings
  let saidUndecrypted = false
  const ready = () => storageReady(storage, platform)

  const status: Effect.Effect<HemeraAutoStatus, Refused> = Effect.gen(function* () {
    const state = yield* engine.state
    const isReady = ready()
    const key = keyStatus(isReady, state)
    return {
      key,
      consent: state.consent,
      judge: whoJudges(key === 'saved' && state.consent),
      missing: isReady ? null : settings.missing(),
    }
  })

  /** The key sealed in `ciphertext`, handed to the engine; false when this system cannot read it. */
  const handOver = (ciphertext: string) =>
    Effect.gen(function* () {
      let key: string
      try {
        key = storage.decryptString(Buffer.from(ciphertext, 'base64'))
      } catch {
        // A key sealed elsewhere, or by a keyring since replaced: unusable, said once, never shown.
        if (!saidUndecrypted) {
          saidUndecrypted = true
          log('hemera auto: the saved Jev key could not be decrypted on this system')
        }
        return false
      }
      yield* engine.restore(key)
      return true
    })

  return {
    status,
    /** At start, before the window loads: the saved key, if any, handed to the engine. */
    restore: Effect.gen(function* () {
      const ciphertext = yield* engine.ciphertext
      // No key saved: the system's storage is not even asked (no keyring is woken for nothing).
      if (ciphertext === null) return
      if (!ready()) {
        log('hemera auto: a Jev key is saved, but the system offers no protected storage now')
        return
      }
      yield* handOver(ciphertext)
    }).pipe(
      Effect.catch((failure) =>
        Effect.sync(() => log(`hemera auto: the Jev key was not restored: ${failure.message}`)),
      ),
    ),
    save: (key: string) =>
      Effect.gen(function* () {
        const given = key.trim()
        if (given === '' || !ready()) return yield* status
        let sealed: string
        try {
          sealed = storage.encryptString(given).toString('base64')
        } catch {
          log('hemera auto: the system could not seal the Jev key; nothing was stored')
          return yield* status
        }
        yield* engine.store(sealed)
        saidUndecrypted = false
        yield* handOver(sealed)
        return yield* status
      }),
    remove: Effect.andThen(engine.remove, status),
  }
}
