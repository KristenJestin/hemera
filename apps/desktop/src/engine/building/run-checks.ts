/**
 * The Project's checks run by Hemera (#143): the `TaskChecks` port of #142, filled.
 *
 * - **What runs.** The checks of the mission's copy (CT-34) whose `when` is the scope asked, never
 *   the Project's current ones: a change of the Project afterwards does not touch a running
 *   mission. The "ask before running" marks and the exclusive resources are read live.
 * - **Where.** `root` at the Workspace root (a catalogue command where the catalogue puts it),
 *   `repository` in that one, `changed` in each repository where the attempt's attributed files
 *   are not empty; at the end, each repository the Building changed since its base snapshot.
 * - **How.** Through the run service in the Workspace, Hemera its author, never an agent's session.
 *   `{files}` is filled with the attempt's files there that match the filter, deleted ones left
 *   out; with none, the check is skipped there. A check takes the write locks of its repositories
 *   right before it launches and the snapshot of each (the trees it ran on, #140); a command
 *   marked "ask before running" waits for its permission need, and one declared on an exclusive
 *   resource for its mission's reservation (#88), like any run of Hemera's.
 * - **The verdict.** Red when it did not exit 0, whatever it printed, or when its expected number
 *   is missing or under the minimum; red with its reason when it could not start; green otherwise.
 *   Each result is kept as soon as it is known, with the end of its output; a final check keeps
 *   its whole output as the mission's evidence.
 * - **Restart.** A check launched is written as its process launches. One a stopped engine left
 *   is run again when its attempt is judged again, its kept results standing; one on an exclusive
 *   resource is never run again blindly: it is red, its runner told to check the real state.
 */

import { existsSync } from 'node:fs'
import { isAbsolute, join, relative, sep } from 'node:path'

import {
  type AttemptScope,
  type CheckVerdict,
  type ProjectCheck,
  attemptResult,
  checkPlaces,
  evaluateExpect,
  expandFiles,
  lineFor,
  outputTail,
} from '@hemera/core/domain'
import { HemeraAuthor } from '@hemera/ipc'
import { and, eq } from 'drizzle-orm'
import { Effect, Layer, Option, Result } from 'effect'

import { putEvidence } from '../memory/evidence.ts'
import { resourcesOf } from '../resources/declarations.ts'
import { ExclusiveResources } from '../resources/reservations.ts'
import { NOT_ALLOWED, Runs, awaitRun, runOutput, startRun, stopRun } from '../runs.ts'
import type { DomainEvents } from '../domain-events.ts'
import { Database, refusedWhile } from '../storage/database.ts'
import { buildingCheckRuns, buildings, missions } from '../storage/schema.ts'
import { mutate } from '../transaction.ts'
import { placeOf } from '../workspaces.ts'
import { checkResultsIn } from './attempts.ts'
import {
  type CheckResult,
  type ChecksAsked,
  TaskChecks,
  keepCheckResult,
  missionCancelled,
} from './checks.ts'
import { BuildDesk } from './desk.ts'
import { Snapshots } from './snapshots.ts'
import { type BuildingBase, bases as basesCodec, buildingEvent } from './tasks.ts'
import { type CheckLine, checksOf, validationSettingsOf } from './validation.ts'

/** A check's result before its run: everything but what a run says. */
const unrun = (
  name: string,
  place: string,
  verdict: Exclude<CheckVerdict, 'green'>,
  detail: string,
): CheckResult => ({
  name,
  place,
  verdict,
  detail,
  outputTail: '',
  runId: null,
})

/** A path as a check's line takes it: `/`-separated. */
const posixOf = (path: string): string => path.split(sep).join('/')

/** The words of a scope for the journal: "after T2", "after R3", "at the end". */
const scopeSaid = (scope: AttemptScope, subject: string | null): string =>
  scope === 'end' ? 'at the end' : `after ${subject ?? scope}`

/** What a run that did not end on its own exit says, as the reason of its red. */
const unfinished = (state: string, output: string): string => {
  if (output.includes(NOT_ALLOWED)) return 'denied by you'
  if (state === 'stopped' || state === 'interrupted') return 'stopped before it ended'
  const last = output.trimEnd().split('\n').at(-1) ?? ''
  return last === '' ? `it could not start (${state})` : `it could not start: ${last}`
}

const runChecks = (asked: ChecksAsked) =>
  Effect.gen(function* () {
    const database = yield* Database
    const copy = yield* validationSettingsOf(asked.missionId)
    if (copy === null) return []
    const { checks, lines } = checksOf(copy.sections)
    const due = checks
      .filter((one) => one.when === asked.scope)
      .toSorted((one, other) => one.rank - other.rank)
    const [building] = yield* database
      .select()
      .from(buildings)
      .where(eq(buildings.id, asked.buildingId))
      .pipe(Effect.mapError(refusedWhile('reading the Building')))
    const [mission] = yield* database
      .select({ projectId: missions.projectId })
      .from(missions)
      .where(eq(missions.id, asked.missionId))
      .pipe(Effect.mapError(refusedWhile('reading the mission')))
    if (due.length === 0 || building === undefined || mission === undefined) return []
    const projectId = mission.projectId
    const bases: ReadonlyArray<BuildingBase> = Option.getOrElse(
      basesCodec.read(building.bases),
      () => [],
    )
    const workspace = yield* placeOf(projectId, building.workspaceId)
    const folderOf = (repository: string) =>
      bases.find((one) => one.repository === repository)?.folder ?? workspace.folder

    // Where `changed` runs: the repositories the attempt wrote in; at the end, those the
    // Building changed since its base snapshot.
    const changed: string[] = []
    if (asked.scope === 'end') {
      const snapshots = yield* Snapshots
      for (const base of bases) {
        const place = { name: base.repository, folder: base.folder }
        const now = yield* snapshots.take(place, {
          kind: 'run',
          missionId: asked.missionId,
          runId: `end-${asked.attemptId}`,
          side: 'after',
        })
        if ((yield* snapshots.changed(asked.missionId, place, base.tree, now)).length > 0)
          changed.push(base.repository)
      }
    } else {
      for (const base of bases) {
        if (asked.files.some((one) => one.repository === base.repository))
          changed.push(base.repository)
      }
    }

    // A check a stop cut: run again, unless it is declared on an exclusive resource.
    const left = yield* database
      .select()
      .from(buildingCheckRuns)
      .where(eq(buildingCheckRuns.attemptId, asked.attemptId))
      .pipe(Effect.mapError(refusedWhile('reading the checks left running')))
    const kept = yield* checkResultsIn(database, asked.attemptId)
    for (const cut of left) {
      const shared = cut.commandId === null ? [] : yield* resourcesOf(projectId, cut.commandId)
      const done = kept.some((one) => one.name === cut.name && one.place === cut.place)
      if (shared.length > 0 && !done) {
        const result: CheckResult = {
          ...unrun(
            cut.name,
            cut.place,
            'red',
            `cut by a restart while it ran on ${shared.map((one) => one.name).join(', ')}: it may have run; check the real state before running it again`,
          ),
          runId: cut.runId,
        }
        yield* keepCheckResult(asked.attemptId, result)
      }
      yield* mutate('forgetting a check left running', (transaction) =>
        transaction
          .delete(buildingCheckRuns)
          .where(
            and(
              eq(buildingCheckRuns.attemptId, cut.attemptId),
              eq(buildingCheckRuns.name, cut.name),
              eq(buildingCheckRuns.place, cut.place),
            ),
          )
          .pipe(
            Effect.mapError(refusedWhile('forgetting a check left running')),
            Effect.as({ result: undefined, events: [] }),
          ),
      )
    }
    const standing = yield* checkResultsIn(database, asked.attemptId)

    /** One check in one place: skipped, refused before it starts, or run and judged. */
    const runOne = (check: ProjectCheck, place: string) =>
      Effect.gen(function* () {
        const copied: CheckLine | null =
          check.commandId === null
            ? null
            : (lines.find((one) => one.id === check.commandId) ?? null)
        if (check.commandId !== null && copied === null) {
          return unrun(check.name, place, 'red', 'its command is not in the mission’s copy')
        }
        const line = copied === null ? (check.line ?? '') : lineFor(copied, process.platform)
        // A catalogue command at the root runs where the catalogue puts it.
        const home =
          check.where === 'root' && copied !== null
            ? copied.repository === null || copied.repository === '.'
              ? workspace.folder
              : folderOf(copied.repository)
            : place === ''
              ? workspace.folder
              : folderOf(place)
        const absolute = join(home, copied?.folder ?? '')
        const folder = posixOf(relative(workspace.folder, absolute))
        if (!existsSync(absolute)) {
          return unrun(
            check.name,
            place,
            'red',
            `the folder ${folder === '' ? 'of the Workspace' : folder} does not exist`,
          )
        }
        const written = asked.files.flatMap((file) => {
          const path = join(folderOf(file.repository), file.path)
          const under = relative(absolute, path)
          if (under === '' || under.startsWith('..') || isAbsolute(under)) return []
          return [{ path: posixOf(under), deleted: !existsSync(path) }]
        })
        const expanded = expandFiles(line, written, check.files)
        if (expanded === null) {
          return unrun(check.name, place, 'skipped', `no file matched ${check.files ?? '{files}'}`)
        }
        const repositories =
          home === workspace.folder
            ? bases.map((one) => one.repository)
            : bases.filter((one) => one.folder === home).map((one) => one.repository)
        const watch = yield* BuildDesk.use((desk) =>
          desk.checkRun(asked.missionId, check.name, repositories),
        )
        let trees: ReadonlyArray<{ readonly repository: string; readonly tree: string }> = []
        /**
         * The run's id, once `startRun` answers. A run that waits for a resource launches after that
         * answer, one that waits for nothing before it: the row is written at launch with the id
         * when known, and named after the answer when it was not.
         */
        let runId: string | null = null
        const services = yield* Effect.context<Database | DomainEvents>()
        const launched = yield* startRun({
          projectId,
          workspaceId: building.workspaceId,
          commandId: check.commandId,
          line: expanded,
          folder: null,
          startedBy: 'hemera',
          sessionId: null,
          missionId: asked.missionId,
          copied: { line: expanded, folder: folder === '' ? null : folder },
          intent: mutate('writing that a check runs', (transaction) =>
            transaction
              .insert(buildingCheckRuns)
              .values({
                attemptId: asked.attemptId,
                name: check.name,
                place,
                runId,
                commandId: check.commandId,
                startedAt: new Date().toISOString(),
              })
              .onConflictDoNothing()
              .pipe(
                Effect.mapError(refusedWhile('writing that a check runs')),
                Effect.as({ result: undefined, events: [] }),
              ),
          ).pipe(Effect.provide(services)),
          beforeLaunch:
            watch === null
              ? Effect.void
              : Effect.map(watch.launch, (taken) => {
                  trees = taken
                }),
        }).pipe(Effect.result)
        if (Result.isFailure(launched)) {
          if (watch !== null) yield* watch.finish(null)
          return unrun(check.name, place, 'red', `it could not start: ${launched.failure.message}`)
        }
        const run = launched.success
        runId = run.id
        yield* mutate('naming a check’s run', (transaction) =>
          transaction
            .update(buildingCheckRuns)
            .set({ runId: run.id })
            .where(
              and(
                eq(buildingCheckRuns.attemptId, asked.attemptId),
                eq(buildingCheckRuns.name, check.name),
                eq(buildingCheckRuns.place, place),
              ),
            )
            .pipe(
              Effect.mapError(refusedWhile('naming a check’s run')),
              Effect.as({ result: undefined, events: [] }),
            ),
        )
        const waiting = yield* waitingFor(run.id, projectId, check.commandId, asked.missionId)
        if (waiting !== null) {
          yield* mutate('saying a check waits', () =>
            Effect.succeed({
              result: undefined,
              events: [
                buildingEvent(asked.missionId, 'building.check_waiting', {
                  check: check.name,
                  place,
                  waiting,
                }),
              ],
            }),
          )
        }
        const ended = yield* awaitRun(run.id).pipe(
          // Started for this check and judged by it: nobody else would stop it.
          Effect.onInterrupt(() => stopRun(run.id).pipe(Effect.ignore)),
          Effect.ensuring(watch === null ? Effect.void : watch.finish(run.id)),
        )
        const { output } = yield* runOutput(run.id)
        const judged =
          ended.exitCode === null
            ? { verdict: 'red' as const, value: null, detail: unfinished(ended.state, output) }
            : evaluateExpect(output, ended.exitCode, check.expect)
        const evidence =
          asked.scope === 'end'
            ? yield* putEvidence({
                missionId: asked.missionId,
                content: { text: output },
                name: place === '' ? check.name : `${check.name} · ${place}`,
                about: `check ${asked.attemptId}`,
                author: HemeraAuthor.make({}),
              }).pipe(
                Effect.map((item) => item.id),
                Effect.orElseSucceed(() => null),
              )
            : null
        return {
          name: check.name,
          place,
          verdict: judged.verdict,
          detail: judged.detail,
          outputTail: outputTail(output).tail,
          runId: run.id,
          line: ended.line,
          exitCode: ended.exitCode,
          value: judged.value,
          trees,
          evidenceId: evidence,
        } satisfies CheckResult
      })

    const results: CheckResult[] = []
    for (const check of due) {
      for (const place of checkPlaces(check, changed)) {
        const already = standing.find((one) => one.name === check.name && one.place === place)
        if (already !== undefined) {
          results.push(already)
          continue
        }
        const result = yield* runOne(check, place)
        // Cancelled while it ran: no result, and no check after it.
        const cancelled = yield* missionCancelled(asked.missionId)
        if (!cancelled) yield* keepCheckResult(asked.attemptId, result)
        yield* mutate('forgetting a check that ended', (transaction) =>
          transaction
            .delete(buildingCheckRuns)
            .where(
              and(
                eq(buildingCheckRuns.attemptId, asked.attemptId),
                eq(buildingCheckRuns.name, check.name),
                eq(buildingCheckRuns.place, place),
              ),
            )
            .pipe(
              Effect.mapError(refusedWhile('forgetting a check that ended')),
              Effect.as({ result: undefined, events: [] }),
            ),
        )
        if (cancelled) return []
        results.push(result)
      }
    }
    if (results.length === 0) return results
    const verdicts = results.map(
      (one) => `${one.name}${one.place === '' ? '' : ` · ${one.place}`}: ${one.verdict}`,
    )
    yield* mutate('saying the checks ran', () =>
      Effect.succeed({
        result: undefined,
        events: [
          asked.scope === 'end'
            ? buildingEvent(asked.missionId, 'building.final_checks', { checks: verdicts })
            : buildingEvent(asked.missionId, 'building.checks_ran', {
                scope: asked.scope,
                subject: asked.subject,
                when: scopeSaid(asked.scope, asked.subject),
                verdict: attemptResult(results.map((one) => one.verdict)),
                checks: verdicts,
              }),
          ...results
            .filter((one) => one.verdict === 'red')
            .map((one) =>
              buildingEvent(asked.missionId, 'building.check_red', {
                check: one.name,
                place: one.place,
              }),
            ),
        ],
      }),
    )
    return results
  })

/**
 * What a check's run waits for once started, or null: the user's permission, or an exclusive
 * resource its mission does not hold ready.
 */
const waitingFor = (
  runId: string,
  projectId: string,
  commandId: string | null,
  missionId: string,
) =>
  Effect.gen(function* () {
    const runs = yield* Runs
    const live = runs.live.get(runId)
    if (live === undefined) return null
    if (live.run.state === 'waiting_for_permission') return 'permission'
    if (commandId === null || live.run.state !== 'starting') return null
    const declared = yield* resourcesOf(projectId, commandId)
    if (declared.length === 0) return null
    const holders = yield* ExclusiveResources.use((resources) => resources.holders)
    const missing = declared.filter(
      (resource) =>
        !holders.some(
          (holding) =>
            holding.names.includes(resource.name) &&
            holding.holder?.missionId === missionId &&
            holding.holder.readiness === 'ready',
        ),
    )
    return missing.length === 0 ? null : missing.map((one) => one.name).join(', ')
  })

/** The Project's checks, as the mission's copy holds them, run by Hemera (#143). */
export const projectTaskChecks = Layer.effect(
  TaskChecks,
  Effect.gen(function* () {
    const context = yield* Effect.context<
      Effect.Services<ReturnType<typeof runChecks>> | Effect.Services<ReturnType<typeof waitingFor>>
    >()
    return { run: (asked) => runChecks(asked).pipe(Effect.provide(context), Effect.orDie) }
  }),
)
