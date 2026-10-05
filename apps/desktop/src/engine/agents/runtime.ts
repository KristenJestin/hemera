/**
 * The runtime of agents' sessions: an agent's process started bare when a session needs it, and
 * nothing more.
 *
 * Starting a session's agent: the agent is resolved (installed, signed in, qualified bare on this
 * system), a token for Hemera's tools is minted for this session, the bare options are built, the
 * process is started through `AgentStarter` (a bundled adapter forked by main, or the agent's own
 * command spawned by the supervisor), ACP is spoken over its lines, the session is resumed when
 * the agent can, loaded when it can only load, opened anew otherwise, and the options chosen for
 * it are applied again (model, effort, mode) with what the agent took written down.
 *
 * An agent that dies closes its turn as interrupted (the client does), and its token is revoked;
 * the death is told on `deaths`, and nothing starts it again by itself: replacing a dead session
 * is #40's. A process let go for being idle is not the end of its session: the next prompt starts
 * a process again and resumes it.
 */

import { Context, Effect, Exit, Layer, PubSub, Schema, Scope, Stream } from 'effect'

import type { LaunchFailed } from '@hemera/ipc'

import type { Log } from '../../main/diagnostic.ts'
import type { AgentsProcess } from '../agents.ts'
import type { DomainEvents } from '../domain-events.ts'
import type { Database, DatabaseError } from '../storage/database.ts'
import { agentDirectoryOf } from './bare.ts'
import {
  type AgentConnection,
  type AgentGone,
  type AgentOption,
  type AgentPermissionAnswer,
  type AgentProtocolError,
  type AgentSession,
  type ImageNotAccepted,
  type ModelUnavailable,
  type PromptBlock,
  type PromptOutcome,
  ResourceBlock,
  connect,
  processTransport,
} from './client.ts'
import { Discovery, type ResolvedAgent, type UnusableAgent } from './discovery.ts'
import { type EndpointUnavailable, HemeraEndpoint } from './endpoint.ts'
import { IdleAgents } from './idle.ts'
import {
  type Choice,
  type UnknownAgentSession,
  chooseOption,
  getAgentSession,
  reapplyChoices,
  recordNativeSession,
} from './sessions.ts'
import { AcpTraces, type TraceNameRefused } from './trace.ts'

/** Where an agent's process comes from: a bundled adapter forked by main, or the agent's own. */
export class AgentStarter extends Context.Service<
  AgentStarter,
  {
    readonly start: (
      resolved: ResolvedAgent,
      environment: Readonly<Record<string, string>>,
      sessionId: string,
    ) => Effect.Effect<AgentsProcess, LaunchFailed, Scope.Scope>
  }
>()('AgentStarter') {}

/** An agent's session died: its process ended without being asked to. */
export const AgentDied = Schema.TaggedStruct('AgentDied', { sessionId: Schema.String })
export type AgentDied = typeof AgentDied.Type

/** What a session's system prompt is, until the briefs of #40 write it. */
const SYSTEM_PROMPT =
  'You work for Hemera. Every read, write and command goes through Hemera’s tools, the only ones you have. A refusal from Hemera is an answer: it says what was refused and why; do not try to reach the same effect another way.'

/** The bare `_meta` as the JSON object it travels as. */
const asJson = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Json))

/** One process of a session's agent, while it runs. */
interface Live {
  readonly connection: AgentConnection
  readonly session: AgentSession
  readonly scope: Scope.Closeable
  /** Whether a turn runs now. */
  turning: boolean
  /** Set when the runtime itself lets the process go, so its end is not a death. */
  letGo: boolean
  /** What the first prompt of a new session carries before the user's words: the system prompt. */
  firstBlocks: ReadonlyArray<PromptBlock>
}

/** Why a session's agent could not be started or spoken to. */
export type AgentFailure =
  | DatabaseError
  | UnknownAgentSession
  | UnusableAgent
  | EndpointUnavailable
  | LaunchFailed
  | TraceNameRefused
  | AgentProtocolError
  | AgentGone
  | ModelUnavailable

export interface RuntimeSettings {
  readonly dataFolder: string
  readonly log: Log
}

export class AgentRuntime extends Context.Service<
  AgentRuntime,
  {
    /** One turn of a session, its agent's process started first when none runs. */
    readonly prompt: (
      sessionId: string,
      blocks: ReadonlyArray<PromptBlock>,
    ) => Effect.Effect<PromptOutcome, AgentFailure | ImageNotAccepted, Database | DomainEvents>
    /** An option chosen for a session: put on its agent, kept for every restart. */
    readonly choose: (
      sessionId: string,
      choice: Choice,
      value: string,
    ) => Effect.Effect<void, AgentFailure, Database | DomainEvents>
    /**
     * The options a session's agent offers (model, effort, mode…), with their values now and the
     * agent's defaults: what the model picker lists. Its process is started first when none runs.
     */
    readonly options: (
      sessionId: string,
    ) => Effect.Effect<ReadonlyArray<AgentOption>, AgentFailure, Database | DomainEvents>
    /** Lets a session's process go (idle release, or the session's end): its token is revoked. */
    readonly release: (sessionId: string) => Effect.Effect<void>
    /** Each death of an agent's process, as it happens. */
    readonly deaths: Stream.Stream<AgentDied>
  }
>()('AgentRuntime') {}

export const agentRuntimeLayer = (settings: RuntimeSettings) =>
  Layer.effect(
    AgentRuntime,
    Effect.gen(function* () {
      const context = yield* Effect.context<
        | AgentStarter
        | Discovery
        | HemeraEndpoint
        | IdleAgents
        | AcpTraces
        | AgentPermissionAnswer
        | Scope.Scope
      >()
      const scope = yield* Effect.scope
      const deaths = yield* PubSub.unbounded<AgentDied>()
      const live = new Map<string, Live>()
      const endpoint = Context.get(context, HemeraEndpoint)
      const idle = Context.get(context, IdleAgents)

      /** Ends a process's bookkeeping, once, however it ended. */
      const forget = (sessionId: string, one: Live) =>
        Effect.gen(function* () {
          if (live.get(sessionId) !== one) return
          live.delete(sessionId)
          yield* idle.drop(sessionId)
          yield* endpoint.revoke(sessionId)
        })

      const start = (sessionId: string) =>
        Effect.gen(function* () {
          const record = yield* getAgentSession(sessionId)
          const resolved = yield* Discovery.use((discovery) => discovery.resolve(record.provider))
          const url = yield* endpoint.url
          const token = yield* endpoint.mint(sessionId)
          const bare = resolved.adapter.bareOptions({
            agentDirectory: agentDirectoryOf(settings.dataFolder, record.provider),
            systemPrompt: SYSTEM_PROMPT,
            hemera: { url, token },
            own: resolved.own,
          })
          const processScope = yield* Scope.fork(scope)
          const started = yield* Effect.gen(function* () {
            const agent = yield* AgentStarter.use((starter) =>
              starter.start(resolved, { ...resolved.env, ...bare.env }, sessionId),
            )
            const trace = yield* AcpTraces.use((traces) => traces.open(sessionId))
            const connection = yield* connect({
              transport: processTransport(agent, (line) =>
                settings.log(`agent ${record.provider} (${sessionId}): ${line}`),
              ),
              trace,
            })
            const opening = {
              cwd: record.folder,
              mcpServers: bare.mcpServers,
              meta: bare.meta === undefined ? undefined : asJson(bare.meta),
            }
            const { nativeId } = record
            const session =
              nativeId !== null && connection.handshake.resumes
                ? yield* connection.resumeSession(nativeId, opening)
                : nativeId !== null && connection.handshake.loads
                  ? yield* connection.loadSession(nativeId, opening)
                  : yield* connection.newSession(opening)
            return { connection, session }
          }).pipe(Effect.provideService(Scope.Scope, processScope), Effect.provide(context))
          // Codex and OpenCode take the system prompt as the first message's resource.
          const firstBlocks =
            bare.systemPromptAs === 'embedded-resource' && record.nativeId === null
              ? [
                  ResourceBlock.make({
                    uri: 'hemera://system-prompt',
                    mimeType: 'text/plain',
                    text: SYSTEM_PROMPT,
                  }),
                ]
              : []
          const one: Live = {
            connection: started.connection,
            session: started.session,
            scope: processScope,
            turning: false,
            letGo: false,
            firstBlocks,
          }
          live.set(sessionId, one)
          yield* recordNativeSession(sessionId, started.session.nativeSessionId)
          yield* reapplyChoices(sessionId, started.session)
          // A death is an end nobody asked for: the turn closes as interrupted (the client does
          // it), the token is revoked, and the death is told. Nothing starts the agent again here.
          yield* started.connection.gone.pipe(
            Effect.andThen(
              Effect.suspend(() =>
                one.letGo
                  ? Effect.void
                  : Effect.andThen(
                      forget(sessionId, one),
                      PubSub.publish(deaths, AgentDied.make({ sessionId })),
                    ),
              ),
            ),
            Effect.forkIn(scope),
          )
          yield* idle.hold(sessionId, {
            busy: () => one.turning || started.connection.waiting(),
            release: release(sessionId),
          })
          return one
        })

      const running = (sessionId: string) =>
        Effect.suspend(() => {
          const one = live.get(sessionId)
          return one === undefined ? start(sessionId) : Effect.succeed(one)
        })

      const release = (sessionId: string): Effect.Effect<void> =>
        Effect.suspend(() => {
          const one = live.get(sessionId)
          if (one === undefined) return Effect.void
          one.letGo = true
          return Effect.andThen(forget(sessionId, one), Scope.close(one.scope, Exit.void))
        })

      return {
        prompt: (sessionId, blocks) =>
          Effect.gen(function* () {
            const one = yield* running(sessionId)
            const first = one.firstBlocks
            one.firstBlocks = []
            one.turning = true
            const outcome = yield* one.session
              .prompt([...first, ...blocks])
              .pipe(Effect.ensuring(Effect.sync(() => void (one.turning = false))))
            // A turn the agent's death interrupted returns once its token is revoked.
            if (outcome.stopReason === 'interrupted' && !one.letGo) {
              yield* one.connection.gone
              yield* forget(sessionId, one)
            }
            yield* idle.touch(sessionId)
            return outcome
          }).pipe(Effect.provide(context)),
        choose: (sessionId, choice, value) =>
          Effect.gen(function* () {
            const one = yield* running(sessionId)
            yield* chooseOption(sessionId, one.session, choice, value)
          }).pipe(Effect.provide(context)),
        options: (sessionId) =>
          Effect.map(running(sessionId), (one) => one.session.options()).pipe(
            Effect.provide(context),
          ),
        release,
        deaths: Stream.fromPubSub(deaths),
      }
    }),
  )
