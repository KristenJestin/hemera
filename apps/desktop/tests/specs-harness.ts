/**
 * The Spec suites' data folder and the few steps each of them starts from (design D7-01).
 *
 * `openedOn(folder)` is one run of the engine over a data folder of the suite's own, migrated by
 * the migrations the application really ships; called twice, it is a restart. A draft starts the
 * way the product starts one: a `free` Session whose proposal the human accepted (D7-07).
 */

import { join } from 'node:path'
import { Effect, Layer } from 'effect'

import { type SectionName, type SpecType, type SpecWriter, contractOf } from '@hemera/core'
import { journalLayer } from '#engine/journal.ts'
import type { Journal } from '#engine/journal.ts'
import { openProfile } from '#engine/migrate.ts'
import { Projects, projectsLayer } from '#engine/projects.ts'
import { Sessions, sessionsLayer } from '#engine/sessions.ts'
import { NoSpecNotices, type SpecNotices } from '#engine/specs/notices.ts'
import { Specs, specsLayer } from '#engine/specs/specs.ts'
import { SqliteClient, databaseLayer } from '#engine/storage/database.ts'

const SHIPPED = join(import.meta.dirname, '..', 'drizzle')

export type SpecServices = Projects | Sessions | Specs | Journal | SqliteClient

/**
 * One run of the engine over this folder: calling it again is a restart. The window is nobody
 * unless a suite hands the notices it listens with.
 */
export function openedOn(dataFolder: string, notices: Layer.Layer<SpecNotices> = NoSpecNotices) {
  const services = Layer.mergeAll(
    projectsLayer,
    sessionsLayer,
    specsLayer.pipe(Layer.provide(notices)),
    journalLayer,
  ).pipe(Layer.provideMerge(databaseLayer(join(dataFolder, 'hemera.sqlite'))))
  return <A, E>(program: Effect.Effect<A, E, SpecServices>) =>
    Effect.runPromise(
      Effect.scoped(
        Effect.provide(
          Effect.gen(function* () {
            yield* openProfile(dataFolder, SHIPPED, '0.4.0')
            return yield* program
          }),
          services,
        ),
      ),
    )
}

/** A Project whose Spec keys start with `prefix`, the next one numbered `next` (D7-02). */
export const project = (prefix = 'HEM', next = 1) =>
  Effect.gen(function* () {
    const created = yield* (yield* Projects).create({
      name: 'Hemera',
      tone: 'primary',
      mainPath: '/tmp/hemera',
    })
    const sql = yield* SqliteClient
    yield* sql`UPDATE projects SET spec_prefix = ${prefix}, next_spec_number = ${next}
      WHERE id = ${created.id}`
    return created
  })

/** A `free` Session of the Project, as the composer starts one. */
export const freeSession = (projectId: string) =>
  Effect.gen(function* () {
    return yield* (yield* Sessions).create(projectId, 'claude')
  })

export const agentOf = (sessionId: string): SpecWriter => ({ kind: 'agent', sessionId })

export const humanOf = (sessionId: string): SpecWriter => ({ kind: 'human', sessionId })

/** A new draft, created from a `free` Session that became `define` and its writer. */
export const draft = (type: SpecType = 'feature') =>
  Effect.gen(function* () {
    const created = yield* project()
    const free = yield* freeSession(created.id)
    const { session, snapshot } = yield* (yield* Specs).create({
      sessionId: free.id,
      type,
      title: 'Export the journal',
    })
    return { project: created, session, snapshot, specId: snapshot.spec.id }
  })

/** Writes a section on its current version. */
export const write = (actor: SpecWriter, specId: string, name: SectionName, body: string) =>
  Effect.gen(function* () {
    const specs = yield* Specs
    const current = yield* specs.read(specId)
    const version = current.sections.find((section) => section.name === name)?.version ?? 0
    return yield* specs.writeSection(actor, { specId, name, body, baseVersion: version })
  })

/** The shaped sections of the Spec's type, written by the agent. */
export const shaped = (specId: string, sessionId: string) =>
  Effect.gen(function* () {
    const current = yield* (yield* Specs).read(specId)
    for (const name of contractOf(current.revision.type)) {
      yield* write(agentOf(sessionId), specId, name, `The ${name} of the export.`)
    }
  })

/**
 * The whole contract written by the writer's agent, the three phases declared and the content
 * attested: the gate is empty (D7-10).
 */
export const complete = (specId: string, sessionId: string) =>
  Effect.gen(function* () {
    const specs = yield* Specs
    const agent = agentOf(sessionId)
    yield* shaped(specId, sessionId)
    yield* specs.declarePhase(specId, sessionId, 'shape', { summary: 'Shaped.', assumptions: [] })
    yield* write(agent, specId, 'plan', 'Stream the rows into a file.')
    yield* specs.declarePhase(specId, sessionId, 'plan', { summary: 'Planned.', assumptions: [] })
    yield* specs.writeStories(agent, {
      specId,
      stories: [
        {
          title: 'Export',
          narrative: 'As a user, I export the Journal.',
          priority: null,
          criteria: ['A file is written', 'It opens in a spreadsheet'],
        },
      ],
    })
    yield* specs.writeTasks(agent, {
      specId,
      tasks: [
        {
          title: 'Write the exporter',
          result: 'An exporter',
          type: 'code',
          executor: 'agent',
          criteria: 'Its tests pass',
          dependsOn: [],
          stories: ['Export'],
        },
        {
          title: 'Document it',
          result: 'A page',
          type: 'docs',
          executor: 'human',
          criteria: 'The page is published',
          dependsOn: ['Write the exporter'],
          stories: ['Export'],
        },
      ],
    })
    yield* specs.declarePhase(specId, sessionId, 'decompose', {
      summary: 'Decomposed.',
      assumptions: ['One file format'],
    })
    return yield* specs.attest(specId, sessionId)
  })

/** `complete`, then the human click: a `ready` Spec. */
export const frozen = (specId: string, sessionId: string) =>
  Effect.gen(function* () {
    const attested = yield* complete(specId, sessionId)
    return yield* (yield* Specs).markReady({
      specId,
      expectedRevisionId: attested.revision.id,
      expectedContentVersion: attested.spec.contentVersion,
      sessionId,
    })
  })
