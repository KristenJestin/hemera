/**
 * The proofs, the tasks and the recommended model of a mission's Spec (#90), as the database keeps
 * them, and what Git says of them at each repository's base commit.
 *
 * What Git says is read outside any transaction: whether each file a proof inserts goes in at the
 * base commit (a new file where nothing is, a patch that applies, CT-37), and whether each target
 * of a task is as its intent says (CT-30). "The base commit" before Freeze is each repository's
 * up-to-date base by #5's rule (CT-24): a write reads the tracking ref last fetched; a declaration
 * fetches each repository once first.
 */

import {
  type CompletenessFailure,
  type InsertedFile,
  Proof,
  type ProofSeen,
  type TaskTarget,
  TaskTarget as TaskTargetSchema,
  insertedFiles,
  missionKey,
  proofSeen,
} from '@hemera/core/domain'
import type { ModelRecommendationSeen, SpecTask, TaskGraph } from '@hemera/ipc'
import { UnknownMission } from '@hemera/ipc'
import { and, asc, eq } from 'drizzle-orm'
import { Effect, Option, Schema } from 'effect'
import { join } from 'node:path'

import { Git, type GitRefusal } from '../git.ts'
import { upToDateBase } from '../repositories.ts'
import { Database, type EngineTransaction, refusedWhile } from '../storage/database.ts'
import {
  missionRecommendations,
  missions,
  projectRepositories,
  projects,
  specProofs,
  specRequirements,
  specScenarios,
  specTasks,
  specs,
} from '../storage/schema.ts'

const ProofJson = Schema.fromJsonString(Proof)
export const readProof = Schema.decodeUnknownOption(ProofJson)
const Strings = Schema.fromJsonString(Schema.Array(Schema.String))
const readStrings = Schema.decodeUnknownOption(Strings)
export const writeStrings = Schema.encodeSync(Strings)
const Targets = Schema.fromJsonString(Schema.Array(TaskTargetSchema))
const readTargets = Schema.decodeUnknownOption(Targets)
export const writeTargets = Schema.encodeSync(Targets)

const stringsOf = (text: string): ReadonlyArray<string> =>
  Option.getOrElse(readStrings(text), () => [])

type TaskRow = typeof specTasks.$inferSelect

export const taskOf = (row: TaskRow): SpecTask => ({
  id: row.id,
  title: row.title,
  result: row.result,
  requirements: stringsOf(row.requirements),
  scenarios: stringsOf(row.scenarios),
  targets: Option.getOrElse(readTargets(row.targets), () => []),
  dependsOn: stringsOf(row.dependsOn),
})

const AGENTS = ['claude', 'codex', 'opencode'] as const

export const recommendationOf = (
  row: typeof missionRecommendations.$inferSelect,
): ModelRecommendationSeen => ({
  agent: AGENTS.find((one) => one === row.agent) ?? 'claude',
  model: row.model,
  effort: row.effort,
  reason: row.reason,
  checked: row.checked,
  at: row.at,
})

/** A mission's proofs (whole) by scenario, its live tasks in order, and its recommendation. */
export const planRows = (transaction: EngineTransaction, missionId: string) =>
  Effect.gen(function* () {
    const proofRows = yield* transaction
      .select()
      .from(specProofs)
      .where(eq(specProofs.missionId, missionId))
      .pipe(Effect.mapError(refusedWhile('reading the proofs')))
    const taskRows = yield* transaction
      .select()
      .from(specTasks)
      .where(and(eq(specTasks.missionId, missionId), eq(specTasks.removed, false)))
      .orderBy(asc(specTasks.rank))
      .pipe(Effect.mapError(refusedWhile('reading the tasks')))
    const [recommended] = yield* transaction
      .select()
      .from(missionRecommendations)
      .where(eq(missionRecommendations.missionId, missionId))
      .pipe(Effect.mapError(refusedWhile('reading the recommended model')))
    const proofs = new Map<string, { readonly proof: Proof; readonly version: number }>()
    for (const row of proofRows) {
      const proof = readProof(row.block)
      if (Option.isSome(proof))
        proofs.set(row.scenarioId, { proof: proof.value, version: row.version })
    }
    return {
      proofs,
      tasks: taskRows.map(taskOf),
      recommendation: recommended === undefined ? null : recommendationOf(recommended),
    }
  })

/** A mission's proofs by scenario (support files by reference), its tasks and its recommendation. */
export const planIn = (transaction: EngineTransaction, missionId: string) =>
  Effect.map(planRows(transaction, missionId), (plan) => ({
    proofs: new Map<string, { readonly proof: ProofSeen; readonly version: number }>(
      [...plan.proofs].map(([id, kept]) => [
        id,
        { proof: proofSeen(kept.proof), version: kept.version },
      ]),
    ),
    tasks: plan.tasks,
    recommendation: plan.recommendation,
  }))

/** The live requirements and scenarios of a mission, the scenarios in the Spec's order. */
export const liveIn = (transaction: EngineTransaction, missionId: string) =>
  Effect.gen(function* () {
    const requirements = yield* transaction
      .select({ id: specRequirements.id })
      .from(specRequirements)
      .where(and(eq(specRequirements.missionId, missionId), eq(specRequirements.removed, false)))
      .orderBy(asc(specRequirements.rank))
      .pipe(Effect.mapError(refusedWhile('reading the Spec')))
    const scenarios = yield* transaction
      .select({ id: specScenarios.id, requirementId: specScenarios.requirementId })
      .from(specScenarios)
      .where(and(eq(specScenarios.missionId, missionId), eq(specScenarios.removed, false)))
      .orderBy(asc(specScenarios.rank))
      .pipe(Effect.mapError(refusedWhile('reading the Spec')))
    return {
      requirements: requirements.map((one) => one.id),
      scenarios: requirements.flatMap((requirement) =>
        scenarios.filter((one) => one.requirementId === requirement.id).map((one) => one.id),
      ),
    }
  })

/** The task graph with its coverage: for each live scenario, the tasks that cover it. */
export const taskGraphOf = (missionId: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    return yield* database.transaction((transaction) =>
      Effect.gen(function* () {
        const [mission] = yield* transaction
          .select({ id: missions.id })
          .from(missions)
          .where(eq(missions.id, missionId))
          .pipe(Effect.mapError(refusedWhile('reading the mission')))
        if (mission === undefined) return yield* new UnknownMission({ id: missionId })
        const { tasks } = yield* planRows(transaction, missionId)
        const live = yield* liveIn(transaction, missionId)
        const graph: TaskGraph = {
          tasks,
          coverage: live.scenarios.map((scenario) => ({
            scenario,
            tasks: tasks.filter((one) => one.scenarios.includes(scenario)).map((one) => one.id),
          })),
        }
        return graph
      }),
    )
  })

/** Where a mission's repositories are: its Project's main checkout and their rows by path. */
export const placeOf = (missionId: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const [row] = yield* database
      .select({
        projectId: missions.projectId,
        keyPrefix: missions.keyPrefix,
        keyNumber: missions.keyNumber,
        main: projects.mainCheckout,
      })
      .from(missions)
      .innerJoin(projects, eq(projects.id, missions.projectId))
      .where(eq(missions.id, missionId))
      .pipe(Effect.mapError(refusedWhile('reading the mission')))
    if (row === undefined) return yield* new UnknownMission({ id: missionId })
    const repositories = yield* database
      .select()
      .from(projectRepositories)
      .where(eq(projectRepositories.projectId, row.projectId))
      .pipe(Effect.mapError(refusedWhile('reading the repositories')))
    return {
      key: missionKey(row.keyPrefix, row.keyNumber),
      main: row.main,
      repositories: new Map(repositories.map((one) => [one.path, one])),
    }
  })

export type Place = Effect.Success<ReturnType<typeof placeOf>>

/** A repository's base commit, and the folder Git reads it in. */
interface Base {
  readonly commit: string
  readonly folder: string
}

/**
 * The base commit of each repository named, by #5's rule: with `fetch`, fetched once now (a
 * declaration); without it, the tracking ref last fetched (a write), fetched only when there is
 * none yet. A repository the Project does not have is left out; one whose base cannot be read is
 * said.
 */
export const basesAt = (place: Place, names: ReadonlySet<string>, fetch: boolean) =>
  Effect.gen(function* () {
    const git = yield* Git
    const bases = new Map<string, Base>()
    const problems: string[] = []
    for (const name of names) {
      const row = place.repositories.get(name)
      if (row === undefined) continue
      const folder = join(place.main, row.path)
      const ref =
        row.remote === null
          ? `refs/heads/${row.baseBranch}`
          : `refs/remotes/${row.remote}/${row.baseBranch}`
      const known = fetch
        ? Option.none<string>()
        : yield* git.commitOf(folder, ref).pipe(Effect.orElseSucceed(() => Option.none<string>()))
      if (Option.isSome(known)) {
        bases.set(name, { commit: known.value, folder })
        continue
      }
      const fetched = yield* upToDateBase(row.id).pipe(
        Effect.match({
          onSuccess: (base) => ({ commit: base.commit, problem: null }),
          onFailure: (failed) => ({
            commit: null,
            problem: `The base of ${name} could not be read: ${failed.message}`,
          }),
        }),
      )
      if (fetched.commit !== null) bases.set(name, { commit: fetched.commit, folder })
      if (fetched.problem !== null) problems.push(fetched.problem)
    }
    return { bases, problems }
  })

const short = (commit: string): string => commit.slice(0, 12)

/** What Git said, on one line. */
const oneLine = (said: string): string =>
  said
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .join(' ')

/**
 * A Git read whose refusal is a problem of the field it serves, said in `told`'s words, rather
 * than a failure of the whole call: one file Git cannot read hides none of the others.
 */
const orSaid = <A, R>(read: Effect.Effect<A, GitRefusal, R>, told: (said: string) => string) =>
  read.pipe(
    Effect.map((value) => ({ value }) as const),
    Effect.catchTag('GitFailed', (refused) =>
      Effect.succeed({ problem: told(oneLine(refused.message)) } as const),
    ),
  )

/** What a patch does to a file an addition may not, as its refusal says it. */
const PATCH_CHANGES = {
  create: 'creates',
  delete: 'deletes',
  rename: 'renames',
  copy: 'copies',
} as const

/** Why a file a proof inserts does not go in at its repository's base, or null when it does. */
const insertionProblem = (place: Place, bases: ReadonlyMap<string, Base>, file: InsertedFile) =>
  Effect.gen(function* () {
    const named = `${file.repository}/${file.path}`
    if (!place.repositories.has(file.repository)) {
      return `\`${file.field}\`: the Project has no repository ${file.repository}.`
    }
    const base = bases.get(file.repository)
    if (base === undefined) return null
    const git = yield* Git
    const at = short(base.commit)
    const read = yield* orSaid(
      git.pathAt(base.folder, base.commit, file.path),
      (said) => `\`${file.field}\`: Git could not read ${named} at the base commit ${at}: ${said}`,
    )
    if ('problem' in read) return read.problem
    const exists = read.value
    if (file.insertion === 'new_file') {
      return exists
        ? `\`${file.field}\`: ${named} already exists at the base commit ${at}: add to it with a patch (\`addition\`), never overwrite it.`
        : null
    }
    if (!exists) {
      return `\`${file.field}\`: ${named} does not exist at the base commit ${at}: write it whole (\`new_file\`).`
    }
    const shaped = yield* orSaid(
      git.patchShape(base.folder, file.patch ?? ''),
      (said) => `\`${file.field}\`: Git could not read the patch of ${named}: ${said}`,
    )
    if ('problem' in shaped) return shaped.problem
    const shape = shaped.value
    const elsewhere = shape.paths.filter((path) => path !== file.path)
    if (elsewhere.length > 0) {
      return `\`${file.field}\`: the patch touches ${elsewhere.join(', ')}, not ${named}: an addition changes its own file only.`
    }
    const [change] = shape.changes
    if (change !== undefined) {
      return `\`${file.field}\`: the patch ${PATCH_CHANGES[change]} ${named}: an addition adds to its file, never creates, deletes or renames one.`
    }
    if (!shape.paths.includes(file.path)) {
      return `\`${file.field}\`: the patch changes nothing of ${named}.`
    }
    const applied = yield* orSaid(
      git.patchApplies(base.folder, base.commit, file.patch ?? ''),
      (said) => `\`${file.field}\`: Git could not check the patch of ${named}: ${said}`,
    )
    if ('problem' in applied) return applied.problem
    const reason = applied.value
    // Git says it over several lines; a problem is one line.
    return reason === null
      ? null
      : `\`${file.field}\`: the patch does not apply to ${named} at the base commit ${at}: ${oneLine(reason)}`
  })

/** Why a task's target is not as its intent says at its repository's base, or null. */
export const targetProblem = (
  place: Place,
  bases: ReadonlyMap<string, Base>,
  task: string,
  target: TaskTarget,
) =>
  Effect.gen(function* () {
    const named = `${target.repository}/${target.path}`
    if (!place.repositories.has(target.repository)) {
      return `${task} targets ${named}, but the Project has no repository ${target.repository}.`
    }
    const base = bases.get(target.repository)
    if (base === undefined) return null
    const at = short(base.commit)
    const read = yield* orSaid(
      Git.use((git) => git.pathAt(base.folder, base.commit, target.path)),
      (said) =>
        `${task} targets ${named}, which Git could not read at the base commit ${at}: ${said}`,
    )
    if ('problem' in read) return read.problem
    const exists = read.value
    if (target.intent === 'change' && !exists) {
      return `${task} changes ${named}, which does not exist at the base commit ${at}.`
    }
    if (target.intent === 'create' && exists) {
      return `${task} creates ${named}, which already exists at the base commit ${at}.`
    }
    return null
  })

/** The problems of each file a proof inserts, at the base. */
export const insertionProblems = (place: Place, proof: Proof, fetch: boolean) =>
  Effect.gen(function* () {
    const files = insertedFiles(proof)
    const { bases, problems } = yield* basesAt(
      place,
      new Set(files.map((file) => file.repository)),
      fetch,
    )
    for (const file of files) {
      const problem = yield* insertionProblem(place, bases, file)
      if (problem !== null) problems.push(problem)
    }
    return problems
  })

/** The Spec's version, 0 for a mission whose Spec row is not made yet. */
const specVersionIn = (transaction: EngineTransaction, missionId: string) =>
  Effect.map(
    transaction
      .select({ version: specs.version })
      .from(specs)
      .where(eq(specs.missionId, missionId))
      .pipe(Effect.mapError(refusedWhile('reading the Spec'))),
    ([row]) => row?.version ?? 0,
  )

/** A Git that could not run: the declaration says it could not check the base. */
const gitFailed = (missionId: string, reason: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const version = yield* database.transaction((transaction) =>
      specVersionIn(transaction, missionId),
    )
    const failures: ReadonlyArray<CompletenessFailure> = [
      { target: 'base', sentence: `Hemera could not check the base commit with Git: ${reason}` },
    ]
    return { version, failures }
  })

/**
 * What a declaration finds at each repository's base (#90), fetched once: every file a proof of a
 * live scenario inserts, every target of a task. Read outside the transaction, for the Spec at
 * the version it answers with.
 */
export const atBaseFailures = (missionId: string, fetch: boolean) =>
  Effect.gen(function* () {
    const database = yield* Database
    const place = yield* placeOf(missionId)
    const read = yield* database.transaction((transaction) =>
      Effect.gen(function* () {
        return {
          plan: yield* planRows(transaction, missionId),
          live: yield* liveIn(transaction, missionId),
          version: yield* specVersionIn(transaction, missionId),
        }
      }),
    )
    const named = new Set([
      ...[...read.plan.proofs.values()].flatMap((kept) =>
        insertedFiles(kept.proof).map((file) => file.repository),
      ),
      ...read.plan.tasks.flatMap((task) => task.targets.map((target) => target.repository)),
    ])
    const { bases, problems } = yield* basesAt(place, named, fetch)
    const failures: CompletenessFailure[] = problems.map((sentence) => ({
      target: 'base',
      sentence,
    }))
    for (const scenario of read.live.scenarios) {
      const kept = read.plan.proofs.get(scenario)
      if (kept === undefined) continue
      for (const file of insertedFiles(kept.proof)) {
        const problem = yield* insertionProblem(place, bases, file)
        if (problem !== null) {
          failures.push({ target: scenario, sentence: `${scenario}’s proof: ${problem}` })
        }
      }
    }
    for (const task of read.plan.tasks) {
      for (const target of task.targets) {
        const problem = yield* targetProblem(place, bases, task.id, target)
        if (problem !== null) failures.push({ target: task.id, sentence: problem })
      }
    }
    return {
      version: read.version,
      failures: failures satisfies ReadonlyArray<CompletenessFailure>,
    }
  }).pipe(
    Effect.catchTags({
      GitFailed: (refused) => gitFailed(missionId, refused.message),
      GitCut: (cut) => gitFailed(missionId, cut.message),
      GitMissing: (missing) => gitFailed(missionId, missing.message),
    }),
  )
