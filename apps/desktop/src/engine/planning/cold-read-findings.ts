/**
 * The cold read's findings a wave of questions asks from (#91, `ask_wave` with `from_finding`):
 * only a blocking finding on the Spec becomes a question. One about the tasks only is the
 * Planner's to fix, a warning or a suggestion is fixed or left, and a finding is asked once (a
 * question that replaces its question takes it over). Called inside the wave's transaction.
 */

import { and, eq } from 'drizzle-orm'
import { Effect } from 'effect'

import { type EngineTransaction, refusedWhile } from '../storage/database.ts'
import { coldReadFindings, questions } from '../storage/schema.ts'

type FindingRow = typeof coldReadFindings.$inferSelect

export const findingRow = (transaction: EngineTransaction, missionId: string, id: string) =>
  Effect.map(
    transaction
      .select()
      .from(coldReadFindings)
      .where(and(eq(coldReadFindings.missionId, missionId), eq(coldReadFindings.id, id)))
      .pipe(Effect.mapError(refusedWhile('reading a finding'))),
    ([row]): FindingRow | null => row ?? null,
  )

/**
 * The question a finding is asked as now: its question, or the one that replaced it, followed to
 * the last; null when there is none.
 */
export const liveQuestionIn = (transaction: EngineTransaction, missionId: string, id: string) =>
  Effect.gen(function* () {
    const seen = new Set<string>()
    let current = id
    while (!seen.has(current)) {
      seen.add(current)
      const [row] = yield* transaction
        .select({ state: questions.state, replacedBy: questions.replacedBy })
        .from(questions)
        .where(and(eq(questions.missionId, missionId), eq(questions.id, current)))
        .pipe(Effect.mapError(refusedWhile('reading a question')))
      if (row === undefined) return null
      if (row.state !== 'replaced' || row.replacedBy === null) return current
      current = row.replacedBy
    }
    return null
  })

/** Why a question may not be asked from its finding, or null. */
const askRefusal = (
  row: FindingRow | null,
  id: string,
  replaces: string | undefined,
  live: string | null,
) => {
  if (row === null) return `refused: this mission has no finding ${id}.`
  if (row.severity !== 'blocking') {
    return `refused: ${id} is a ${row.severity}: fix it and call cold_read_fixed, or leave it; only a blocking finding becomes a question.`
  }
  if (row.tasksOnly) {
    return `refused: ${id} concerns the tasks only: fix the task graph and call cold_read_fixed; it is never asked to the user.`
  }
  if (row.fate === 'dismissed') return `refused: the user dismissed ${id}: it is not asked.`
  if (row.fate === 'asked' && (replaces === undefined || replaces !== live)) {
    return `refused: ${id} is asked already, as ${live ?? row.questionId ?? 'a question'}.`
  }
  return null
}

/** The wave's questions that come from findings, checked: null when every one may be asked. */
export const findingsAskRefusal = (
  transaction: EngineTransaction,
  missionId: string,
  asked: ReadonlyArray<{
    readonly fromFinding?: string | undefined
    readonly replaces?: string | undefined
  }>,
) =>
  Effect.gen(function* () {
    const named = asked.flatMap((one) =>
      one.fromFinding === undefined ? [] : [{ id: one.fromFinding.trim(), replaces: one.replaces }],
    )
    const ids = named.map((one) => one.id)
    const twice = ids.find((id, at) => ids.indexOf(id) !== at)
    if (twice !== undefined) return `refused: two questions of the wave come from ${twice}.`
    for (const one of named) {
      const row = yield* findingRow(transaction, missionId, one.id)
      const live =
        row === null || row.questionId === null
          ? null
          : yield* liveQuestionIn(transaction, missionId, row.questionId)
      const refused = askRefusal(row, one.id, one.replaces, live)
      if (refused !== null) return refused
    }
    return null
  })

/** Each finding a wave asked from, marked asked with its question. */
export const findingsAskedIn = (
  transaction: EngineTransaction,
  missionId: string,
  pairs: ReadonlyArray<readonly [string, string]>,
) =>
  Effect.forEach(
    pairs,
    ([finding, question]) =>
      transaction
        .update(coldReadFindings)
        .set({ fate: 'asked', questionId: question, changedAt: new Date().toISOString() })
        .where(and(eq(coldReadFindings.missionId, missionId), eq(coldReadFindings.id, finding)))
        .pipe(Effect.mapError(refusedWhile('marking a finding asked'))),
    { discard: true },
  )

/**
 * The findings asked as a question the Planner withdrew, directly or through the questions that
 * replaced theirs: open again, to ask anew or for the user to dismiss.
 */
export const findingsReopenedIn = (
  transaction: EngineTransaction,
  missionId: string,
  withdrawn: string,
) =>
  Effect.gen(function* () {
    const asked = yield* transaction
      .select({ id: coldReadFindings.id, questionId: coldReadFindings.questionId })
      .from(coldReadFindings)
      .where(and(eq(coldReadFindings.missionId, missionId), eq(coldReadFindings.fate, 'asked')))
      .pipe(Effect.mapError(refusedWhile('reading the findings')))
    for (const one of asked) {
      if (one.questionId === null) continue
      if ((yield* liveQuestionIn(transaction, missionId, one.questionId)) !== withdrawn) continue
      yield* transaction
        .update(coldReadFindings)
        .set({ fate: 'open', questionId: null, changedAt: new Date().toISOString() })
        .where(and(eq(coldReadFindings.missionId, missionId), eq(coldReadFindings.id, one.id)))
        .pipe(Effect.mapError(refusedWhile('opening a finding again')))
    }
  })
