/**
 * The commands run each time Hemera opens: every command marked "at open" runs once per Project,
 * in its main checkout, once the window is shown and never before.
 *
 * A run of it still going is stopped first and started again, so it starts clean. A command that
 * cannot start is logged with its Project and never holds the opening: the next one runs all the
 * same. A command marked "ask before running" asks at Project level, and waits meanwhile.
 */

import { Effect } from 'effect'

import { atOpenCommands } from './catalogue.ts'
import { getProject } from './projects.ts'
import { Runs, startRun, stopRun } from './runs.ts'

const said = <E>(cause: E): string =>
  cause instanceof Error && cause.message !== '' ? cause.message : String(cause)

/** Runs every command marked "at open"; answers the runs it started, in order. */
export const runAtOpen = Effect.gen(function* () {
  const runs = yield* Runs
  const started: string[] = []
  for (const command of yield* atOpenCommands) {
    yield* Effect.gen(function* () {
      const project = yield* getProject(command.projectId)
      const going = [...runs.live.values()].filter(
        (live) => live.run.commandId === command.id && live.run.workspaceId === null,
      )
      for (const live of going) yield* stopRun(live.run.id)
      const run = yield* startRun({
        projectId: command.projectId,
        workspaceId: null,
        commandId: command.id,
        line: null,
        folder: null,
        startedBy: 'hemera',
        sessionId: null,
        atOpen: true,
      })
      started.push(run.id)
      if (run.state === 'failed') {
        runs.log(`${project.name}: ${command.name} was not run at open: it could not start`)
      }
    }).pipe(
      Effect.catch((refusal) =>
        Effect.sync(() =>
          runs.log(
            `Project ${command.projectId}: ${command.name} was not run at open: ${said(refusal)}`,
          ),
        ),
      ),
    )
  }
  return started
})
