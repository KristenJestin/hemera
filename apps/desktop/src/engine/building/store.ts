/**
 * The pre-launch checks as they are kept (#139): what a check read, what it found, and the view the
 * window reads of it, its verdict computed from what is kept. Apart from the check and its runs, so
 * the role registry and the gate import nothing that imports the sessions back.
 */

import {
  AGENT_DID_NOT_ANSWER,
  CHECK_STATES,
  type CheckState,
  blockedBySaid,
  missionKey,
  prelaunchActions,
} from '@hemera/core/domain'
import {
  type AgentStepState,
  AGENT_STEP_STATES,
  CheckModel,
  CheckStep,
  CheckedBase,
  CheckedDependency,
  HandedItem,
  MovedItem,
  type PrelaunchView,
  UnknownCheck,
} from '@hemera/ipc'
import { desc, eq } from 'drizzle-orm'
import { Effect, Option, Schema } from 'effect'

import { Database, type EngineTransaction, refusedWhile } from '../storage/database.ts'
import { missions, prelaunchChecks } from '../storage/schema.ts'

export type CheckRow = typeof prelaunchChecks.$inferSelect

/** The most files a check hands its agent; beyond, the rest is listed by name only. */
export const HANDED_MOST = 200

/** Why a file is handed without its diff. */
export const SENSITIVE_WITHHELD = 'a sensitive place: its diff is never handed'

/**
 * A file's change since the Freeze, as the agent of the check is handed it: its diff masked, or
 * none and why (a sensitive place).
 */
export const HandedPatch = Schema.Struct({
  repository: Schema.String,
  path: Schema.String,
  patch: Schema.String,
  withheld: Schema.NullOr(Schema.String),
})
export type HandedPatch = typeof HandedPatch.Type

/** A file that changed beyond what a check hands its agent: listed by name, never read. */
export const UnhandedFile = Schema.Struct({
  repository: Schema.String,
  path: Schema.String,
  status: Schema.String,
})
export type UnhandedFile = typeof UnhandedFile.Type

/** What a check found, each step in words; the agent's step is said from its state. */
export const CheckResults = Schema.Struct({
  steps: Schema.Array(CheckStep),
  dependencies: Schema.Array(CheckedDependency),
  bases: Schema.Array(CheckedBase),
  moved: Schema.Array(MovedItem),
  handed: Schema.Array(HandedItem),
  model: CheckModel,
  patches: Schema.Array(HandedPatch),
  unhanded: Schema.Array(UnhandedFile),
  /** Why the check failed, or why its agent stopped. */
  failure: Schema.NullOr(Schema.String),
})
export type CheckResults = typeof CheckResults.Type

const ResultsJson = Schema.fromJsonString(CheckResults)
export const writeResults = Schema.encodeSync(ResultsJson)
const readResults = Schema.decodeUnknownOption(ResultsJson)

/**
 * What a check holds for (CT-25, fourth bullet): the commit read per repository, the Spec version,
 * each dependency's stage, the fingerprint of the validation settings.
 */
export const CheckRead = Schema.Struct({
  specVersion: Schema.Number,
  bases: Schema.Array(
    Schema.Struct({
      repositoryId: Schema.String,
      repository: Schema.String,
      commit: Schema.String,
    }),
  ),
  dependencies: Schema.Array(
    Schema.Struct({ id: Schema.String, key: Schema.String, stage: Schema.String }),
  ),
  settings: Schema.String,
})
export type CheckRead = typeof CheckRead.Type

const ReadJson = Schema.fromJsonString(CheckRead)
export const writeRead = Schema.encodeSync(ReadJson)
const readRead = Schema.decodeUnknownOption(ReadJson)

/** What a row read, or nothing for one that cannot be read. */
export const readOf = (row: CheckRow): CheckRead | null => Option.getOrNull(readRead(row.read))

const EMPTY: CheckResults = {
  steps: [],
  dependencies: [],
  bases: [],
  moved: [],
  handed: [],
  model: {
    setting: { agent: 'claude', model: null, effort: null },
    level: 'app',
    recommendation: null,
  },
  patches: [],
  unhanded: [],
  failure: 'This check cannot be read: check again.',
}

export const resultsOf = (row: CheckRow): CheckResults =>
  Option.getOrElse(readResults(row.results), () => EMPTY)

const stateOf = (row: CheckRow): CheckState =>
  CHECK_STATES.find((one) => one === row.state) ?? 'failed'

export const agentStateOf = (row: CheckRow): AgentStepState =>
  AGENT_STEP_STATES.find((one) => one === row.agentState) ?? 'failed'

/** The agent's step in words, from where it stands. */
const agentSaid = (row: CheckRow, results: CheckResults): string => {
  const answered = results.handed.filter((one) => one.answer !== null)
  switch (agentStateOf(row)) {
    case 'skipped':
      return row.kind === 'mechanical'
        ? 'A dependency reached Done: the mechanical part ran, without an agent.'
        : 'Nothing else changed in the targeted repositories: the agent of the check is not asked.'
    case 'waiting_for_slot':
      return 'Waiting for a free agent slot.'
    case 'running':
      return `The agent of the check reads the ${String(results.handed.length)} other file(s) that changed.`
    case 'reported':
      return `The agent reported on ${String(answered.length)} file(s): ${String(
        answered.filter((one) => one.answer?.matters === true).length,
      )} matter.`
    case 'unanswered':
      return AGENT_DID_NOT_ANSWER
    case 'failed':
      return results.failure ?? 'The agent of the check stopped.'
  }
}

/** The agent's state as its step in the list shows it. */
const AGENT_STEP: Readonly<Record<AgentStepState, CheckStep['state']>> = {
  skipped: 'skipped',
  waiting_for_slot: 'waiting',
  running: 'running',
  reported: 'done',
  unanswered: 'done',
  failed: 'failed',
}

/** The agent's step as the list of steps shows it. */
const agentStep = (row: CheckRow, results: CheckResults): CheckStep => {
  const state = agentStateOf(row)
  return {
    step: 'agent',
    state: AGENT_STEP[state],
    said: agentSaid(row, results),
  }
}

/** A check as the window reads it: its steps, what moved, and its verdict. */
export const viewOf = (row: CheckRow, key: string): PrelaunchView => {
  const results = resultsOf(row)
  const state = stateOf(row)
  // An agent that stopped checked nothing either: its files stay unchecked, as unanswered ones.
  const unanswered =
    agentStateOf(row) === 'unanswered' || (state === 'done' && agentStateOf(row) === 'failed')
  const blocked = results.dependencies
    .filter((one) => !one.done && one.stage !== 'cancelled')
    .map((one) => one.key)
  const outdated = results.moved.length > 0
  const mechanical = row.kind === 'mechanical'
  const actions = mechanical ? [] : prelaunchActions({ state, blocked, outdated, unanswered })
  const said =
    state === 'running'
      ? 'Checking against today'
      : state === 'failed'
        ? (results.failure ?? 'The check failed: check again.')
        : mechanical
          ? outdated
            ? 'A dependency reached Done and something moved since the Freeze: the full check runs when you click Build.'
            : 'A dependency reached Done and nothing moved since the Freeze.'
          : blocked.length > 0
            ? `${key} is Ready · ${blockedBySaid(blocked)}: it is launched once they are Done.`
            : outdated
              ? 'Something moved since the Freeze: launch anyway, or go back to Planning.'
              : unanswered
                ? AGENT_DID_NOT_ANSWER
                : 'Nothing moved since the Freeze: launch.'
  const steps = results.steps.filter((one) => one.step !== 'agent')
  const at = steps.findIndex((one) => one.step === 'model')
  const agent = agentStep(row, results)
  return {
    id: row.id,
    missionId: row.missionId,
    missionKey: key,
    kind: mechanical ? 'mechanical' : 'full',
    state,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    steps: at < 0 ? [...steps, agent] : [...steps.slice(0, at), agent, ...steps.slice(at)],
    dependencies: results.dependencies,
    bases: results.bases,
    moved: results.moved,
    handed: results.handed,
    agent: { state: agentStateOf(row), summary: row.summary, said: agent.said },
    model: results.model,
    verdict: { outdated, blockedBy: blocked, actions, said },
  }
}

/** A mission's key, read in the reader given. */
const keyIn = (reader: EngineTransaction | Database['Service'], missionId: string) =>
  Effect.map(
    reader
      .select({ prefix: missions.keyPrefix, number: missions.keyNumber })
      .from(missions)
      .where(eq(missions.id, missionId))
      .pipe(Effect.mapError(refusedWhile('reading the mission'))),
    ([row]) => (row === undefined ? '' : missionKey(row.prefix, row.number)),
  )

/** A check's row, or null. */
export const checkRowIn = (reader: EngineTransaction | Database['Service'], checkId: string) =>
  Effect.map(
    reader
      .select()
      .from(prelaunchChecks)
      .where(eq(prelaunchChecks.id, checkId))
      .pipe(Effect.mapError(refusedWhile('reading a check'))),
    ([row]) => row ?? null,
  )

/** A check as the window reads it. */
export const checkView = (checkId: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const row = yield* checkRowIn(database, checkId)
    if (row === null) return yield* new UnknownCheck({ id: checkId })
    return viewOf(row, yield* keyIn(database, row.missionId))
  })

/** The mission's last check, full or mechanical; null before its first. */
export const latestCheckRowIn = (
  reader: EngineTransaction | Database['Service'],
  missionId: string,
) =>
  Effect.map(
    reader
      .select()
      .from(prelaunchChecks)
      .where(eq(prelaunchChecks.missionId, missionId))
      .orderBy(desc(prelaunchChecks.startedAt), desc(prelaunchChecks.id))
      .limit(1)
      .pipe(Effect.mapError(refusedWhile('reading the checks'))),
    ([row]) => row ?? null,
  )

/** The mission's last check as the window reads it; null before its first. */
export const latestCheckOf = (missionId: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const row = yield* latestCheckRowIn(database, missionId)
    if (row === null) return null
    return viewOf(row, yield* keyIn(database, missionId))
  })

/** The check a `prelaunch` session's lineage works for, or null. */
export const checkOfLineage = (lineage: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const [row] = yield* database
      .select()
      .from(prelaunchChecks)
      .where(eq(prelaunchChecks.lineage, lineage))
      .pipe(Effect.mapError(refusedWhile('reading a check')))
    return row ?? null
  })
