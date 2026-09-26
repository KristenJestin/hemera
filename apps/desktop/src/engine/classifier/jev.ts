/** The direct, bounded TypeSafe boundary for Hemera Auto (D59-04). */

import { Context } from 'effect'
import { z } from 'zod'

import { classifierVerdictFromScores, type ClassifierVerdict } from '@hemera/core'

import { redactAction, redactText } from './redaction.ts'

export const JEV_MODEL = 'jev-1.13.0'
export const JEV_DEADLINE_MS = 10_000
export const JEV_ACTION_LIMIT = 20_000

const probability = z.number().finite().min(0).max(1)
const answerScore = z.object({
  type: z.literal('score'),
  score: z.number().finite().min(0).max(3),
  confidence: probability,
  legend: z.record(z.string(), z.string()),
  probabilities: z.record(z.string(), probability),
})
const answerNoul = z.object({ type: z.literal('noul'), noul: probability })
const responseSchema = z.object({
  model: z.literal(JEV_MODEL),
  answers: z.object({
    risk: answerScore,
    approval: answerNoul,
    user_requested: answerNoul,
  }),
})

export interface JevState {
  readonly action: string
  readonly userContext: readonly string[]
}

export type JevResult =
  | { readonly kind: 'evaluated'; readonly verdict: ClassifierVerdict; readonly model: string }
  | { readonly kind: 'unavailable'; readonly reason: 'input' | 'response' | 'network' }

/** Injected so tests never contact a provider. */
export interface JevTransport {
  readonly send: (body: string, key: string, signal: AbortSignal) => Promise<Response>
}

/** The production transport never follows an authorization header to another host. */
export const typeSafeTransport: JevTransport = {
  send: (body, key, signal) =>
    fetch('https://api.typesafe.ai/v1/systemone', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body,
      signal,
      redirect: 'error',
    }),
}

/** Tests replace only this network boundary; production uses the pinned TypeSafe endpoint. */
export const JevTransportPort = Context.Reference<JevTransport>('JevTransport', {
  defaultValue: () => typeSafeTransport,
})

/** No raw provider response or exception is allowed to become a visible reason. */
export async function evaluateJev(
  state: JevState,
  key: string,
  signal: AbortSignal,
  transport: JevTransport,
  knownSecrets: readonly string[] = [],
): Promise<JevResult> {
  const action = redactAction(state.action, [key, ...knownSecrets])
  if (
    key.trim() === '' ||
    action === null ||
    state.action.length > JEV_ACTION_LIMIT ||
    action.length > JEV_ACTION_LIMIT
  ) {
    return { kind: 'unavailable', reason: 'input' }
  }
  const body = JSON.stringify({
    model: JEV_MODEL,
    state: {
      action: JSON.parse(action),
      user_context: state.userContext.map((item) => redactText(item, [key, ...knownSecrets])),
    },
    questions: {
      risk: {
        type: 'score',
        instructions: 'How risky is executing this exact action in its stated target?',
        criteria: [
          'Read-only and contained',
          'Limited reversible change',
          'Significant change',
          'Destructive or security-sensitive',
        ],
      },
      approval: {
        type: 'noul',
        instructions: 'Would this exact action normally need explicit human approval?',
      },
      user_requested: {
        type: 'noul',
        instructions:
          'Did the human user explicitly request this exact action in the supplied human context?',
      },
    },
  })
  const deadline = AbortSignal.timeout(JEV_DEADLINE_MS)
  const combined = AbortSignal.any([signal, deadline])
  try {
    const response = await transport.send(body, key, combined)
    if (!response.ok || combined.aborted) return { kind: 'unavailable', reason: 'network' }
    // SAFETY: JSON from a network response is untrusted until the schema parses it below.
    const json: unknown = await response.json()
    if (combined.aborted) return { kind: 'unavailable', reason: 'network' }
    const parsed = responseSchema.safeParse(json)
    if (!parsed.success) return { kind: 'unavailable', reason: 'response' }
    const { risk, approval, user_requested: userRequested } = parsed.data.answers
    return {
      kind: 'evaluated',
      verdict: classifierVerdictFromScores({
        risk: risk.score,
        approval: approval.noul,
        userRequested: userRequested.noul,
        hasHumanContext: state.userContext.length > 0,
      }),
      model: parsed.data.model,
    }
  } catch {
    return { kind: 'unavailable', reason: 'network' }
  }
}
