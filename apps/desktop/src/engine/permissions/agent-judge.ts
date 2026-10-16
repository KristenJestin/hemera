/**
 * The agent's own judge (#197): when Jev is not there, a call the local rules leave open is rated
 * by a judge session of the session's own agent, over ACP like every session of Hemera (never a
 * one-shot command line), with the same login and its smallest model.
 *
 * - One judge per Project and agent, kept open (#209): what one Project's calls and its user said
 *   never reach the judge of another. Each call to rate is a new turn of it, so its instructions
 *   stay cached. It is started on its first call, and let go after `JUDGEMENTS` judgements or
 *   `JUDGE_IDLE` without one; the next call starts it again.
 * - Never beside Jev (#209): with Jev ready, no judge is started, and every judge open, starting
 *   or in a turn is let go as soon as Jev becomes ready; the call it was rating goes to Jev.
 * - It can do nothing: no MCP server, no tool (its adapter's `judgeOptions`), every permission it
 *   asks refused, and a folder of its own in Hemera's data folder to run in.
 * - It is told what Jev is told, masked, as fenced data, and answers only the three scores, read
 *   by a strict Schema. Anything else is `unavailable`: a call it could not be sent whole, a start
 *   that fails, no answer within `AGENT_JUDGE_DEADLINE`, an answer that does not read, a judge
 *   that dies. A failed turn lets the judge go: the next call starts a fresh one.
 *
 * One turn at a time per judge; the calls waiting on it wait within their deadline.
 */

import { randomBytes } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import {
  type AgentProvider,
  JUDGE_INSTRUCTIONS,
  type JudgeScores,
  judgeTurn,
  maskAction,
  maskPrinted,
  readJudgeReply,
} from '@hemera/core/domain'
import {
  Clock,
  Context,
  Duration,
  Effect,
  Exit,
  Fiber,
  Layer,
  Option,
  Predicate,
  Result,
  Schedule,
  Schema,
  Scope,
  Semaphore,
  Stream,
} from 'effect'

import type { Log } from '../../main/diagnostic.ts'
import { ADAPTERS } from '../agents/adapters/index.ts'
import { agentDirectoryOf } from '../agents/bare.ts'
import {
  type AgentConnection,
  AgentPermissionAnswer,
  type AgentSession,
  type PromptBlock,
  ResourceBlock,
  TextBlock,
  connect,
  processTransport,
} from '../agents/client.ts'
import { Discovery } from '../agents/discovery.ts'
import { AgentStarter } from '../agents/runtime.ts'
import { getAgentSession } from '../agents/sessions.ts'
import type { Database } from '../storage/database.ts'
import type { CallSession } from '../tools/ports.ts'

/** How many judgements a judge session gives before it is let go and started anew. */
export const JUDGEMENTS = 50
/** How long a judge stays open without a judgement. */
export const JUDGE_IDLE = Duration.minutes(10)
/**
 * How long a call waits on the agent's judge, its start and the calls before it included: within
 * the order's `JUDGE_LIMIT`, so its failure is said and the judge let go before the order gives up.
 */
export const AGENT_JUDGE_DEADLINE = Duration.seconds(9)

/** What the agent's judge is asked about: the call as Hemera will run it, and what the user said. */
export interface AgentJudgeInput {
  readonly action: Schema.JsonObject
  readonly humanContext: ReadonlyArray<string>
}

/** Why the agent's judge could not rate a call. */
export type AgentJudgeFailure = 'input' | 'start' | 'timeout' | 'response' | 'gone'

export type AgentRating =
  | {
      readonly kind: 'evaluated'
      /** The agent's name: `Claude Code`. */
      readonly judge: string
      readonly model: string
      readonly scores: JudgeScores
      readonly ms: number
    }
  | {
      readonly kind: 'unavailable'
      readonly judge: string
      readonly failure: AgentJudgeFailure
      readonly ms: number | null
    }
  /** No agent's judge in this engine: the call asks as it did before. */
  | { readonly kind: 'none' }
  /** Jev became ready meanwhile: the call goes to Jev, never to the agent's judge. */
  | { readonly kind: 'superseded' }

export class AgentJudges extends Context.Service<
  AgentJudges,
  {
    /**
     * The judge of the session's Project and agent rates the call; `known` are the secret values
     * to mask. `jevReady` is asked once the call's turn comes: Jev ready, no judge is started.
     */
    readonly rate: (
      session: CallSession,
      input: AgentJudgeInput,
      known: ReadonlyArray<string>,
      jevReady: Effect.Effect<boolean>,
    ) => Effect.Effect<AgentRating>
    /**
     * Jev became ready: every judge is let go, one starting once started, and a call they were
     * rating is `superseded`.
     */
    readonly letGoForJev: Effect.Effect<void>
  }
>()('AgentJudges') {}

/** No agent's judge: an engine that cannot start an agent. */
export const noAgentJudges = Layer.succeed(AgentJudges, {
  rate: () => Effect.succeed({ kind: 'none' }),
  letGoForJev: Effect.void,
})

/** Every permission a judge asks for is refused: it has nothing to ask permission for. */
const refuseEverything = Layer.succeed(AgentPermissionAnswer, {
  answer: () => Effect.succeed('reject'),
})

/** The bare `_meta` as the JSON object it travels as. */
const asJson = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Json))

/** The address the instructions travel under, as a first-message resource. */
const INSTRUCTIONS_URI = 'hemera://judge-instructions'

/** One judge session, while it is open. */
interface Open {
  readonly connection: AgentConnection
  readonly session: AgentSession
  readonly scope: Scope.Closeable
  readonly model: string
  /** What the first turn carries before the action: the instructions, for some agents. */
  first: ReadonlyArray<PromptBlock>
  /** What the agent said in the turn under way. */
  said: string
  judgements: number
  lastUsed: number
  gone: boolean
}

/**
 * One Project's judge of one agent: open or not, the start under way, and the lock its turns
 * take.
 */
interface Slot {
  readonly provider: AgentProvider
  open: Open | null
  starting: Fiber.Fiber<Open, 'start'> | null
  readonly lock: Semaphore.Semaphore
  /** The calls judged or waiting on it now. */
  busy: number
}

/** A fence no data names: drawn for each turn. */
const fenceOf = (): string => randomBytes(9).toString('hex')

/** The tokens a turn spent, for the diagnostic log. */
const tokensSaid = (
  usage: { readonly inputTokens: number; readonly outputTokens: number } | null,
) =>
  usage === null ? '' : ` tokens in=${String(usage.inputTokens)} out=${String(usage.outputTokens)}`

export interface AgentJudgeSettings {
  readonly dataFolder: string
  readonly log: Log
}

export const agentJudgesLayer = (settings: AgentJudgeSettings) =>
  Layer.effect(
    AgentJudges,
    Effect.gen(function* () {
      const context = yield* Effect.context<AgentStarter | Discovery | Database>()
      const scope = yield* Effect.scope
      const { log } = settings
      /** The judges, by Project and agent. */
      const slots = new Map<string, Slot>()
      const slotOf = (projectId: string, provider: AgentProvider): Slot => {
        const key = JSON.stringify([projectId, provider])
        const found = slots.get(key)
        if (found !== undefined) return found
        const made: Slot = {
          provider,
          open: null,
          starting: null,
          lock: Semaphore.makeUnsafe(1),
          busy: 0,
        }
        slots.set(key, made)
        return made
      }
      /** How many times Jev became ready: a judge started or rating across a change is let go. */
      let jevTimes = 0

      /** Lets a judge go, once: the next call starts another. */
      const letGo = (slot: Slot, open: Open, why: string) =>
        Effect.suspend(() => {
          if (slot.open === open) slot.open = null
          if (open.gone) return Effect.void
          open.gone = true
          log(`judge ${slot.provider}: ${why}, the judge session is let go`)
          return Scope.close(open.scope, Exit.void)
        })

      /** Opens a judge session of the agent, on its smallest model, or the session's. */
      const start = (provider: AgentProvider, sessionModel: string | null) =>
        Effect.gen(function* () {
          const resolved = yield* Discovery.use((discovery) => discovery.resolve(provider))
          const agentDirectory = agentDirectoryOf(settings.dataFolder, provider)
          const folder = join(agentDirectory, 'judge')
          yield* Effect.sync(() => mkdirSync(folder, { recursive: true }))
          const options = resolved.adapter.judgeOptions({
            agentDirectory,
            instructions: JUDGE_INSTRUCTIONS,
            own: resolved.own,
          })
          const judgeScope = yield* Scope.fork(scope)
          return yield* Effect.gen(function* () {
            const agent = yield* AgentStarter.use((starter) =>
              starter.start(resolved, { ...resolved.env, ...options.env }, `judge:${provider}`),
            )
            const connection = yield* connect({
              transport: processTransport(agent, (line) => log(`judge ${provider}: ${line}`)),
            }).pipe(Effect.provide(refuseEverything))
            const session = yield* connection.newSession({
              cwd: folder,
              mcpServers: options.mcpServers,
              meta: options.meta === undefined ? undefined : asJson(options.meta),
            })
            const models = session.options().find((option) => option.category === 'model')
            const offered = (models?.values ?? []).map((value) => value.id)
            const wanted =
              resolved.adapter.judgeModel(offered, resolved.own) ??
              (sessionModel !== null && offered.includes(sessionModel) ? sessionModel : null)
            if (models !== undefined && wanted !== null && wanted !== models.value) {
              // A model it will not take leaves the judge on the agent's own default.
              yield* Effect.ignore(session.setOption(models.id, wanted))
            }
            const model =
              session.options().find((option) => option.category === 'model')?.value ?? 'default'
            const now = yield* Clock.currentTimeMillis
            const open: Open = {
              connection,
              session,
              scope: judgeScope,
              model,
              first:
                options.systemPromptAs === 'embedded-resource'
                  ? [
                      ResourceBlock.make({
                        uri: INSTRUCTIONS_URI,
                        mimeType: 'text/markdown',
                        text: JUDGE_INSTRUCTIONS,
                      }),
                    ]
                  : [],
              said: '',
              judgements: 0,
              lastUsed: now,
              gone: false,
            }
            // What the agent says is kept for the turn under way; nothing else of it is read.
            yield* connection.events.pipe(
              Stream.runForEach((event) =>
                Effect.sync(() => {
                  if (Predicate.isTagged(event, 'MessageChunk') && !event.replay) {
                    open.said += event.text
                  }
                }),
              ),
              Effect.forkIn(judgeScope),
            )
            log(`judge ${provider}: opened on ${model}`)
            return open
          }).pipe(
            Effect.provideService(Scope.Scope, judgeScope),
            Effect.onError(() => Scope.close(judgeScope, Exit.void)),
          )
        }).pipe(
          Effect.provide(context),
          Effect.tapCause(() =>
            Effect.sync(() => log(`judge ${provider}: it could not be started`)),
          ),
          Effect.mapError(() => 'start' as const),
        )

      /**
       * The open judge of the agent, started when there is none. A start runs in the layer's
       * scope: a call that stops waiting on it leaves it to finish for the next one.
       */
      const ready = (slot: Slot, sessionModel: string | null) =>
        Effect.gen(function* () {
          const provider = slot.provider
          const now = yield* Clock.currentTimeMillis
          const held = slot.open
          if (held !== null) {
            if (held.judgements >= JUDGEMENTS) {
              yield* letGo(slot, held, `${String(JUDGEMENTS)} judgements given`)
            } else if (now - held.lastUsed >= Duration.toMillis(JUDGE_IDLE)) {
              yield* letGo(slot, held, 'idle for 10 minutes')
            } else {
              return held
            }
          }
          const seen = jevTimes
          const starting =
            slot.starting ??
            (yield* start(provider, sessionModel).pipe(
              Effect.tap((open) =>
                Effect.gen(function* () {
                  // Jev became ready while it started: it is not needed.
                  if (jevTimes !== seen) return yield* letGo(slot, open, 'Jev is ready')
                  slot.open = open
                  // A judge that dies is let go: the next call starts another.
                  yield* open.connection.gone.pipe(
                    Effect.andThen(letGo(slot, open, 'the judge ended')),
                    Effect.forkIn(open.scope),
                  )
                }),
              ),
              Effect.ensuring(Effect.sync(() => (slot.starting = null))),
              Effect.forkIn(scope),
            ))
          slot.starting = starting
          return yield* Fiber.join(starting)
        })

      /** One turn: the action told, the answer read; any failure lets the judge go. */
      const turn = (slot: Slot, open: Open, input: AgentJudgeInput) =>
        Effect.gen(function* () {
          const blocks = [
            ...open.first,
            TextBlock.make({ text: judgeTurn(input.action, input.humanContext, fenceOf()) }),
          ]
          open.first = []
          open.said = ''
          const outcome = yield* open.session
            .prompt(blocks)
            .pipe(Effect.mapError(() => 'gone' as const))
          if (outcome.stopReason === 'interrupted') return yield* Effect.fail('gone' as const)
          // The words of the turn may still be on their way when its answer is: they are let in.
          let scores = readJudgeReply(open.said)
          for (let tries = 0; Option.isNone(scores) && tries < 5; tries += 1) {
            yield* Effect.yieldNow
            scores = readJudgeReply(open.said)
          }
          open.judgements += 1
          open.lastUsed = yield* Clock.currentTimeMillis
          if (outcome.stopReason !== 'end_turn' || Option.isNone(scores)) {
            return yield* Effect.fail('response' as const)
          }
          return { scores: scores.value, usage: outcome.usage }
        }).pipe(
          Effect.tapError((failure) =>
            letGo(slot, open, failure === 'gone' ? 'the judge ended' : 'its answer did not read'),
          ),
          Effect.onInterrupt(() => letGo(slot, open, 'it did not answer in time')),
        )

      const rate = (
        session: CallSession,
        input: AgentJudgeInput,
        known: ReadonlyArray<string>,
        jevReady: Effect.Effect<boolean>,
      ): Effect.Effect<AgentRating> =>
        Effect.gen(function* () {
          const record = yield* getAgentSession(session.sessionId).pipe(Effect.option)
          if (Option.isNone(record)) {
            return { kind: 'unavailable', judge: 'the agent', failure: 'start', ms: null } as const
          }
          const { provider, chosen, taken } = record.value
          const judge = ADAPTERS[provider].label
          const action = maskAction(input.action, known)
          if (action === null)
            return { kind: 'unavailable', judge, failure: 'input', ms: null } as const
          const told = input.humanContext.map((item) => maskPrinted(item, known))
          const slot = slotOf(session.projectId, provider)
          const began = yield* Clock.currentTimeMillis
          const since = Effect.map(Clock.currentTimeMillis, (now) =>
            Math.max(0, Math.round(now - began)),
          )
          const seen = jevTimes
          slot.busy += 1
          const rated = yield* Effect.gen(function* () {
            // Jev ready, or made ready while the call waited: no judge is started.
            if (yield* jevReady) return null
            const open = yield* ready(slot, chosen.model ?? taken.model)
            if (jevTimes !== seen) return null
            const answered = yield* turn(slot, open, { action, humanContext: told })
            return { ...answered, model: open.model }
          }).pipe(
            Semaphore.withPermits(slot.lock, 1),
            Effect.timeoutOption(AGENT_JUDGE_DEADLINE),
            Effect.result,
            Effect.ensuring(Effect.sync(() => (slot.busy -= 1))),
          )
          // Whatever became of the turn, Jev ready meanwhile rates the call.
          if (jevTimes !== seen) return { kind: 'superseded' } as const
          const ms = yield* since
          if (Result.isFailure(rated)) {
            return { kind: 'unavailable', judge, failure: rated.failure, ms } as const
          }
          if (Option.isNone(rated.success)) {
            return { kind: 'unavailable', judge, failure: 'timeout', ms } as const
          }
          if (rated.success.value === null) return { kind: 'superseded' } as const
          const { scores, usage, model } = rated.success.value
          log(`judge ${provider}: rated on ${model} in ${String(ms)}ms${tokensSaid(usage)}`)
          return { kind: 'evaluated', judge, model, scores, ms } as const
        }).pipe(Effect.provide(context))

      const letGoForJev = Effect.gen(function* () {
        jevTimes += 1
        for (const slot of slots.values()) {
          if (slot.open !== null) yield* letGo(slot, slot.open, 'Jev is ready')
        }
      })

      // The judges idle for 10 minutes are let go, looked at every minute.
      yield* Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis
        for (const slot of slots.values()) {
          const open = slot.open
          if (open === null || now - open.lastUsed < Duration.toMillis(JUDGE_IDLE)) continue
          // Not while a call is judged or waits on it.
          if (slot.busy > 0) continue
          yield* letGo(slot, open, 'idle for 10 minutes')
        }
      }).pipe(
        Effect.delay(Duration.minutes(1)),
        Effect.repeat(Schedule.spaced(Duration.minutes(1))),
        Effect.forkScoped,
      )

      return { rate, letGoForJev }
    }),
  )
