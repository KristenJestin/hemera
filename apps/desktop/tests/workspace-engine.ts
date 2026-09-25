/**
 * The engine the suites about Workspaces run on, and the Project they run it over.
 *
 * Nothing is mocked: the Projects, the Sessions, the commands, the Workspaces, their recipe and
 * their variables over a database in the suite's folder, the machine's `git` on real
 * repositories, and the commands started for real through the supervisor. The Project is
 * `Atlas`, whose `main` holds `sources/api` and `sources/front` — two repositories with one
 * commit each — and `docs`, a plain folder; none of them has a remote, so nothing here can reach
 * a network.
 */

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { Effect, Layer } from 'effect'
import type { Scope } from 'effect'

import { heldWordsLayer } from '#engine/agents/held.ts'
import { type AgentNotices, NoNotices } from '#engine/agents/notices.ts'
import {
  StderrSink,
  hostProcessesLayer,
  processSupervisorLayer,
} from '#engine/agents/supervisor.ts'
import { Commands, commandsLayer } from '#engine/commands/service.ts'
import { type Git, gitLayer } from '#engine/git.ts'
import { type Journal, journalLayer } from '#engine/journal.ts'
import { openProfile } from '#engine/migrate.ts'
import { Launches } from '#engine/workspaces/launches.ts'
import { Projects, projectsLayer } from '#engine/projects.ts'
import { Sessions, sessionsLayer } from '#engine/sessions.ts'
import { type Database, SqliteClient, databaseLayer } from '#engine/storage/database.ts'
import {
  type Links,
  type Preparation,
  hostLinks,
  preparationLayer,
  recovered,
} from '#engine/workspaces/preparation.ts'
import { type Recipe, recipeLayer } from '#engine/workspaces/recipe.ts'
import { type Variables, variablesLayer } from '#engine/workspaces/variables.ts'
import { type Workspaces, WorkspacesRoot, workspacesLayer } from '#engine/workspaces/workspaces.ts'

import { SHIPPED, VERSION } from './application.ts'
import { repository } from './repositories.ts'

/** Everything a program of these suites may ask for. */
export type WorkspaceEngine =
  | Projects
  | Sessions
  | Commands
  | Journal
  | Git
  | Workspaces
  | Recipe
  | Variables
  | Preparation
  | Database
  | SqliteClient

/**
 * One run of the engine over the suite's folder: its database, and its Workspaces made under
 * `<folder>/workspaces`, as the data folder's own are. `gitProgram` is the `git` asked, which a
 * suite names when it is about a machine that has none, `links` the system a link is made by,
 * which a suite has refuse one, and `notices` the window, which a suite listens as.
 */
export function workspaceEngine(
  folder: string,
  gitProgram?: string,
  links: Layer.Layer<Links> = hostLinks,
  notices: Layer.Layer<AgentNotices> = NoNotices,
) {
  const sink = Layer.succeed(StderrSink, { write: () => Effect.void })
  const processes = processSupervisorLayer.pipe(
    Layer.provideMerge(Layer.mergeAll(hostProcessesLayer, sink)),
  )
  /**
   * The launches, left out of this harness: a Workspace that becomes ready hands a build over to
   * them, and nothing in this folder's suites asks for one.
   */
  const launches = Layer.succeed(Launches, {
    one: () => Effect.die('this harness has no launch to read'),
    request: () => Effect.die('this harness starts no build'),
    retry: () => Effect.die('this harness starts no build'),
    workspaceReady: () => Effect.void,
    forSpec: () => Effect.die('this harness reads no panel'),
    // Nothing here ever asked for a build, so there is nothing to come back to.
    recover: () => Effect.void,
  })
  const services: Layer.Layer<WorkspaceEngine> = preparationLayer.pipe(
    Layer.provideMerge(Layer.mergeAll(workspacesLayer, recipeLayer, variablesLayer)),
    Layer.provide(links),
    Layer.provide(Layer.succeed(WorkspacesRoot, join(folder, 'workspaces'))),
    Layer.provideMerge(commandsLayer),
    Layer.provideMerge(journalLayer),
    Layer.provideMerge(gitLayer(gitProgram)),
    Layer.provideMerge(
      Layer.mergeAll(projectsLayer, sessionsLayer).pipe(
        Layer.provideMerge(databaseLayer(join(folder, 'hemera.sqlite'))),
      ),
    ),
    Layer.provide(processes),
    Layer.provide(sink),
    Layer.provide(launches),
    Layer.provide(heldWordsLayer),
    Layer.provide(notices),
  )
  return <A, E>(program: Effect.Effect<A, E, WorkspaceEngine | Scope.Scope>): Promise<A> =>
    Effect.runPromise(
      // The program's scope closes before the services': the runs it holds end first.
      Effect.provide(
        Effect.scoped(
          Effect.gen(function* () {
            yield* openProfile(folder, SHIPPED, VERSION)
            // What the engine does at its start (D8-05).
            yield* recovered
            return yield* program
          }),
        ),
        // The launches answer nothing here, but the engine's recovery pass asks them too (D8-13).
        Layer.mergeAll(services, launches),
      ),
    )
}

/** The folder of `Atlas`'s `main`: two repositories and a plain folder, as described above. */
export function atlasMain(folder: string): string {
  const main = join(folder, 'main')
  repository(join(main, 'sources', 'api'))
  repository(join(main, 'sources', 'front'))
  mkdirSync(join(main, 'docs'), { recursive: true })
  return main
}

/**
 * The Spec `HEM-7` of a Project, written as the Specs' own lot writes one: the revision it is
 * on, in the same breath. A Workspace made for a Spec names it, and `workspaces.spec_id` is a
 * foreign key to `specs.id` (D8-12), so it has to exist for the row to be written.
 */
export const aSpecOf = (projectId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqliteClient
    const at = '2026-09-04T08:00:00.000Z'
    yield* sql`INSERT INTO specs (id, project_id, key, slug, status, current_revision_id, created_at, updated_at)
      VALUES ('HEM-7', ${projectId}, 'HEM-7', 'the-login-form', 'ready', 'HEM-7-r1', ${at}, ${at})`
    yield* sql`INSERT INTO spec_revisions (id, spec_id, number, title, type, created_by, created_at)
      VALUES ('HEM-7-r1', 'HEM-7', 1, 'The login form', 'feature', 'human', ${at})`
  })

/** `Atlas` on that `main`, declaring the locations named, in that order, and the Spec `HEM-7`. */
export const atlas = (main: string, locations: readonly string[]) =>
  Effect.gen(function* () {
    const projects = yield* Projects
    let project = yield* projects.create({ name: 'Atlas', tone: 'primary', mainPath: main })
    for (const location of locations) {
      project = yield* projects.addRepository(project.id, project.version, location)
    }
    yield* aSpecOf(project.id)
    return project
  })

/** A Session of that Project, which a command run needs to belong to. */
export const aSessionOf = (projectId: string) =>
  Effect.gen(function* () {
    const sessions = yield* Sessions
    return yield* sessions.create(projectId, 'claude')
  })

/** The catalogue command a suite saves, with the defaults a settings page would give. */
export const saved = (projectId: string, name: string, line: string, type: 'serve' | 'script') =>
  Effect.gen(function* () {
    const commands = yield* Commands
    return yield* commands.save(
      {
        projectId,
        name,
        line,
        type,
        lineWindows: null,
        lineLinux: null,
        folderBase: null,
        folder: null,
        scope: 'workspace',
        portless: false,
        portlessName: null,
      },
      false,
    )
  })
