/**
 * A Jira provider's API token in main (#96), the one process that ever holds it in clear on its
 * way in, sealed the way the Jev key is (`jev-key.ts`): Electron's `safeStorage`, Linux's
 * `basic_text` backend refused as no protected storage at all.
 *
 * - Saving: the window sends the token once; main seals it and hands the engine the ciphertext to
 *   store and the token to check against the site once. Nothing is stored without protected
 *   storage, and nothing is stored when Jira refuses the token. The window gets a status back,
 *   never the token.
 * - Opening: at call time the engine hands main a ciphertext, and main answers the token.
 * - The status: none saved, saved, `invalid` (Jira refused it, or this system cannot decrypt it),
 *   or no protected storage.
 *
 * The rules take the storage and the engine as ports, so they are tested without Electron.
 */

import {
  type EngineGone,
  type InvalidProviderConfig,
  type JiraTokenCheck,
  type JiraTokenState,
  type JiraTokenStatus,
  type StorageFailed,
  TokenUnreadable,
  type UnknownTicketProvider,
} from '@hemera/ipc'
import { Effect, Result } from 'effect'

import type { Log } from './diagnostic.ts'
import { type ProtectedStorage, storageReady } from './jev-key.ts'

type Refused = StorageFailed | EngineGone | UnknownTicketProvider | InvalidProviderConfig

/** The engine's side of a Jira token, over its link. */
export interface JiraTokenEngine {
  readonly save: (
    providerId: string,
    ciphertext: string,
    token: string,
  ) => Effect.Effect<JiraTokenCheck, Refused>
  readonly state: (providerId: string) => Effect.Effect<JiraTokenState, Refused>
  readonly remove: (providerId: string) => Effect.Effect<void, Refused>
}

export interface JiraTokenSettings {
  readonly engine: JiraTokenEngine
  readonly storage: ProtectedStorage
  readonly platform: NodeJS.Platform
  readonly log: Log
}

/** The token a ciphertext seals, or why this system cannot open it now. */
export const tokenOpener =
  (storage: ProtectedStorage, platform: NodeJS.Platform) =>
  (ciphertext: string): Effect.Effect<string, TokenUnreadable> =>
    Effect.suspend(() => {
      if (!storageReady(storage, platform)) {
        return Effect.fail(
          new TokenUnreadable({ reason: 'the system offers no protected storage now' }),
        )
      }
      try {
        return Effect.succeed(storage.decryptString(Buffer.from(ciphertext, 'base64')))
      } catch {
        return Effect.fail(
          new TokenUnreadable({ reason: 'it was sealed by another system or another keyring' }),
        )
      }
    })

/** What main does with Jira tokens: open one for the engine, show where one stands, save, remove. */
export const jiraTokenHandling = (settings: JiraTokenSettings) => {
  const { engine, storage, platform, log } = settings
  const ready = () => storageReady(storage, platform)

  const open = tokenOpener(storage, platform)

  const status = (providerId: string): Effect.Effect<JiraTokenStatus, Refused> =>
    Effect.gen(function* () {
      if (!ready()) return 'storage-unavailable'
      const state = yield* engine.state(providerId)
      if (state.ciphertext === null) return 'missing'
      if (state.refused) return 'invalid'
      const opened = yield* Effect.result(open(state.ciphertext))
      return Result.isSuccess(opened) ? 'saved' : 'invalid'
    })

  return {
    open,
    status,
    save: (providerId: string, token: string) =>
      Effect.gen(function* () {
        const given = token.trim()
        if (given === '') return yield* status(providerId)
        // A control character is never part of a token, and in a header it could split it.
        if (/\p{Cc}/u.test(given)) return 'invalid' satisfies JiraTokenStatus
        if (!ready()) return 'storage-unavailable' satisfies JiraTokenStatus
        let sealed: string
        try {
          sealed = storage.encryptString(given).toString('base64')
        } catch {
          log('jira: the system could not seal a Jira token; nothing was stored')
          return 'storage-unavailable' satisfies JiraTokenStatus
        }
        const checked = yield* engine.save(providerId, sealed, given)
        if (checked === 'invalid') return 'invalid' satisfies JiraTokenStatus
        return yield* status(providerId)
      }),
    remove: (providerId: string) => Effect.andThen(engine.remove(providerId), status(providerId)),
  }
}
