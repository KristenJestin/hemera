/**
 * A fake Jev: a local HTTP server that speaks the API Hemera Auto calls (a POST of the model, the
 * state and the three questions; an answer naming the model with the three scores), so the suites
 * reach a real socket without ever reaching the real service. Each request is kept as it arrived.
 */

import { type IncomingMessage, type ServerResponse, createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

import type { Schema } from 'effect'

import { JEV_MODEL } from '../src/engine/permissions/jev.ts'

/** One request as the fake received it. */
export interface Received {
  readonly authorization: string | undefined
  readonly body: string
}

/** How the fake answers one request: a status, and a body (a value is sent as JSON). */
export interface Reply {
  readonly status: number
  /** Sent as it is; a value in `json` is sent as JSON instead. */
  readonly body: string
  readonly json?: Schema.Json
  readonly headers?: Readonly<Record<string, string>>
}

/** The body of Jev's answer with these scores. */
export const scoredBody = (
  risk: number,
  approval: number,
  userRequested: number,
): Schema.JsonObject => ({
  model: JEV_MODEL,
  answers: {
    risk: {
      type: 'score',
      score: risk,
      confidence: 0.9,
      legend: { '0': 'Read-only and contained' },
      probabilities: { '0': 0.9 },
    },
    approval: { type: 'noul', noul: approval },
    user_requested: { type: 'noul', noul: userRequested },
  },
})

/** Jev's answer with these scores. */
export const scored = (risk: number, approval: number, userRequested: number): Reply => ({
  status: 200,
  body: '',
  json: scoredBody(risk, approval, userRequested),
})

export interface FakeJev {
  readonly url: string
  readonly received: Received[]
  /** Replaces how the next requests are answered. */
  answer: (request: Received) => Reply | Promise<Reply>
  readonly close: () => Promise<void>
}

const bodyOf = (request: IncomingMessage): Promise<string> =>
  new Promise((done) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => done(Buffer.concat(chunks).toString('utf8')))
  })

export async function fakeJev(): Promise<FakeJev> {
  const fake: FakeJev = {
    url: '',
    received: [],
    answer: () => scored(0, 0, 0),
    close: () => Promise.resolve(),
  }
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    void (async () => {
      const received = { authorization: request.headers.authorization, body: await bodyOf(request) }
      fake.received.push(received)
      const reply = await fake.answer(received)
      response.writeHead(reply.status, { 'content-type': 'application/json', ...reply.headers })
      response.end(reply.json === undefined ? reply.body : JSON.stringify(reply.json))
    })()
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  // SAFETY: a server listening on a TCP port answers its address as an AddressInfo.
  const { port } = server.address() as AddressInfo
  return {
    ...fake,
    url: `http://127.0.0.1:${String(port)}/v1/systemone`,
    received: fake.received,
    get answer() {
      return fake.answer
    },
    set answer(next) {
      fake.answer = next
    },
    close: () =>
      new Promise((done) => {
        server.closeAllConnections()
        server.close(() => done())
      }),
  }
}
