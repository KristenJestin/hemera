/**
 * What the process that holds the database decides about a message before anything runs (D3-02).
 *
 * The same discipline as the bridge the page is held to, minus the one question that has no
 * meaning here: a `MessagePort` has exactly one possible sender, so there is no origin to
 * check. What is left is the name and the schema — a message whose name is not declared, or
 * whose argument does not satisfy the schema of that name, is refused with a reason that says
 * which use case and which field, and no service is ever reached.
 *
 * Nothing here knows about Electron or about a port, so all of it runs in a plain Node test.
 */

import {
  ENGINE_REQUESTS,
  type EngineArguments,
  type EngineRequestName,
  type EngineResponse,
} from '@hemera/ipc'
import { Effect } from 'effect'

import type {
  EmptyMessageError,
  EmptyTitleError,
  InvalidProjectNameError,
  InvalidRepositoryPathError,
} from '@hemera/core'

import { type AgentOption } from './agents/client.ts'
import { AgentRuntime, type AgentRuntimeError } from './agents/runtime.ts'
import { Agents, availabilityOf, type AgentUpdateRefusedError } from './agents/service.ts'
import { Discovery } from './agents/discovery.ts'
import { type InvalidCursorError, Journal } from './journal.ts'
import { Preferences } from './preferences.ts'
import { Projects, type UnknownProjectError } from './projects.ts'
import { Sessions, type UnknownSessionError } from './sessions.ts'
import { EngineStatus } from './status.ts'
import type { DatabaseError } from './storage/database.ts'
import type { StaleVersionError } from './transaction.ts'

/**
 * The options an agent announced, in the page's words.
 *
 * The engine holds an option as a value with a kind, and what crosses is the list of values the
 * agent announced and the one it is on now, which is what the composer draws (D5-13). Asked of a
 * Session and asked of a Project that has none yet, the shape crossing the port is the same.
 */
function announced(options: readonly AgentOption[]) {
  return options.map((option) => ({
    id: option.id,
    name: option.name,
    category: option.category,
    values: option.values.map((value) => ({ value: value.id, name: value.name })),
    current: option.value,
  }))
}

/** What the main process sends: an identifier to answer, a use case, and its argument. */
export interface EngineRequest {
  id: number
  name: string
  // oxlint-disable-next-line anti-slop/no-unknown-type-aliases -- what arrives is unparsed by definition; `decideRequest` is what parses it
  argument: unknown
}

/** What goes back, on the identifier it came in on. */
export type EngineAnswer<K extends EngineRequestName = EngineRequestName> =
  | { id: number; ok: true; value: EngineResponse<K> }
  | { id: number; ok: false; error: string }

/**
 * One accepted message: a use case, and the argument that use case takes.
 *
 * Written as a union of one member per use case rather than as one member with two independent
 * unions in it. Those are not the same type: with the second, a name narrowed to
 * `journal.markSeen` leaves the argument as every argument any use case takes, and the thing
 * that routes them cannot ask it for a cursor. Here, narrowing the name narrows the argument
 * with it, which is what makes a router of fourteen use cases type at all.
 */
export type AcceptedRequest = {
  [K in EngineRequestName]: { accepted: true; name: K; argument: EngineArguments<K> }
}[EngineRequestName]

export type RequestDecision<K extends EngineRequestName> =
  | Extract<AcceptedRequest, { name: K }>
  | { accepted: false; reason: string }

function isDeclared(name: string): name is EngineRequestName {
  return Object.hasOwn(ENGINE_REQUESTS, name)
}

export function decideRequest(
  name: string,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the I/O boundary itself: the one place a message is still unparsed
  argument: unknown,
): RequestDecision<EngineRequestName> {
  if (!isDeclared(name)) {
    return { accepted: false, reason: `${name}: refused a use case that is not declared` }
  }

  const read = ENGINE_REQUESTS[name].arguments.safeParse(argument)
  if (!read.success) {
    const issue = read.error.issues[0]
    const field =
      issue === undefined || issue.path.length === 0 ? 'its argument' : issue.path.join('.')
    return {
      accepted: false,
      reason: `${name}: refused a message whose ${field} does not match the use case (${issue?.message ?? 'no detail'})`,
    }
  }
  // SAFETY: `read.data` is the output of `ENGINE_REQUESTS[name].arguments`, the schema that
  // defines the argument of this very name; TypeScript cannot carry the key through the lookup,
  // so the pair is asserted together rather than the argument alone.
  return { accepted: true, name, argument: read.data } as AcceptedRequest
}

/**
 * The use case itself, once the message has been read and accepted.
 *
 * Each one is a function of a service, so what this does is choose which and hand it what it
 * was given. Nothing is validated again here: a decision is what stands between a message and
 * this function, and there is no other way in.
 */
export function answer(
  decision: AcceptedRequest,
): Effect.Effect<
  EngineResponse<EngineRequestName>,
  Refusal,
  Preferences | EngineStatus | Projects | Journal | Sessions | Discovery | AgentRuntime | Agents
> {
  return Effect.gen(function* () {
    if (decision.name === 'engine.status') return yield* (yield* EngineStatus).read

    if (decision.name === 'preferences.read') return yield* (yield* Preferences).read
    if (decision.name === 'preferences.write') {
      return yield* (yield* Preferences).write(decision.argument)
    }

    if (decision.name === 'journal.read') return yield* (yield* Journal).read(decision.argument)
    if (decision.name === 'journal.unseen') {
      const unseen = yield* (yield* Journal).unseen
      // A Map does not survive being sent, so the counts cross as the pairs they are.
      return { entries: unseen.entries, byProject: [...unseen.byProject] }
    }
    if (decision.name === 'journal.markSeen') {
      return yield* (yield* Journal).markSeen(decision.argument.upTo)
    }

    const sessions = yield* Sessions
    if (decision.name === 'sessions.list') {
      return yield* sessions.list(decision.argument.projectId, decision.argument.archived)
    }
    if (decision.name === 'sessions.create') {
      // The agent the Session is made with crosses with the Project (D5-06): it is chosen once,
      // in the composer that starts it, and every turn of that Session runs it.
      const { projectId, provider } = decision.argument
      return yield* sessions.create(projectId, provider)
    }
    if (decision.name === 'sessions.rename') {
      const { id, version, title } = decision.argument
      return yield* sessions.rename(id, version, title)
    }
    if (decision.name === 'sessions.archive') {
      return yield* sessions.archive(decision.argument.id, decision.argument.version)
    }
    if (decision.name === 'sessions.restore') {
      return yield* sessions.restore(decision.argument.id, decision.argument.version)
    }
    if (decision.name === 'sessions.append') {
      const { sessionId, body } = decision.argument
      return yield* sessions.append(sessionId, body)
    }
    if (decision.name === 'sessions.read') {
      const { sessionId, before, limit } = decision.argument
      return yield* sessions.read(sessionId, before, limit)
    }

    const projects = yield* Projects
    if (decision.name === 'projects.list') {
      return yield* projects.list(decision.argument.includeArchived)
    }
    if (decision.name === 'projects.create') return yield* projects.create(decision.argument)
    if (decision.name === 'projects.update') return yield* projects.update(decision.argument)
    if (decision.name === 'projects.moveMain') {
      const { id, version, path } = decision.argument
      return yield* projects.moveMain(id, version, path)
    }
    if (decision.name === 'projects.archive') {
      return yield* projects.archive(decision.argument.id, decision.argument.version)
    }
    if (decision.name === 'projects.restore') {
      return yield* projects.restore(decision.argument.id, decision.argument.version)
    }
    if (decision.name === 'repositories.add') {
      const { id, version, relativePath } = decision.argument
      return yield* projects.addRepository(id, version, relativePath)
    }
    if (decision.name === 'agents.list') {
      const discovery = yield* Discovery
      // Every agent the machine has, as the settings page shows it. `path` is where the command
      // resolved, which is the engine's own business: what crosses is the availability, and
      // whether the agent is signed in is what the agent itself reports when a Session starts it
      // (D5-17) — this page starts nothing, so it says false rather than guessing. Nobody has
      // asked a registry here: this list is read off the machine, and `latest` stays null until
      // the Agents section of the settings is opened and asks for itself (D5-18).
      const found = yield* discovery.list()
      return { agents: found.map((agent) => availabilityOf(agent, null)) }
    }

    const runtime = yield* AgentRuntime
    if (decision.name === 'agents.options') {
      const offered = yield* runtime.options(decision.argument.sessionId)
      return { options: announced(offered) }
    }
    if (decision.name === 'agents.offer') {
      // What an agent offers a Project that no Session holds yet (D5-17): the Home's composer
      // has the agent to choose and its own controls before anything is written.
      const { projectId, provider } = decision.argument
      const offered = yield* runtime.offer(projectId, provider)
      return { options: announced(offered) }
    }
    if (decision.name === 'agents.setOption') {
      const { sessionId, optionId, value } = decision.argument
      return yield* runtime.setOption(sessionId, optionId, value)
    }
    if (decision.name === 'agents.prompt') {
      const { sessionId, text } = decision.argument
      // What the page is waiting for is why the turn ended; everything else about it reached the
      // window as it happened, on the engine's own channel (design D5-12).
      const report = yield* runtime.prompt(sessionId, text)
      return { stopReason: report.stopReason }
    }
    if (decision.name === 'agents.stop') return yield* runtime.stop(decision.argument.sessionId)
    if (decision.name === 'agents.decide') {
      const { sessionId, optionId } = decision.argument
      return yield* runtime.decide(sessionId, optionId)
    }
    if (decision.name === 'agents.resume') {
      const report = yield* runtime.resume(decision.argument.sessionId)
      return { state: report.state, reason: report.reason }
    }

    // What the Agents section asks about the three agents of this machine, and the one thing it
    // does about the answer (design D5-18). The check is the only use case of this process that
    // leaves the machine, and the update is the only one that changes what is installed:
    // neither happens on its own, and both are asked for by somebody pressing something.
    if (decision.name === 'agents.check') {
      const agents = yield* Agents
      return { agents: yield* agents.check() }
    }
    if (decision.name === 'agents.update') {
      const agents = yield* Agents
      return yield* agents.update(decision.argument.id)
    }

    const { id, version, relativePath } = decision.argument
    return yield* projects.removeRepository(id, version, relativePath)
  })
}

/**
 * Everything a use case of this process can refuse with.
 *
 * Named rather than inferred, because it is the contract the main process answers on: a refusal
 * crossing to the renderer is one of these, and adding a new one is a decision rather than
 * something that happens by writing a service.
 */
export type Refusal =
  | AgentRuntimeError
  | AgentUpdateRefusedError
  | DatabaseError
  | StaleVersionError
  | UnknownProjectError
  | UnknownSessionError
  | InvalidCursorError
  | InvalidProjectNameError
  | InvalidRepositoryPathError
  | EmptyMessageError
  | EmptyTitleError
