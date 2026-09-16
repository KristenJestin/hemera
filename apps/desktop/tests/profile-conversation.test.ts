/**
 * What the main process does when the database answers, refuses, or says nothing (D3-02).
 *
 * Each suite is named after the scenario of `specs/profile-storage/spec.md` it covers. The
 * port is stood in for, because what is under test is the waiting itself: a port that answers,
 * one that refuses, and one that never says anything at all.
 */

import { describe, expect, test } from 'vite-plus/test'
import { Duration, Effect } from 'effect'

import type { ProfileAnswer, ProfileRequest } from '#profile/request.ts'
import {
  ProfileGone,
  ProfileRefused,
  ProfileTimeout,
  type ProfilePort,
  profileConversation,
} from '#main/profile-conversation.ts'

/** A port that answers each message the way the test says, or never answers at all. */
function port(reply: ((request: ProfileRequest) => ProfileAnswer) | null): ProfilePort {
  const listeners: ((event: { data: ProfileAnswer }) => void)[] = []
  return {
    postMessage: (request) => {
      if (reply === null) return
      const answer = reply(request)
      queueMicrotask(() => {
        for (const listener of listeners) listener({ data: answer })
      })
    },
    on: (_event, listener) => listeners.push(listener),
    start: () => undefined,
  }
}

const alive = () => true

describe('Un message conforme est traité', () => {
  test('the value the other process answered is the value the main process gets', async () => {
    const answering = port((request) => ({
      id: request.id,
      ok: true,
      value: { theme: 'dark', sidebar: { collapsed: true, width: null } },
    }))
    const conversation = profileConversation(answering, alive)

    expect(await Effect.runPromise(conversation.ask('preferences.read', {}))).toEqual({
      theme: 'dark',
      sidebar: { collapsed: true, width: null },
    })
  })

  test('two messages in flight are told apart by the identifier they came in on', async () => {
    const answering = port((request) => ({
      id: request.id,
      ok: true,
      value: {
        theme: request.id === 0 ? 'dark' : 'light',
        sidebar: { collapsed: false, width: null },
      },
    }))
    const conversation = profileConversation(answering, alive)

    const [first, second] = await Effect.runPromise(
      Effect.all([
        conversation.ask('preferences.read', {}),
        conversation.ask('preferences.read', {}),
      ]),
    )
    expect(first.theme).toBe('dark')
    expect(second.theme).toBe('light')
  })
})

describe('Un process dédié muet est une erreur, pas une attente', () => {
  test('a port that never answers fails with a timeout that names the use case', async () => {
    const silent = profileConversation(port(null), alive, Duration.millis(30))

    const failed = await Effect.runPromise(Effect.flip(silent.ask('profile.status', {})))

    expect(failed).toBeInstanceOf(ProfileTimeout)
    expect(failed.useCase).toBe('profile.status')
    // And it says which of the four it is, rather than answering the use case twice over:
    // a field called `name` on an `Error` takes the tag its own class declares away.
    expect(failed.name).toBe('ProfileTimeout')
  })

  test('the wait is the one it was given, not one that goes on until something happens', async () => {
    const silent = profileConversation(port(null), alive, Duration.millis(30))

    const started = Date.now()
    await Effect.runPromise(Effect.flip(silent.ask('preferences.read', {})))

    expect(Date.now() - started).toBeLessThan(2_000)
  })

  test('a process that has already ended is gone, which is not something to wait for', async () => {
    const ended = profileConversation(port(null), () => false, Duration.millis(30))

    const failed = await Effect.runPromise(Effect.flip(ended.ask('preferences.read', {})))

    expect(failed).toBeInstanceOf(ProfileGone)
    expect(failed.useCase).toBe('preferences.read')
    expect(failed.name).toBe('ProfileGone')
  })
})

describe('Un message non conforme est refusé sans effet', () => {
  test('a refusal crosses back as a refusal, carrying the reason the other process gave', async () => {
    const refusing = port((request) => ({
      id: request.id,
      ok: false,
      error: 'preferences.write: refused a message whose theme does not match the use case',
    }))
    const conversation = profileConversation(refusing, alive)

    const failed = await Effect.runPromise(
      Effect.flip(conversation.ask('preferences.write', { theme: 'dark' })),
    )

    expect(failed).toBeInstanceOf(ProfileRefused)
    if (failed instanceof ProfileRefused) expect(failed.reason).toContain('theme')
  })
})
