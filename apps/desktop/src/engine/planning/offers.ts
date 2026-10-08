/**
 * What an agent offers, as `model_recommend` checks it (#90): the models and the efforts an agent
 * lists for a session, read from the Planner's own live session when the recommendation names its
 * agent. Hemera starts no agent only to list its models: for another agent, it checks that the
 * agent can run here, and the recommendation is kept unchecked for the pre-launch check.
 *
 * The gate stands below the agents' runtime: the runtime's side serves this port once it runs,
 * and a call made before waits for it, as the Probes' desk does.
 */

import type { AgentProvider } from '@hemera/core/domain'
import { Context, Deferred, Effect, Layer } from 'effect'

import { Discovery } from '../agents/discovery.ts'
import { AgentRuntime } from '../agents/runtime.ts'
import { getAgentSession } from '../agents/sessions.ts'
import type { Database } from '../storage/database.ts'
import type { DomainEvents } from '../domain-events.ts'

/** The option categories the agents give their model and their effort. */
const MODEL = 'model'
const EFFORT = 'thought_level'

/**
 * What the agent offers: its models and efforts (an empty list when it has no such option), or
 * that it can run here but was not asked, or why it cannot run here.
 */
export type AgentOffer =
  | {
      readonly kind: 'offered'
      readonly models: ReadonlyArray<string>
      readonly efforts: ReadonlyArray<string>
    }
  | { readonly kind: 'unchecked' }
  | { readonly kind: 'unusable'; readonly reason: string }

export interface OffersWork {
  /** What `agent` offers, the session asking being the Planner's. */
  readonly of: (sessionId: string, agent: AgentProvider) => Effect.Effect<AgentOffer>
}

export class AgentOffers extends Context.Service<
  AgentOffers,
  OffersWork & { readonly serve: (work: OffersWork) => Effect.Effect<void> }
>()('AgentOffers') {}

export const agentOffersLayer = Layer.effect(
  AgentOffers,
  Effect.gen(function* () {
    const served = yield* Deferred.make<OffersWork>()
    return {
      of: (sessionId, agent) =>
        Effect.flatMap(Deferred.await(served), (work) => work.of(sessionId, agent)),
      serve: (work) => Effect.asVoid(Deferred.succeed(served, work)),
    }
  }),
)

/** The runtime's side: serves the port from the Planner's live session and the discovery. */
export const agentOffersServed = Layer.effectDiscard(
  Effect.gen(function* () {
    const context = yield* Effect.context<
      AgentRuntime | Discovery | AgentOffers | Database | DomainEvents
    >()
    const offers = Context.get(context, AgentOffers)
    yield* offers.serve({
      of: (sessionId, agent) =>
        Effect.gen(function* () {
          const session = yield* getAgentSession(sessionId)
          if (session.provider !== agent) {
            return yield* Discovery.use((discovery) => discovery.resolve(agent)).pipe(
              Effect.as<AgentOffer>({ kind: 'unchecked' }),
              Effect.catch((unusable) =>
                Effect.succeed<AgentOffer>({ kind: 'unusable', reason: unusable.message }),
              ),
            )
          }
          const options = yield* AgentRuntime.use((runtime) => runtime.options(sessionId))
          const values = (category: string) =>
            options
              .filter((option) => option.category === category)
              .flatMap((option) => option.values.map((value) => value.id))
          return { kind: 'offered', models: values(MODEL), efforts: values(EFFORT) } as const
        }).pipe(
          Effect.catch((failed) =>
            Effect.succeed<AgentOffer>({
              kind: 'unusable',
              reason: `${agent} did not say what it offers: ${failed.message}`,
            }),
          ),
          Effect.provide(context),
        ),
    })
  }),
)
