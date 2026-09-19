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

import type { InvalidProjectNameError, InvalidRepositoryPathError } from '@hemera/core'

import { type InvalidCursorError, Journal } from './journal.ts'
import { Preferences } from './preferences.ts'
import { Projects, type UnknownProjectError } from './projects.ts'
import { EngineStatus } from './status.ts'
import type { DatabaseError } from './storage/database.ts'
import type { StaleVersionError } from './transaction.ts'

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
  Preferences | EngineStatus | Projects | Journal
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
  | DatabaseError
  | StaleVersionError
  | UnknownProjectError
  | InvalidCursorError
  | InvalidProjectNameError
  | InvalidRepositoryPathError
