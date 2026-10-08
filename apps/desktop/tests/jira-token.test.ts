/**
 * A Jira token in main (#96): sealed by the system's protected storage before anything is stored,
 * the engine handed the ciphertext to keep and the token to check once; a token Jira refuses not
 * stored; Linux's plain-text fallback, or no protected storage at all, storing nothing; opened for
 * the engine at call time; and the status the settings show, never the token.
 */

import type { JiraTokenState } from '@hemera/ipc'
import { Effect } from 'effect'
import { describe, expect, test } from 'vite-plus/test'

import type { ProtectedStorage } from '../src/main/jev-key.ts'
import { type JiraTokenEngine, jiraTokenHandling } from '../src/main/jira-token.ts'

const TOKEN = 'jira-test-token-4471c0de'
const PROVIDER = 'provider-1'

/** A system's protected storage that seals by reversing and marking. */
const storage = (
  options: { available?: boolean; backend?: string; decrypts?: boolean } = {},
): ProtectedStorage => ({
  isEncryptionAvailable: () => options.available ?? true,
  getSelectedStorageBackend: () => options.backend ?? 'gnome_libsecret',
  encryptString: (text) => Buffer.from(`sealed:${[...text].toReversed().join('')}`),
  decryptString: (sealed) => {
    if (options.decrypts === false) throw new Error('cannot decrypt')
    return [...sealed.toString().slice('sealed:'.length)].toReversed().join('')
  },
})

/** What the engine's side keeps, and what it was handed. */
interface EngineSide {
  state: JiraTokenState
  handed: Array<{ readonly ciphertext: string; readonly token: string }>
}

/** The engine's side, in memory: what it was handed, and what Jira says of a token. */
const engine = (jira: { accepts: boolean } = { accepts: true }) => {
  const kept: EngineSide = { state: { ciphertext: null, refused: false }, handed: [] }
  const port: JiraTokenEngine = {
    save: (_, ciphertext, token) =>
      Effect.sync(() => {
        kept.handed.push({ ciphertext, token })
        if (!jira.accepts) return 'invalid'
        kept.state = { ciphertext, refused: false }
        return 'saved'
      }),
    state: () => Effect.sync(() => kept.state),
    remove: () =>
      Effect.sync(() => {
        kept.state = { ciphertext: null, refused: false }
      }),
  }
  return { kept, port }
}

const handling = (
  side: ReturnType<typeof engine>,
  system: ProtectedStorage = storage(),
  platform: NodeJS.Platform = 'linux',
) => jiraTokenHandling({ engine: side.port, storage: system, platform, log: () => undefined })

describe('Saving a Jira token', () => {
  test('the engine is handed only the ciphertext to keep, and the answer never holds the token', async () => {
    const side = engine()
    const answer = await Effect.runPromise(handling(side).save(PROVIDER, `  ${TOKEN} `))
    expect(answer).toBe('saved')
    expect(JSON.stringify(answer)).not.toContain(TOKEN)
    const [handed] = side.kept.handed
    expect(handed?.token).toBe(TOKEN)
    expect(side.kept.state.ciphertext).toBe(handed?.ciphertext)
    expect(Buffer.from(side.kept.state.ciphertext ?? '', 'base64').toString()).not.toContain(TOKEN)
  })

  test('a token with a control character in it: invalid, never sealed nor handed', async () => {
    const side = engine()
    const answers = await Effect.runPromise(
      Effect.forEach([`${TOKEN}\nX-Admin: 1`, `jira\u0000token`, `jira\u007ftoken`], (given) =>
        handling(side).save(PROVIDER, given),
      ),
    )
    expect(answers).toEqual(['invalid', 'invalid', 'invalid'])
    expect(side.kept.handed).toEqual([])
    expect(side.kept.state.ciphertext).toBeNull()
  })

  test('a token Jira refuses: invalid, and nothing is stored', async () => {
    const side = engine({ accepts: false })
    expect(await Effect.runPromise(handling(side).save(PROVIDER, TOKEN))).toBe('invalid')
    expect(side.kept.state.ciphertext).toBeNull()
  })

  test('Linux’s basic_text backend: nothing stored, storage-unavailable', async () => {
    const side = engine()
    const answer = await Effect.runPromise(
      handling(side, storage({ backend: 'basic_text' })).save(PROVIDER, TOKEN),
    )
    expect(answer).toBe('storage-unavailable')
    expect(side.kept.handed).toEqual([])
  })

  test('no protected storage at all: nothing stored, storage-unavailable', async () => {
    const side = engine()
    const answer = await Effect.runPromise(
      handling(side, storage({ available: false }), 'win32').save(PROVIDER, TOKEN),
    )
    expect(answer).toBe('storage-unavailable')
    expect(side.kept.handed).toEqual([])
  })

  test('basic_text is a Linux name only: elsewhere the system’s storage is used', async () => {
    const side = engine()
    const answer = await Effect.runPromise(
      handling(side, storage({ backend: 'basic_text' }), 'win32').save(PROVIDER, TOKEN),
    )
    expect(answer).toBe('saved')
  })
})

describe('Where a token stands, and opening it for the engine', () => {
  test('missing, then saved, then missing once removed', async () => {
    const side = engine()
    const tokens = handling(side)
    expect(await Effect.runPromise(tokens.status(PROVIDER))).toBe('missing')
    await Effect.runPromise(tokens.save(PROVIDER, TOKEN))
    expect(await Effect.runPromise(tokens.status(PROVIDER))).toBe('saved')
    expect(await Effect.runPromise(tokens.remove(PROVIDER))).toBe('missing')
  })

  test('a token Jira refused at call time, or one this system cannot decrypt, is invalid', async () => {
    const refused = engine()
    await Effect.runPromise(handling(refused).save(PROVIDER, TOKEN))
    refused.kept.state = { ...refused.kept.state, refused: true }
    expect(await Effect.runPromise(handling(refused).status(PROVIDER))).toBe('invalid')

    const elsewhere = engine()
    await Effect.runPromise(handling(elsewhere).save(PROVIDER, TOKEN))
    expect(
      await Effect.runPromise(handling(elsewhere, storage({ decrypts: false })).status(PROVIDER)),
    ).toBe('invalid')
  })

  test('the engine’s ciphertext is opened at call time; without protected storage it is not', async () => {
    const side = engine()
    const tokens = handling(side)
    await Effect.runPromise(tokens.save(PROVIDER, TOKEN))
    const sealed = side.kept.state.ciphertext ?? ''
    expect(await Effect.runPromise(tokens.open(sealed))).toBe(TOKEN)
    const refused = await Effect.runPromise(
      Effect.flip(handling(side, storage({ backend: 'basic_text' })).open(sealed)),
    )
    expect(refused.message).toContain('no protected storage')
    expect(refused.message).not.toContain(TOKEN)
  })
})
