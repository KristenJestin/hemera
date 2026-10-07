/**
 * The engine's Profile in a process of its own, for the suite that kills it: it opens the data
 * folder it is given, starts a mission of a Project whose main checkout it is given, and holds the
 * Journal's projection once the mission's start is committed and before it is projected. It then
 * says `held <sequence>` on its output and waits to be killed.
 *
 *   node memory-engine.ts <data folder> <migrations folder> <main checkout>
 */

import { Effect } from 'effect'

import type { DomainEvent } from '../../src/engine/journal.ts'
import { createMission } from '../../src/engine/missions.ts'
import { startProfile } from '../../src/engine/profile.ts'
import { createProject } from '../../src/engine/projects.ts'

const [dataFolder = '', migrations = '', main = ''] = process.argv.slice(2)

const holdAtTheStart = (events: ReadonlyArray<DomainEvent>) => {
  const started = events.find((event) => event.type === 'mission.created')
  if (started === undefined) return Effect.void
  return Effect.andThen(
    Effect.sync(() => process.stdout.write(`held ${String(started.sequence)}\n`)),
    Effect.never,
  )
}

Effect.runFork(
  Effect.scoped(
    Effect.gen(function* () {
      const profile = yield* startProfile(
        { dataFolder, version: '1.0.0', migrations },
        {
          backupFolders: [],
          reconciliationSteps: [],
          memory: { beforeProjecting: holdAtTheStart },
        },
        () => {},
      )
      yield* profile.use(
        Effect.gen(function* () {
          const project = yield* createProject({
            name: 'Acme',
            mainCheckout: main,
            repositories: [],
          })
          yield* createMission({
            projectId: project.id,
            idea: { sentence: 'Export the invoices as CSV', ticket: null },
          })
        }),
      )
      return yield* Effect.never
    }),
  ),
)
