/**
 * The documenter's passes as they are kept (#146): a pass by its lineage or its Building, the
 * recipes that apply to a mission (its copy's, against its frozen Spec's Impact), and a pass as
 * the Building page reads it. Apart from the documenter's service, so the role's brief, the loop's
 * attribution and the gate's guard read them without importing the sessions.
 */

import {
  DOCUMENTER_PASSES,
  type DocRecipe,
  docRecipeProblem,
  recipeApplies,
} from '@hemera/core/domain'
import type { DocumenterPassView } from '@hemera/ipc'
import { and, asc, eq } from 'drizzle-orm'
import { Effect, Option, Schema } from 'effect'

import { specIn } from '../planning/store.ts'
import { Database, type EngineTransaction, refusedWhile } from '../storage/database.ts'
import { documenterPasses } from '../storage/schema.ts'
import { docRecipesOf, validationSettingsOf } from './validation.ts'

type Reader = EngineTransaction | Database['Service']

export type PassRow = typeof documenterPasses.$inferSelect

export const PASS_STATES = ['waiting_for_slot', 'running', 'reported', 'failed'] as const
export type PassState = (typeof PASS_STATES)[number]

/** A file the brief hands the documenter: where it is, and Git's letter for its change. */
export const PassFile = Schema.Struct({
  repository: Schema.String,
  path: Schema.String,
  status: Schema.String,
})
export type PassFile = typeof PassFile.Type

/** A file the report names, and why. */
export const ReportedFile = Schema.Struct({
  repository: Schema.String,
  path: Schema.String,
  why: Schema.String,
})
export type ReportedFile = typeof ReportedFile.Type

const json = <A, E>(schema: Schema.Codec<A, E>) => {
  const codec = Schema.fromJsonString(schema)
  return {
    read: Schema.decodeUnknownOption(codec),
    write: (value: A): string => Schema.encodeSync(codec)(value),
  }
}

export const passFiles = json(Schema.Array(PassFile))
export const reportedFiles = json(Schema.Array(ReportedFile))

export const filesOfPass = (row: PassRow): ReadonlyArray<PassFile> =>
  Option.getOrElse(passFiles.read(row.files), () => [])

/** Why one more pass cannot run in a Building that has these: a failed pass counts for nothing. */
export const passesSpent = (passes: ReadonlyArray<PassRow>): string | null =>
  passes.filter((one) => one.state !== 'failed').length >= DOCUMENTER_PASSES
    ? 'the documenter already ran twice in this Building'
    : null

/** The passes of a Building, in their order. */
export const passesIn = (reader: Reader, buildingId: string) =>
  reader
    .select()
    .from(documenterPasses)
    .where(eq(documenterPasses.buildingId, buildingId))
    .orderBy(asc(documenterPasses.number))
    .pipe(Effect.mapError(refusedWhile('reading the documenter’s passes')))

/** The pass a lineage runs, or null. */
export const passOfLineage = (reader: Reader, lineage: string) =>
  Effect.map(
    reader
      .select()
      .from(documenterPasses)
      .where(eq(documenterPasses.lineage, lineage))
      .pipe(Effect.mapError(refusedWhile('reading the documenter’s pass'))),
    ([row]) => row ?? null,
  )

/** The passes waiting for a slot or running, in every Building. */
export const passesGoing = (reader: Reader) =>
  Effect.map(
    reader
      .select()
      .from(documenterPasses)
      .orderBy(asc(documenterPasses.startedAt))
      .pipe(Effect.mapError(refusedWhile('reading the documenter’s passes'))),
    (rows) => rows.filter((row) => row.state === 'waiting_for_slot' || row.state === 'running'),
  )

/**
 * The attempt a write of a lineage is attributed to when it runs a pass of the documenter: the
 * pass's `end` attempt named "documentation", while it runs.
 */
export const documentationAttemptIn = (reader: Reader, buildingId: string, lineage: string) =>
  Effect.map(
    reader
      .select({ attemptId: documenterPasses.attemptId })
      .from(documenterPasses)
      .where(
        and(
          eq(documenterPasses.buildingId, buildingId),
          eq(documenterPasses.lineage, lineage),
          eq(documenterPasses.state, 'running'),
        ),
      )
      .pipe(Effect.mapError(refusedWhile('reading the documenter’s pass'))),
    ([row]) => row?.attemptId ?? null,
  )

/**
 * The recipes that apply to a mission: its copy's (never the Project's current ones), each always
 * or when its frozen Spec's Impact names one of its words. A recipe the copy holds that its rules
 * now refuse is left out.
 */
export const applicableRecipes = (missionId: string) =>
  Effect.gen(function* () {
    const copy = yield* validationSettingsOf(missionId)
    if (copy === null) return []
    const database = yield* Database
    const spec = yield* database
      .transaction((transaction) => specIn(transaction, missionId))
      .pipe(Effect.catchTag('UnknownMission', () => Effect.succeed(null)))
    const impact = spec?.sections.find((one) => one.name === 'impact')?.body ?? ''
    return docRecipesOf(copy.sections).filter(
      (recipe: DocRecipe) => docRecipeProblem(recipe) === null && recipeApplies(recipe, impact),
    )
  })

const stateOf = (value: string): PassState => PASS_STATES.find((one) => one === value) ?? 'failed'

/** A pass as the Building and Review pages read it. */
export const passViewOf = (row: PassRow): DocumenterPassView => ({
  id: row.id,
  number: row.number,
  mode: row.mode === 'delta' ? 'delta' : 'full',
  state: stateOf(row.state),
  files: filesOfPass(row),
  attemptId: row.attemptId,
  changed: row.changed === null ? [] : Option.getOrElse(reportedFiles.read(row.changed), () => []),
  noChangeReason: row.noChangeReason,
  evidenceId: row.evidenceId,
  failure: row.failure,
  startedAt: row.startedAt,
  endedAt: row.endedAt,
})
