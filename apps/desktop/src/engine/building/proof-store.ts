/**
 * The proofs of a Building as they are kept (#144): each scenario's state, its runs, and the
 * current tree of each repository of the mission's Workspace that tells a proof or a check up to
 * date (CT-38). Everything here reads or writes in a reader or a transaction; nothing here runs.
 *
 * - **The current tree** is the last #140 snapshot of the repository, whatever took it: an
 *   attempt's end, a check's or a proof's run, the detector of changes outside Hemera, a refresh.
 *   A Freeze's snapshot is of the main checkout, never of the Workspace, and is left out.
 * - **Stale.** When the current tree of a repository changes, a green proof that ran on another
 *   tree of it is `to_rerun`, and a manual proof given on another tree is `to_verify` again; one
 *   `building.proof_stale` says which. A final check is up to date while its trees are current.
 */

import {
  type ProofMode,
  PROOF_CLASSES,
  PROOF_PHASES,
  SCENARIO_PROOF_STATES,
  type ScenarioProofState,
} from '@hemera/core/domain'
import type { BuildingView, ProofRunView, ProofsView, ScenarioProofView } from '@hemera/ipc'
import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import { Effect, Option, Schema } from 'effect'

import type { NewEvent } from '../journal.ts'
import { type Database, type EngineTransaction, refusedWhile } from '../storage/database.ts'
import {
  buildingAttempts,
  buildingCheckResults,
  buildings,
  proofRuns,
  repositoryTrees,
  scenarioProofs,
  writesBeforeRed,
} from '../storage/schema.ts'

type Reader = EngineTransaction | Database['Service']
export type ScenarioProofRow = typeof scenarioProofs.$inferSelect
type ProofRunRow = typeof proofRuns.$inferSelect

export interface Tree {
  readonly repository: string
  readonly tree: string
}

const Trees = Schema.fromJsonString(
  Schema.Array(Schema.Struct({ repository: Schema.String, tree: Schema.String })),
)
export const writeTrees = Schema.encodeSync(Trees)
export const readTrees = (text: string | null): ReadonlyArray<Tree> =>
  text === null ? [] : Option.getOrElse(Schema.decodeUnknownOption(Trees)(text), () => [])

const now = (): string => new Date().toISOString()

const readScenarios = (text: string): ReadonlyArray<string> =>
  Option.getOrElse(
    Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Array(Schema.String)))(text),
    () => [],
  )

export const stateOf = (row: { readonly state: string }): ScenarioProofState =>
  SCENARIO_PROOF_STATES.find((one) => one === row.state) ?? 'waiting_red'

export const modeOf = (row: { readonly mode: string }): ProofMode =>
  row.mode === 'by_hand' ? 'by_hand' : 'automated'

/** The proofs of a Building, in the order of the Spec. */
export const scenarioProofsIn = (reader: Reader, buildingId: string) =>
  reader
    .select()
    .from(scenarioProofs)
    .where(eq(scenarioProofs.buildingId, buildingId))
    .orderBy(asc(scenarioProofs.rank))
    .pipe(Effect.mapError(refusedWhile('reading the proofs')))

/** One scenario's proof in a Building, or null. */
export const scenarioProofIn = (reader: Reader, buildingId: string, scenario: string) =>
  Effect.map(
    reader
      .select()
      .from(scenarioProofs)
      .where(and(eq(scenarioProofs.buildingId, buildingId), eq(scenarioProofs.scenario, scenario)))
      .pipe(Effect.mapError(refusedWhile('reading a proof'))),
    ([row]) => row ?? null,
  )

/** A scenario's proof moved, with whatever else it holds now. */
export const setProofIn = (
  transaction: EngineTransaction,
  buildingId: string,
  scenario: string,
  set: Partial<Omit<ScenarioProofRow, 'buildingId' | 'scenario' | 'updatedAt'>>,
) =>
  transaction
    .update(scenarioProofs)
    .set({ ...set, updatedAt: now() })
    .where(and(eq(scenarioProofs.buildingId, buildingId), eq(scenarioProofs.scenario, scenario)))
    .pipe(Effect.mapError(refusedWhile('moving a proof')), Effect.asVoid)

/** The runs of a Building's proofs, in the order they ran. */
export const proofRunsIn = (reader: Reader, buildingId: string) =>
  reader
    .select()
    .from(proofRuns)
    .where(eq(proofRuns.buildingId, buildingId))
    .orderBy(asc(proofRuns.at))
    .pipe(Effect.mapError(refusedWhile('reading the proof runs')))

/** The current tree of each repository of the mission's Workspace. */
export const currentTreesIn = (reader: Reader, missionId: string) =>
  Effect.map(
    reader
      .select({ repository: repositoryTrees.repository, tree: repositoryTrees.tree })
      .from(repositoryTrees)
      .where(eq(repositoryTrees.missionId, missionId))
      .pipe(Effect.mapError(refusedWhile('reading the current trees'))),
    (rows) => new Map(rows.map((row) => [row.repository, row.tree])),
  )

/** Whether trees recorded are still the current ones; a repository never snapshotted since is. */
export const upToDate = (
  trees: ReadonlyArray<Tree>,
  current: ReadonlyMap<string, string>,
  only: ReadonlyArray<string> | null = null,
): boolean =>
  trees.every(
    (one) =>
      (only !== null && !only.includes(one.repository)) ||
      (current.get(one.repository) ?? one.tree) === one.tree,
  )

/**
 * A snapshot taken of a repository of the mission's Workspace (#140), begun at `takenAt`: its tree
 * is the current one unless a later snapshot already said otherwise. When it changed, the proofs
 * that ran or were given on another tree of it go stale.
 */
export const recordTreeIn = (
  transaction: EngineTransaction,
  missionId: string,
  repository: string,
  tree: string,
  takenAt: string,
) =>
  Effect.gen(function* () {
    const [known] = yield* transaction
      .select()
      .from(repositoryTrees)
      .where(
        and(eq(repositoryTrees.missionId, missionId), eq(repositoryTrees.repository, repository)),
      )
      .pipe(Effect.mapError(refusedWhile('reading the current tree')))
    if (known !== undefined && known.takenAt > takenAt) return []
    yield* transaction
      .insert(repositoryTrees)
      .values({ missionId, repository, tree, takenAt })
      .onConflictDoUpdate({
        target: [repositoryTrees.missionId, repositoryTrees.repository],
        set: { tree, takenAt },
      })
      .pipe(Effect.mapError(refusedWhile('recording the current tree')))
    if (known?.tree === tree) return []
    const [building] = yield* transaction
      .select({ id: buildings.id })
      .from(buildings)
      .where(eq(buildings.missionId, missionId))
      .orderBy(desc(buildings.startedAt))
      .limit(1)
      .pipe(Effect.mapError(refusedWhile('reading the Building')))
    if (building === undefined) return []
    const rows = yield* scenarioProofsIn(transaction, building.id)
    const greens = rows.filter((row) => stateOf(row) === 'green' && row.greenRunId !== null)
    const runs =
      greens.length === 0
        ? []
        : yield* transaction
            .select({ id: proofRuns.id, trees: proofRuns.trees })
            .from(proofRuns)
            .where(
              inArray(
                proofRuns.id,
                greens.map((row) => row.greenRunId ?? ''),
              ),
            )
            .pipe(Effect.mapError(refusedWhile('reading the green runs')))
    const differs = (trees: ReadonlyArray<Tree>) =>
      trees.some((one) => one.repository === repository && one.tree !== tree)
    const stale: string[] = []
    const again: string[] = []
    for (const row of greens) {
      const run = runs.find((one) => one.id === row.greenRunId)
      if (run === undefined || !differs(readTrees(run.trees))) continue
      yield* setProofIn(transaction, building.id, row.scenario, { state: 'to_rerun' })
      stale.push(row.scenario)
    }
    for (const row of rows) {
      const state = stateOf(row)
      if (state !== 'validated' && state !== 'refused') continue
      if (!differs(readTrees(row.trees))) continue
      yield* setProofIn(transaction, building.id, row.scenario, { state: 'to_verify' })
      again.push(row.scenario)
    }
    if (stale.length === 0 && again.length === 0) return []
    const event: NewEvent = {
      type: 'building.proof_stale',
      entityKind: 'mission',
      entityId: missionId,
      source: 'system',
      author: 'hemera',
      payload: { repository, scenarios: stale, manual: again },
    }
    return [event]
  })

const runViewOf = (row: ProofRunRow): ProofRunView => ({
  id: row.id,
  phase: PROOF_PHASES.find((one) => one === row.phase) ?? 'red',
  line: row.line,
  testPath: row.testPath,
  testSha256: row.testSha256,
  exitCode: row.exitCode,
  classification: PROOF_CLASSES.find((one) => one === row.classification) ?? 'error_before_test',
  failingTest: row.failingTest,
  assertion: row.assertion,
  keyLineMatched: row.keyLineMatched,
  outputTail: row.outputTail,
  evidenceId: row.evidenceId,
  testEvidenceId: row.testEvidenceId,
  runId: row.runId,
  trees: readTrees(row.trees),
  at: row.at,
})

/** A scenario's proof as the pages read it, its runs given. */
const scenarioViewOf = (
  row: ScenarioProofRow,
  runs: ReadonlyArray<ProofRunRow>,
  current: ReadonlyMap<string, string>,
): ScenarioProofView => {
  const red = runs.find((one) => one.id === row.redRunId) ?? null
  const green = runs.find((one) => one.id === row.greenRunId) ?? null
  const state = stateOf(row)
  return {
    scenario: row.scenario,
    requirement: row.requirement,
    mode: modeOf(row),
    state,
    red: red === null ? null : runViewOf(red),
    green: green === null ? null : runViewOf(green),
    upToDate:
      green === null ? null : state === 'green' && upToDate(readTrees(green.trees), current),
    testChanged: red !== null && green !== null && red.testSha256 !== green.testSha256,
    manual:
      (state === 'validated' || state === 'refused') && row.judgedAt !== null
        ? {
            verdict: state,
            by: row.judgedBy ?? 'user',
            at: row.judgedAt,
            note: row.note,
            trees: readTrees(row.trees),
          }
        : null,
  }
}

/** A scenario's proof as the pages read it. */
export const scenarioViewIn = (reader: Reader, missionId: string, row: ScenarioProofRow) =>
  Effect.gen(function* () {
    const runs = (yield* proofRunsIn(reader, row.buildingId)).filter(
      (one) => one.scenario === row.scenario,
    )
    return scenarioViewOf(row, runs, yield* currentTreesIn(reader, missionId))
  })

/**
 * Every automated scenario of a requirement green and up to date: proven. One set aside as not
 * reproducible does not count: the others prove it.
 */
const provenOf = (scenarios: ReadonlyArray<ScenarioProofView>): boolean => {
  const automated = scenarios.filter(
    (one) => one.mode === 'automated' && one.state !== 'not_reproducible',
  )
  return automated.length > 0 && automated.every((one) => one.upToDate === true)
}

/** What `building.read` adds to each requirement: its scenarios' proofs, and whether it is proven. */
export const requirementProofsIn = (reader: Reader, missionId: string, buildingId: string) =>
  Effect.gen(function* () {
    const rows = yield* scenarioProofsIn(reader, buildingId)
    const runs = yield* proofRunsIn(reader, buildingId)
    const current = yield* currentTreesIn(reader, missionId)
    const views = rows.map((row) =>
      scenarioViewOf(
        row,
        runs.filter((one) => one.scenario === row.scenario),
        current,
      ),
    )
    return (
      requirement: string,
    ): Omit<BuildingView['requirements'][number], 'id' | 'done' | 'tasks'> => {
      const scenarios = views.filter((one) => one.requirement === requirement)
      const byHand = scenarios.filter((one) => one.mode === 'by_hand')
      return {
        proven: provenOf(scenarios),
        scenarios,
        byHand: {
          total: byHand.length,
          validated: byHand.filter((one) => one.state === 'validated').length,
        },
      }
    }
  })

/** Whether a requirement is proven now: what `building.requirement_proven` waits for. */
export const requirementProvenIn = (
  reader: Reader,
  missionId: string,
  buildingId: string,
  requirement: string,
) => Effect.map(requirementProofsIn(reader, missionId, buildingId), (of) => of(requirement).proven)

/** The final checks' results of a Building, the latest per check and place, and their freshness. */
export const finalChecksIn = (reader: Reader, missionId: string, buildingId: string) =>
  Effect.gen(function* () {
    const results = yield* reader
      .select({
        name: buildingCheckResults.name,
        place: buildingCheckResults.place,
        verdict: buildingCheckResults.verdict,
        trees: buildingCheckResults.trees,
        at: buildingCheckResults.at,
      })
      .from(buildingCheckResults)
      .innerJoin(buildingAttempts, eq(buildingAttempts.id, buildingCheckResults.attemptId))
      .where(and(eq(buildingAttempts.buildingId, buildingId), eq(buildingAttempts.scope, 'end')))
      .orderBy(asc(buildingCheckResults.at))
      .pipe(Effect.mapError(refusedWhile('reading the final checks')))
    const current = yield* currentTreesIn(reader, missionId)
    const latest = new Map<string, (typeof results)[number]>()
    for (const one of results) latest.set(`${one.name}\u0000${one.place}`, one)
    return [...latest.values()].map((one) => ({
      name: one.name,
      place: one.place,
      verdict: one.verdict,
      trees: readTrees(one.trees),
      upToDate: upToDate(readTrees(one.trees), current),
    }))
  })

/** What Review shows of a Building's proofs (R10): each scenario with every run, the final checks. */
export const proofsViewIn = (reader: Reader, missionId: string, buildingId: string) =>
  Effect.gen(function* () {
    const rows = yield* scenarioProofsIn(reader, buildingId)
    const runs = yield* proofRunsIn(reader, buildingId)
    const current = yield* currentTreesIn(reader, missionId)
    const checks = yield* finalChecksIn(reader, missionId, buildingId)
    const early = yield* reader
      .select()
      .from(writesBeforeRed)
      .where(eq(writesBeforeRed.buildingId, buildingId))
      .orderBy(asc(writesBeforeRed.at))
      .pipe(Effect.mapError(refusedWhile('reading the writes before the red')))
    const view: ProofsView = {
      missionId,
      scenarios: rows.map((row) => {
        const own = runs.filter((one) => one.scenario === row.scenario)
        return Object.assign(scenarioViewOf(row, own, current), { runs: own.map(runViewOf) })
      }),
      finalChecks: checks.map(({ trees: _trees, ...rest }) => rest),
      writtenBeforeRed: early.map((one) => ({
        repository: one.repository,
        path: one.path,
        task: one.taskId,
        scenarios: readScenarios(one.scenarios),
        at: one.at,
      })),
    }
    return view
  })
