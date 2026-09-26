/**
 * What the main process does when the database answers, refuses, or says nothing (D3-02).
 *
 * Each suite is named after the scenario of `specs/profile-storage/spec.md` it covers. The
 * port is stood in for, because what is under test is the waiting itself: a port that answers,
 * one that refuses, and one that never says anything at all.
 */

import { describe, expect, test } from 'vite-plus/test'
import { Duration, Effect, Option } from 'effect'

import type { EngineAnswer, EngineRequest } from '#engine/request.ts'
import type { EngineEvent } from '@hemera/ipc'
import {
  EngineGone,
  EngineRefused,
  EngineTimeout,
  type EnginePort,
  engineConversation,
} from '#main/engine-conversation.ts'

/** A port that answers each message the way the test says, or never answers at all. */
function port(reply: ((request: EngineRequest) => EngineAnswer) | null): EnginePort {
  const listeners: ((event: { data: EngineAnswer | EngineEvent }) => void)[] = []
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

/** A port a test pushes events through, the way the engine pushes them on its own. */
interface Pushing {
  readonly port: EnginePort
  readonly push: (event: EngineEvent) => void
}

function pushing(): Pushing {
  const listeners: ((event: { data: EngineAnswer | EngineEvent }) => void)[] = []
  return {
    port: {
      postMessage: () => undefined,
      on: (_event, listener) => listeners.push(listener),
      start: () => undefined,
    },
    push: (event) => {
      for (const listener of listeners) listener({ data: event })
    },
  }
}

const alive = () => true

describe('Un message conforme est traité', () => {
  test('the value the other process answered is the value the main process gets', async () => {
    const answering = port((request) => ({
      id: request.id,
      ok: true,
      value: {
        theme: 'dark',
        sidebar: { collapsed: true, width: null },
        activeProjectId: null,
        activeSessions: {},
        composers: {},
        acpTrace: false,
      },
    }))
    const conversation = engineConversation(answering, alive)

    expect(await Effect.runPromise(conversation.ask('preferences.read', {}))).toEqual({
      theme: 'dark',
      sidebar: { collapsed: true, width: null },
      activeProjectId: null,
      activeSessions: {},
      composers: {},
      acpTrace: false,
    })
  })

  test('two messages in flight are told apart by the identifier they came in on', async () => {
    const answering = port((request) => ({
      id: request.id,
      ok: true,
      value: {
        theme: request.id === 0 ? 'dark' : 'light',
        sidebar: { collapsed: false, width: null },
        activeProjectId: null,
        activeSessions: {},
        composers: {},
        acpTrace: false,
      },
    }))
    const conversation = engineConversation(answering, alive)

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
    const silent = engineConversation(port(null), alive, Duration.millis(30))

    const failed = await Effect.runPromise(Effect.flip(silent.ask('engine.status', {})))

    expect(failed).toBeInstanceOf(EngineTimeout)
    expect(failed.useCase).toBe('engine.status')
    // And it says which of the four it is, rather than answering the use case twice over:
    // a field called `name` on an `Error` takes the tag its own class declares away.
    expect(failed.name).toBe('EngineTimeout')
  })

  test('a prompt is not hurried: the turn lasts as long as it lasts', async () => {
    const silent = engineConversation(port(null), alive, Duration.millis(30))

    // Four times the patience and still waiting, which is the point: no timeout named the use
    // case, and only the guard of this test ended the wait.
    const outcome = await Effect.runPromise(
      silent
        .ask('agents.prompt', { sessionId: 'session-1', text: 'go' })
        .pipe(Effect.timeoutOption(Duration.millis(120))),
    )

    expect(Option.isNone(outcome)).toBe(true)
  })

  test('what Git does for a Workspace is not hurried: a cleanup takes as long as Git does', async () => {
    const silent = engineConversation(port(null), alive, Duration.millis(30))

    /** Whether a use case is still waited on after four times the patience. */
    const waiting = <A, E>(asked: Effect.Effect<A, E>) =>
      asked.pipe(Effect.timeoutOption(Duration.millis(120)), Effect.map(Option.isNone))
    const outcomes = await Effect.runPromise(
      Effect.all(
        [
          waiting(
            silent.ask('workspaces.plan', { projectId: 'atlas', key: 'HEM-7', slug: 'login-form' }),
          ),
          waiting(
            silent.ask('workspaces.create', {
              projectId: 'atlas',
              specId: null,
              name: 'login-form',
              repositories: [],
            }),
          ),
          waiting(silent.ask('workspaces.status', { id: 'login-form' })),
          waiting(silent.ask('workspaces.cleanup', { id: 'login-form' })),
        ],
        { concurrency: 'unbounded' },
      ),
    )

    expect(outcomes).toEqual([true, true, true, true])
  })

  test('the wait is the one it was given, not one that goes on until something happens', async () => {
    const silent = engineConversation(port(null), alive, Duration.millis(30))

    const started = Date.now()
    await Effect.runPromise(Effect.flip(silent.ask('preferences.read', {})))

    expect(Date.now() - started).toBeLessThan(2_000)
  })

  test('a process that has already ended is gone, which is not something to wait for', async () => {
    const ended = engineConversation(port(null), () => false, Duration.millis(30))

    const failed = await Effect.runPromise(Effect.flip(ended.ask('preferences.read', {})))

    expect(failed).toBeInstanceOf(EngineGone)
    expect(failed.useCase).toBe('preferences.read')
    expect(failed.name).toBe('EngineGone')
  })
})

describe('Un message non conforme est refusé sans effet', () => {
  test('a refusal crosses back as a refusal, carrying the reason the other process gave', async () => {
    const refusing = port((request) => ({
      id: request.id,
      ok: false,
      error: 'preferences.write: refused a message whose theme does not match the use case',
    }))
    const conversation = engineConversation(refusing, alive)

    const failed = await Effect.runPromise(
      Effect.flip(conversation.ask('preferences.write', { theme: 'dark' })),
    )

    expect(failed).toBeInstanceOf(EngineRefused)
    // Carried as the message, because it is the sentence the page shows to whoever asked.
    if (failed instanceof EngineRefused) expect(failed.message).toContain('theme')
  })
})

describe('What the engine pushes on its own is heard', () => {
  test('an event the engine pushes reaches whoever is listening, and is not taken for an answer', () => {
    const { port: pushingPort, push } = pushing()
    const conversation = engineConversation(pushingPort, alive)
    const heard: EngineEvent[] = []
    conversation.hear((event) => heard.push(event))

    // No identifier: it is not an answer to anything, and the page is the one it is for.
    push({ event: 'turn', sessionId: 'session-1', entry: null })
    push({ event: 'permission', sessionId: 'session-1', entry: null })

    expect(heard.map((event) => event.event)).toEqual(['turn', 'permission'])
    expect(heard).toEqual([
      { event: 'turn', sessionId: 'session-1', entry: null },
      { event: 'permission', sessionId: 'session-1', entry: null },
    ])
  })
})
