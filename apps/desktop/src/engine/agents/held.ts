/**
 * What an agent said that its thread does not hold yet, as the services writing beside it see it.
 *
 * The runtime holds the chunks of a message in memory and writes them on a timer (Decided 10 of
 * #17), and every entry it writes itself goes after them. Two other services write into the same
 * thread while a turn runs — a tool call and a command run (D6-04, D6-12) — and an entry of theirs
 * written while words are held would land above the words the agent said before asking for it.
 * They ask for those words to be written first, through this port.
 *
 * A port of its own rather than the runtime itself, because both of them are services the runtime
 * is built on: the runtime hands its flush over once it exists, and until it does — or in a suite
 * with no agent at all — nothing is held, so there is nothing to write.
 */

import { Context, Effect, Layer } from 'effect'

export interface HeldWordsService {
  /** Writes what the agent of this Session holds, settled, before the caller writes its own. */
  readonly flushed: (sessionId: string) => Effect.Effect<void>
  /** Hands over what writes them: the runtime's own flush, called once it is built. */
  readonly heldBy: (flush: (sessionId: string) => Effect.Effect<void>) => void
}

export class HeldWords extends Context.Service<HeldWords, HeldWordsService>()('HeldWords') {}

export const heldWordsLayer = Layer.sync(HeldWords, () => {
  let flush: ((sessionId: string) => Effect.Effect<void>) | null = null
  return {
    flushed: (sessionId) => Effect.suspend(() => (flush === null ? Effect.void : flush(sessionId))),
    heldBy: (next) => {
      flush = next
    },
  } satisfies HeldWordsService
})
