/**
 * Jev, the remote judge of Hemera Auto, at its boundary: the pinned endpoint and model, what is
 * sent (the action masked, the human context, the three questions, never the key in the body),
 * the answer decoded, and every failure turned into a safe category. A fake Jev on a local socket
 * stands in for the real one; the real service is never reached.
 */

import { Duration, Effect, Fiber, Layer } from 'effect'
import { TestClock } from 'effect/testing'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import {
  JEV_ACTION_LIMIT,
  JEV_DEADLINE,
  JEV_ENDPOINT,
  JEV_MODEL,
  JevTransport,
  type JevInput,
  askJev,
  fetchTransport,
} from '../src/engine/permissions/jev.ts'
import { type FakeJev, fakeJev, scored, scoredBody } from './fake-jev.ts'

const KEY = 'jev-test-key-0123456789'

let jev: FakeJev

beforeEach(async () => {
  jev = await fakeJev()
})
afterEach(() => jev.close())

const action = (more: Record<string, string> = {}): JevInput['action'] => ({
  tool: 'commands_run',
  line: 'pnpm test',
  program: '/usr/bin/pnpm',
  args: ['test'],
  shell: false,
  platform: 'linux',
  cwd: '~/acme',
  inside: true,
  ...more,
})

const ask = (input: Partial<JevInput> = {}, known: ReadonlyArray<string> = [], key = KEY) =>
  Effect.runPromise(
    askJev({ action: action(), humanContext: [], ...input }, key, known).pipe(
      Effect.provide(Layer.succeed(JevTransport, fetchTransport(jev.url))),
    ),
  )

describe('Jev is pinned', () => {
  test('the endpoint, the model, the 10-second deadline and the action limit', () => {
    expect(JEV_ENDPOINT).toBe('https://api.typesafe.ai/v1/systemone')
    expect(JEV_MODEL).toBe('jev-1.13.0')
    expect(Duration.toMillis(JEV_DEADLINE)).toBe(10_000)
    expect(JEV_ACTION_LIMIT).toBe(20_000)
  })

  test('the transport posts to the endpoint, follows no redirect, and signs with the key', async () => {
    const seen: Array<{ url: string; init: RequestInit | undefined }> = []
    const transport = fetchTransport(JEV_ENDPOINT, (url, init) => {
      seen.push({ url: String(url), init })
      return Promise.resolve(new Response('{}', { status: 200 }))
    })
    await transport.send({ body: '{}', key: KEY }, new AbortController().signal)
    expect(seen).toHaveLength(1)
    expect(seen[0]?.url).toBe(JEV_ENDPOINT)
    expect(seen[0]?.init?.method).toBe('POST')
    expect(seen[0]?.init?.redirect).toBe('error')
    expect(new Headers(seen[0]?.init?.headers).get('authorization')).toBe(`Bearer ${KEY}`)
  })
})

describe('What Jev is told', () => {
  test('the model, the action, the human context and the three questions; the key only in the header', async () => {
    const result = await ask({ humanContext: ['The user answered: run the tests'] })
    expect(result.kind).toBe('evaluated')
    expect(jev.received).toHaveLength(1)
    const [received] = jev.received
    expect(received?.authorization).toBe(`Bearer ${KEY}`)
    expect(received?.body).not.toContain(KEY)
    const sent = JSON.parse(received?.body ?? '{}')
    expect(sent.model).toBe(JEV_MODEL)
    expect(sent.state.action).toEqual(action())
    expect(sent.state.user_context).toEqual(['The user answered: run the tests'])
    expect(Object.keys(sent.questions)).toEqual(['risk', 'approval', 'user_requested'])
    expect(sent.questions.risk.criteria).toEqual([
      'Read-only and contained',
      'Limited reversible change',
      'Significant change',
      'Destructive or security-sensitive',
    ])
    expect(sent.questions.approval.instructions).toBe(
      'Would this exact action normally need explicit human approval?',
    )
    expect(sent.questions.user_requested.instructions).toBe(
      'Did the human user explicitly request this exact action in the supplied human context?',
    )
  })

  test('a registered secret in the arguments or the context is masked; the key never travels in the body', async () => {
    await ask(
      {
        action: { ...action(), args: ['--token', 'tok-registered-77', KEY] },
        humanContext: [`The user wrote: use tok-registered-77 and ${KEY}`],
      },
      ['tok-registered-77'],
    )
    const body = jev.received[0]?.body ?? ''
    expect(body).not.toContain('tok-registered-77')
    expect(body).not.toContain(KEY)
    expect(body).toContain('•••')
  })

  test('an action whose destination masking would change is not sent', async () => {
    const result = await ask({ action: action({ cwd: '/srv/tok-registered-77' }) }, [
      'tok-registered-77',
    ])
    expect(result).toEqual({ kind: 'unavailable', failure: 'input', status: null, ms: null })
    expect(jev.received).toHaveLength(0)
  })

  test('an action longer than 20 000 characters is not sent', async () => {
    const result = await ask({
      action: action({ line: `echo ${'a'.repeat(JEV_ACTION_LIMIT)}` }),
    })
    expect(result).toMatchObject({ kind: 'unavailable', failure: 'input' })
    expect(jev.received).toHaveLength(0)
  })

  test('an empty key is never sent', async () => {
    expect(await ask({}, [], '  ')).toMatchObject({ kind: 'unavailable', failure: 'input' })
    expect(jev.received).toHaveLength(0)
  })
})

describe('What Jev answers', () => {
  test('the three scores, with the model and the round trip', async () => {
    jev.answer = () => scored(1.2, 0.3, 0.9)
    const result = await ask()
    expect(result).toMatchObject({
      kind: 'evaluated',
      model: JEV_MODEL,
      scores: { risk: 1.2, approval: 0.3, userRequested: 0.9 },
    })
    expect(result.ms).toBeGreaterThanOrEqual(0)
  })

  test.each([
    ['a rejected key (401)', { status: 401, body: '{"error":"invalid key sk-leak"}' }, 401],
    ['a forbidden key (403)', { status: 403, body: '' }, 403],
    ['too many requests (429)', { status: 429, body: 'slow down' }, 429],
    ['a server error (500)', { status: 500, body: 'boom' }, 500],
    ['a gateway error (503)', { status: 503, body: '' }, 503],
  ])('%s is an HTTP failure with its status only', async (_case, reply, status) => {
    jev.answer = () => reply
    expect(await ask()).toMatchObject({ kind: 'unavailable', failure: 'http', status })
  })

  test('a redirect is not followed: a failure', async () => {
    jev.answer = () => ({ status: 302, body: '', headers: { location: 'http://127.0.0.1:9/x' } })
    expect(await ask()).toMatchObject({ kind: 'unavailable', failure: 'network' })
    expect(jev.received).toHaveLength(1)
  })

  test.each([
    ['not JSON', '<html>busy</html>'],
    ['JSON of another shape', JSON.stringify({ ok: true })],
    [
      'a score that is not a number',
      JSON.stringify({ ...scoredBody(0, 0, 0), answers: { risk: { score: 'high' } } }),
    ],
  ])('an answer that is %s is a response failure', async (_case, body) => {
    jev.answer = () => ({ status: 200, body })
    expect(await ask()).toMatchObject({ kind: 'unavailable', failure: 'response' })
  })

  test('an answer naming another model is a response failure', async () => {
    jev.answer = () => ({
      status: 200,
      body: JSON.stringify({ ...scoredBody(0, 0, 0), model: 'jev-2.0.0' }),
    })
    expect(await ask()).toMatchObject({ kind: 'unavailable', failure: 'response' })
  })

  test('a network that refuses is a network failure', async () => {
    await jev.close()
    expect(await ask()).toMatchObject({ kind: 'unavailable', failure: 'network' })
  })

  test('the deadline is Hemera’s: a transport that ignores its signal still loses at 10 seconds', async () => {
    const never = { send: () => new Promise<never>(() => {}) }
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const asking = yield* askJev({ action: action(), humanContext: [] }, KEY, []).pipe(
          Effect.provide(Layer.succeed(JevTransport, never)),
          Effect.forkChild,
        )
        yield* TestClock.adjust(Duration.millis(9_999))
        expect(asking.pollUnsafe()).toBeUndefined()
        yield* TestClock.adjust(Duration.millis(1))
        return yield* Fiber.join(asking)
      }).pipe(Effect.provide(TestClock.layer())),
    )
    expect(result).toMatchObject({ kind: 'unavailable', failure: 'timeout' })
  })
})
