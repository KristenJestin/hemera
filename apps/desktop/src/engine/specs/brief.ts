/**
 * The mission brief of a `define` turn (D7-09).
 *
 * Until the agent is handed deliveries at its safe points, the brief rides the turn: the runtime
 * puts this block in front of the user's text and writes it as a folded `hemera` entry, never as
 * a human message. It is composed from the Spec as stored when the turn starts, and lists the
 * sections a human wrote and the questions a human answered since the Session's last brief;
 * `briefed_at` moves in the same transaction, so an edit or an answer is briefed once.
 */

import { type PhaseId, composeBrief, focusOf } from '@hemera/core'
import { eq } from 'drizzle-orm'
import { Effect } from 'effect'

import { sessions } from '../storage/schema.ts'
import { mutate } from '../transaction.ts'
import { failed, now, readSnapshot } from './snapshot.ts'

export interface Brief {
  /** The text that precedes the turn's own. */
  block: string
  /** The phase in focus, which the folded entry is titled with. */
  phase: PhaseId | null
}

/** The brief of this Session's next turn, or null when it defines no Spec. */
export function briefFor(sessionId: string) {
  return mutate('composing the mission brief', (transaction) =>
    Effect.gen(function* () {
      const rows = yield* transaction
        .select({
          mission: sessions.mission,
          specId: sessions.specId,
          briefedAt: sessions.briefedAt,
        })
        .from(sessions)
        .where(eq(sessions.id, sessionId))
        .pipe(Effect.mapError(failed('reading the Session')))
      const session = rows[0]
      if (session?.mission !== 'define' || session.specId === null) {
        return { result: null, events: [] }
      }

      const snapshot = yield* readSnapshot(transaction, session.specId)
      const since = session.briefedAt === null ? null : Date.parse(session.briefedAt)
      const humanEdits = snapshot.sections.filter(
        (section) =>
          section.author === 'human' &&
          (since === null || section.updatedAt > since) &&
          // A section still as the Spec's creation left it, empty, is not an edit.
          (section.body !== '' || section.version > 1),
      )
      // What the human answered in the chat reaches the agent here, "The user answered: …"
      // (D7-01, D7-09).
      const answers = snapshot.questions.filter(
        (question) =>
          question.resolvedAt !== null && (since === null || question.resolvedAt > since),
      )
      const phase = focusOf(snapshot.phases)
      yield* transaction
        .update(sessions)
        .set({ briefedAt: now() })
        .where(eq(sessions.id, sessionId))
        .pipe(Effect.mapError(failed('marking the brief')))
      const brief: Brief = {
        block: composeBrief({ snapshot, focus: phase, humanEdits, answers }),
        phase,
      }
      return { result: brief, events: [] }
    }),
  )
}
