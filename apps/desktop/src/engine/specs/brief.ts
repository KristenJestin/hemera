/**
 * The mission brief of a `define` turn (D7-09).
 *
 * Until the agent is handed deliveries at its safe points, the brief rides the turn: the runtime
 * puts this block in front of the user's text and writes it as a folded `hemera` entry, never as
 * a human message. It is composed from the Spec as stored when the turn starts, and lists the
 * sections a human wrote and the questions a human answered since the Session's last brief.
 *
 * `briefed_at` moves only once the turn was accepted (Decided 17), to the moment the brief was
 * composed: a turn that failed before the agent took it leaves the human edits and answers for
 * the next brief, and what was written while the turn ran is listed by the next one.
 */

import { type PhaseId, composeBrief, focusOf, unbriefedEdit } from '@hemera/core'
import { eq } from 'drizzle-orm'
import { Effect } from 'effect'

import { Database } from '../storage/database.ts'
import { sessions } from '../storage/schema.ts'
import { mutate } from '../transaction.ts'
import { failed, now, readSnapshot, reading } from './snapshot.ts'
import { sessionRow } from './write-right.ts'

export interface Brief {
  /** The text that precedes the turn's own. */
  block: string
  /** The phase in focus, which the folded entry is titled with. */
  phase: PhaseId | null
  /** When it was composed, which `briefed` moves `briefed_at` to once the turn is accepted. */
  composedAt: string
}

/** The brief of this Session's next turn, or null when it defines no Spec. */
export function briefFor(sessionId: string) {
  return Effect.gen(function* () {
    // A `free` turn has no brief, and opens no Spec transaction to find that out (Decided 17).
    // The mission is read alone: it only ever goes from `free` to `define`, never back.
    const missions = yield* (yield* Database)
      .select({ mission: sessions.mission })
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .pipe(Effect.mapError(failed('reading the Session')))
    if (missions[0]?.mission !== 'define') return null
    return yield* composed(sessionId)
  })
}

/** The brief of a `define` Session, read from the Spec at one moment. */
function composed(sessionId: string) {
  return reading('composing the mission brief', (transaction) =>
    Effect.gen(function* () {
      const composedAt = now()
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
      if (session?.mission !== 'define' || session.specId === null) return null

      const snapshot = yield* readSnapshot(transaction, session.specId)
      const since = session.briefedAt === null ? null : Date.parse(session.briefedAt)
      const humanEdits = snapshot.sections.filter((section) => unbriefedEdit(section, since))
      // What the human answered in the chat reaches the agent here, "The user answered: …"
      // (D7-01, D7-09).
      const answers = snapshot.questions.filter(
        (question) =>
          question.resolvedAt !== null && (since === null || question.resolvedAt > since),
      )
      const phase = focusOf(snapshot.phases)
      // A reader is told it reads, and who writes, so its agent does not try writes that will be
      // refused (Decided 17).
      const writer = snapshot.spec.writerSessionId
      // Every Spec is born with a writer (Decided 20).
      const readsFrom =
        writer === sessionId || writer === null
          ? undefined
          : (yield* sessionRow(transaction, writer)).title
      const brief: Brief = {
        block: composeBrief({ snapshot, focus: phase, humanEdits, answers, readsFrom }),
        phase,
        composedAt,
      }
      return brief
    }),
  )
}

/** The brief reached the agent: what it listed is not listed again (Decided 17). */
export function briefed(sessionId: string, brief: Brief) {
  return mutate('marking the brief', (transaction) =>
    Effect.gen(function* () {
      yield* transaction
        .update(sessions)
        .set({ briefedAt: brief.composedAt })
        .where(eq(sessions.id, sessionId))
        .pipe(Effect.mapError(failed('marking the brief')))
      return { result: undefined, events: [] }
    }),
  )
}
