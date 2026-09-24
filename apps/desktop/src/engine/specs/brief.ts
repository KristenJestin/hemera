/**
 * What a `define` Session's agent is handed of its Spec at a safe point (D7-09, onto D6-08).
 *
 * The mission brief does not ride the prompt: it is a delivery of its own, handed over at the
 * first safe point of the Session, again whenever the revision, the phase in focus or the
 * Session's part — writer or reader — is not what the last brief was composed for, and again to an
 * agent whose own session was opened afresh or rebuilt, which holds none. Between two briefs, what a human wrote into a section and answered in the chat goes
 * the same way, as an `edit` and an `answer` delivery: everything since the agent was last told,
 * in one delivery, a section edited twice listed once as it now reads. Never as a human message.
 *
 * What the last brief was composed for is its `context_deliveries` row: a `brief` row's path names
 * the phase, the revision and the part (`briefKey`). The rows and `briefed_at` are written together once the agent took the delivery
 * (Decided 17), `briefed_at` moving to the moment it was composed: a delivery the agent did not
 * take leaves everything for the next safe point, and what was written meanwhile is listed then.
 */

import {
  type PhaseId,
  type SectionName,
  answersText,
  composeBrief,
  editsText,
  focusOf,
  unbriefedEdit,
} from '@hemera/core'
import { and, desc, eq, sql } from 'drizzle-orm'
import { Effect } from 'effect'

import { fingerprintOf } from '../context/service.ts'
import { Database } from '../storage/database.ts'
import { type ContextDeliveryKind, contextDeliveries, sessions } from '../storage/schema.ts'
import { mutate } from '../transaction.ts'
import { failed, now, readSnapshot, reading } from './snapshot.ts'
import { sessionRow } from './write-right.ts'

export interface Brief {
  /** The text handed over, which the folded entry holds. */
  block: string
  /** The phase in focus, which the folded entry is titled with. */
  phase: PhaseId | null
  /** What it was composed for, which the next brief is measured against (`briefKey`). */
  key: string
}

/**
 * What a brief is composed for: the phase in focus, the revision and whether the Session writes
 * or reads. A change of any of the three is a brief to hand over again — a Rework back on the
 * phase last briefed is a new revision, and a reader that took the write right writes now.
 */
export function briefKey(phase: PhaseId | null, revision: number, reads: boolean): string {
  return `${phase ?? 'no phase'} · revision ${revision} · ${reads ? 'reader' : 'writer'}`
}

/** What waits for a `define` Session's agent: a brief, or the human edits and answers since. */
export interface SpecDelivery {
  /** The mission brief, when one is due; it carries the edits and answers itself. */
  brief: Brief | null
  /** The human edits the agent was not told of, when no brief carries them. */
  edits: { text: string; sections: SectionName[] } | null
  /** The answers the agent was not told of, when no brief carries them. */
  answers: { text: string; questions: string[] } | null
  /** When it was composed, which `briefed` moves `briefed_at` to once the agent took it. */
  composedAt: string
}

/**
 * What this Session's agent is to be handed of its Spec at the next safe point, or null when
 * nothing waits or the Session defines no Spec.
 *
 * `holdsNone` says the agent's own session holds no brief whatever the rows say: it was opened
 * afresh, or rebuilt from the thread, which leaves the brief out.
 */
export function briefFor(sessionId: string, holdsNone = false) {
  return Effect.gen(function* () {
    // A `free` Session has no brief, and opens no Spec transaction to find that out (Decided
    // 17). The mission is read alone: it only ever goes from `free` to `define`, never back.
    const missions = yield* (yield* Database)
      .select({ mission: sessions.mission })
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .pipe(Effect.mapError(failed('reading the Session')))
    if (missions[0]?.mission !== 'define') return null
    return yield* composed(sessionId, holdsNone)
  })
}

/** The Sessions defining a Spec, writer and readers: each is handed what a change of it made wait. */
export function definedBy(specId: string) {
  return Effect.gen(function* () {
    const rows = yield* (yield* Database)
      .select({ id: sessions.id })
      .from(sessions)
      .where(and(eq(sessions.specId, specId), eq(sessions.mission, 'define')))
      .pipe(Effect.mapError(failed('reading the Sessions of a Spec')))
    return rows.map((row) => row.id)
  })
}

/** What waits for a `define` Session, read from the Spec at one moment. */
function composed(sessionId: string, holdsNone: boolean) {
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
      const last = yield* transaction
        .select({ path: contextDeliveries.path })
        .from(contextDeliveries)
        .where(and(eq(contextDeliveries.sessionId, sessionId), eq(contextDeliveries.kind, 'brief')))
        .orderBy(desc(contextDeliveries.deliveredAt), desc(sql`rowid`))
        .limit(1)
        .pipe(Effect.mapError(failed('reading the last brief')))

      // A reader is told it reads, and who writes, so its agent does not try writes that will be
      // refused (Decided 17). Every Spec is born with a writer (Decided 20).
      const writer = snapshot.spec.writerSessionId
      const writerOther = writer === sessionId ? null : writer
      const key = briefKey(phase, snapshot.revision.number, writerOther !== null)

      if (!holdsNone && last[0]?.path === key) {
        if (humanEdits.length === 0 && answers.length === 0) return null
        const between: SpecDelivery = {
          brief: null,
          edits:
            humanEdits.length === 0
              ? null
              : { text: editsText(humanEdits), sections: humanEdits.map((one) => one.name) },
          answers:
            answers.length === 0
              ? null
              : { text: answersText(answers), questions: answers.map((one) => one.body) },
          composedAt,
        }
        return between
      }

      const readsFrom =
        writerOther === null ? undefined : (yield* sessionRow(transaction, writerOther)).title
      const brief: SpecDelivery = {
        brief: {
          block: composeBrief({ snapshot, focus: phase, humanEdits, answers, readsFrom }),
          phase,
          key,
        },
        edits: null,
        answers: null,
        composedAt,
      }
      return brief
    }),
  )
}

/**
 * The agent took the delivery: what it listed is not listed again, and a brief's key is what the
 * next is measured against (Decided 17). One row per kind it carried, in the same transaction.
 */
export function briefed(sessionId: string, delivery: SpecDelivery) {
  return mutate('marking the brief', (transaction) =>
    Effect.gen(function* () {
      yield* transaction
        .update(sessions)
        .set({ briefedAt: delivery.composedAt })
        .where(eq(sessions.id, sessionId))
        .pipe(Effect.mapError(failed('marking the brief')))
      const given: { kind: ContextDeliveryKind; path: string; text: string }[] = []
      if (delivery.brief !== null) {
        given.push({ kind: 'brief', path: delivery.brief.key, text: delivery.brief.block })
      }
      if (delivery.edits !== null) given.push({ kind: 'edit', path: '', text: delivery.edits.text })
      if (delivery.answers !== null) {
        given.push({ kind: 'answer', path: '', text: delivery.answers.text })
      }
      const deliveredAt = now()
      yield* transaction
        .insert(contextDeliveries)
        .values(
          given.map((one) => ({
            id: crypto.randomUUID(),
            sessionId,
            kind: one.kind,
            path: one.path,
            fingerprint: fingerprintOf(one.text),
            deliveredAt,
          })),
        )
        .pipe(Effect.mapError(failed('recording what was delivered')))
      return { result: undefined, events: [] }
    }),
  )
}
