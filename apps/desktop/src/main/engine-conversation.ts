/**
 * What the main process says to the one that holds the database, and how it hears back (D3-02).
 *
 * Every answer is one of four things: the value, a refusal that process decided, a silence
 * that lasted too long, or a process that is no longer there. None of those is an exception
 * with no type — the main process is written in Effect precisely so that a cockpit whose
 * database stopped answering says which of the four happened.
 *
 * This file knows nothing of Electron: it is written against the little of a port it uses, so
 * a port that never answers can be handed to it and the waiting watched from outside.
 */

import type { EngineArguments, EngineRequestName, EngineResponse } from '@hemera/ipc'
import { Data, Duration, Effect } from 'effect'

import type { EngineAnswer, EngineRequest } from '../engine/request.ts'

/** How long a use case may take before the silence is reported as one. */
export const PATIENCE = Duration.seconds(5)

/**
 * The use case a failure happened on, carried under a name of its own.
 *
 * Not `name`: an Effect error is an `Error`, whose `name` is the tag the class declares, and a
 * field called `name` takes that tag away — every one of the three would then be written down
 * as the use case it happened on and nothing else, which is the one thing they all share.
 */
interface OnUseCase {
  readonly useCase: string
}

/**
 * The process that holds the database read the message and would not run it.
 *
 * Its reason is carried as `message` rather than under a name of its own: the engine answers
 * a refusal as a sentence written for whoever asked — "the repository location "../elsewhere"
 * is refused: it resolves outside the workspace root" — and that sentence is shown under the
 * field it was typed in. An `Error` already has somewhere to put a sentence, and a field
 * beside an empty `message` is a sentence the page has to know to go and look for.
 */
export class EngineRefused extends Data.TaggedError('EngineRefused')<
  OnUseCase & { readonly message: string }
> {}

/** It did not answer in time, which is an answer and not something to keep waiting for. */
export class EngineTimeout extends Data.TaggedError('EngineTimeout')<OnUseCase> {}

/** It is not there any more, so there is nobody for the message to reach. */
export class EngineGone extends Data.TaggedError('EngineGone')<OnUseCase> {}

/** What a conversation needs of a port, which is all a test has to stand in for. */
export interface EnginePort {
  postMessage: (message: EngineRequest) => void
  on: (event: 'message', listener: (event: { data: EngineAnswer }) => void) => void
  start: () => void
}

/** Asking the process that holds the database, one use case at a time. */
export interface EngineConversation {
  ask: <K extends EngineRequestName>(
    name: K,
    argument: EngineArguments<K>,
  ) => Effect.Effect<EngineResponse<K>, EngineRefused | EngineTimeout | EngineGone>
}

/**
 * The conversation itself: one counter, one listener, one answer per message.
 *
 * Identifiers are a counter rather than anything cleverer because there is exactly one port
 * and one process on the other end of it; two messages can be in flight, and the counter is
 * what tells their answers apart.
 */
export function engineConversation(
  port: EnginePort,
  alive: () => boolean,
  patience: Duration.Duration = PATIENCE,
): EngineConversation {
  const waiting = new Map<number, (answer: EngineAnswer) => void>()
  let next = 0

  port.on('message', (event) => {
    const settle = waiting.get(event.data.id)
    if (settle === undefined) return
    waiting.delete(event.data.id)
    settle(event.data)
  })
  port.start()

  return {
    ask: <K extends EngineRequestName>(name: K, argument: EngineArguments<K>) => {
      const asked = Effect.callback<EngineAnswer, EngineGone>((resume) => {
        if (!alive()) {
          resume(Effect.fail(new EngineGone({ useCase: name })))
          return
        }
        const id = next
        next += 1
        waiting.set(id, (answer) => resume(Effect.succeed(answer)))
        port.postMessage({ id, name, argument })
        return Effect.sync(() => waiting.delete(id))
      })

      return asked.pipe(
        Effect.timeoutOrElse({
          duration: patience,
          orElse: () => Effect.fail(new EngineTimeout({ useCase: name })),
        }),
        Effect.flatMap((answer) =>
          answer.ok
            ? // SAFETY: the answer of the use case `name`, whose response type is
              // `EngineResponse<K>`; the port carries the value, not the type.
              Effect.succeed(answer.value as EngineResponse<K>)
            : Effect.fail(new EngineRefused({ useCase: name, message: answer.error })),
        ),
      )
    },
  }
}
