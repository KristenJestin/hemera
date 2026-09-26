import { describe, expect, test } from 'vite-plus/test'

import {
  evaluateJev,
  JEV_ACTION_LIMIT,
  JEV_MODEL,
  type JevTransport,
} from '#engine/classifier/jev.ts'

const state = { action: 'write a file in the Workspace', userContext: ['Please write the file.'] }

function answer(risk = 1, approval = 0.2, userRequested = 0.9) {
  return {
    model: JEV_MODEL,
    answers: {
      risk: {
        type: 'score',
        score: risk,
        confidence: 0.9,
        legend: { '0': 'read', '1': 'limited', '2': 'significant', '3': 'destructive' },
        probabilities: { '0': 0.1, '1': 0.9, '2': 0, '3': 0 },
      },
      approval: { type: 'noul', noul: approval },
      user_requested: { type: 'noul', noul: userRequested },
    },
  }
}

function transport<T>(value: T, status = 200): JevTransport {
  return { send: async () => Response.json(value, { status }) }
}

describe('Every invalid or unavailable evaluation asks', () => {
  test('valid answers use the pinned score policy', async () => {
    expect(
      await evaluateJev(state, 'test-key', new AbortController().signal, transport(answer())),
    ).toEqual({
      kind: 'evaluated',
      verdict: 'allow',
      model: JEV_MODEL,
    })
    expect(
      await evaluateJev(state, 'test-key', new AbortController().signal, transport(answer(2.5))),
    ).toMatchObject({ verdict: 'deny' })
  })

  test('a model mismatch, absent score or invalid number is unavailable', async () => {
    const wrongModel = { ...answer(), model: 'jev-latest' }
    const missing = { ...answer(), answers: { ...answer().answers, risk: {} } }
    const outOfRange = answer(3.1)
    const results = await Promise.all(
      [wrongModel, missing, outOfRange].map((value) =>
        evaluateJev(state, 'test-key', new AbortController().signal, transport(value)),
      ),
    )
    for (const result of results) {
      expect(result).toMatchObject({ kind: 'unavailable', reason: 'response' })
    }
  })

  test('missing credentials, a truncated action and HTTP errors never call or trust Jev', async () => {
    let sent = 0
    const fake: JevTransport = {
      send: async () => {
        sent += 1
        return Response.json(answer())
      },
    }
    expect(await evaluateJev(state, '', new AbortController().signal, fake)).toMatchObject({
      kind: 'unavailable',
    })
    expect(
      await evaluateJev(
        { ...state, action: 'x'.repeat(JEV_ACTION_LIMIT + 1) },
        'test-key',
        new AbortController().signal,
        fake,
      ),
    ).toMatchObject({ kind: 'unavailable' })
    expect(sent).toBe(0)
    expect(
      await evaluateJev(state, 'test-key', new AbortController().signal, transport(answer(), 429)),
    ).toMatchObject({ kind: 'unavailable', reason: 'network' })
  })

  test('abort makes a late provider answer inert', async () => {
    const controller = new AbortController()
    const late: JevTransport = {
      send: async () => {
        controller.abort()
        return Response.json(answer())
      },
    }
    expect(await evaluateJev(state, 'test-key', controller.signal, late)).toMatchObject({
      kind: 'unavailable',
    })
  })

  test('the request contains the exact action and pinned model without credential text', async () => {
    let body = ''
    const fake: JevTransport = {
      send: async (sent) => {
        body = sent
        return Response.json(answer())
      },
    }
    await evaluateJev(state, 'test-key', new AbortController().signal, fake)
    expect(body).toContain(state.action)
    expect(body).toContain(JEV_MODEL)
    expect(body).not.toContain('test-key')
  })
})
