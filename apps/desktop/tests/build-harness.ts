/**
 * The builds a suite runs on (design D10-01 to D10-14).
 *
 * `idleBuilds` is the build service of a suite that runs none: the catalogue and the runtime stand
 * on it, and a Session that is no build passes through it untouched. The checks a build runs are
 * the Project's, and a suite scripts them here: `noChecks` has none configured, which makes every
 * task done, not verified (D10-07); `scriptedChecks` answers what the suite decides, and writes
 * each result under its attempt as the checks' own layer does, so the view and the briefs read
 * them.
 */

import { join } from 'node:path'

import { Effect, Layer } from 'effect'

import type { CheckVerdict } from '@hemera/core'
import { type FakeScript, type FakeStep, fakeAgent } from '#engine/agents/fake.ts'
import { type BuildView, Builds, NoBuildNotices, buildsLayer } from '#engine/build/build.ts'
import { BuildChecks, type CheckOutcome, type CheckRunRequest } from '#engine/build/checks.ts'
import { gitLayer } from '#engine/git.ts'
import { Projects } from '#engine/projects.ts'
import { Sessions } from '#engine/sessions.ts'
import { Specs } from '#engine/specs/specs.ts'
import { Database, SqliteClient } from '#engine/storage/database.ts'
import { buildCheckResults } from '#engine/storage/schema.ts'
import { Launches } from '#engine/workspaces/launches.ts'

import { repository } from './repositories.ts'
import { agentOf, shaped, write } from './specs-harness.ts'

/** No check configured: every task is done, not verified. */
export const noChecks = Layer.succeed(BuildChecks, { run: () => Effect.succeed([]) })

/** The builds of a suite that runs none, over the database and the diagnostic it provides. */
export const idleBuilds = buildsLayer.pipe(
  Layer.provide(gitLayer()),
  Layer.provide(noChecks),
  Layer.provide(NoBuildNotices),
)

/** One check a script answers: its name, its verdict and why. */
export interface Scripted {
  readonly name: string
  readonly verdict: CheckVerdict
  readonly detail?: string
  readonly output?: string
}

/**
 * The Project's checks as a suite decides them: `answer` is asked for each run, and what it answers
 * is written under the attempt, in the Project's order, as the checks' own layer writes it. An
 * empty answer is no check configured for that moment.
 */
export const scriptedChecks = (
  answer: (request: CheckRunRequest) => readonly Scripted[] | Promise<readonly Scripted[]>,
) =>
  Layer.effect(
    BuildChecks,
    Effect.gen(function* () {
      const database = yield* Database
      return {
        run: (request) =>
          Effect.gen(function* () {
            const scripted = yield* Effect.promise(async () => answer(request))
            const outcomes: CheckOutcome[] = scripted.map((one) => ({
              id: crypto.randomUUID(),
              checkId: null,
              name: one.name,
              place: '',
              line: one.name,
              verdict: one.verdict,
              exitCode: one.verdict === 'red' ? 1 : 0,
              value: null,
              detail: one.detail ?? (one.verdict === 'red' ? 'exited with 1' : null),
              outputTail: one.output ?? '',
              runId: null,
              ranAt: new Date().toISOString(),
            }))
            if (outcomes.length > 0) {
              yield* database
                .insert(buildCheckResults)
                .values(outcomes.map((outcome) => ({ ...outcome, attemptId: request.attemptId })))
                .pipe(Effect.orDie)
            }
            return outcomes
          }),
      }
    }),
  )

/** A contractual task of a Spec a build suite freezes, named by its title. */
export interface TaskDraft {
  readonly title: string
  readonly executor?: 'agent' | 'human'
  readonly dependsOn?: readonly string[]
  /** The stories it covers, by title; the first story when it names none. */
  readonly stories?: readonly string[]
}

/** Two tasks with no dependency and a third depending on both (D10-03): T1, T2, then T3. */
export const THREE: readonly TaskDraft[] = [
  { title: 'Write the exporter' },
  { title: 'Write the reader' },
  { title: 'Wire them', dependsOn: ['Write the exporter', 'Write the reader'] },
]

/**
 * A `ready` Spec of a Project on a real `main` — `sources/api`, one repository with one commit —
 * with the tasks given, in that order: labelled `T1…Tn` by it (L1). Written the way the product
 * writes one: its writer's agent shapes, plans, decomposes and attests, and the human freezes it.
 */
export const aReadySpec = (
  dataFolder: string,
  tasks: readonly TaskDraft[],
  stories: readonly string[] = ['Export'],
) =>
  Effect.gen(function* () {
    const main = join(dataFolder, 'main')
    repository(join(main, 'sources', 'api'))
    const projects = yield* Projects
    const created = yield* projects.create({ name: 'Atlas', tone: 'primary', mainPath: main })
    const project = yield* projects.addRepository(created.id, created.version, './sources/api')
    const sessions = yield* Sessions
    const writer = yield* sessions.create(project.id, 'claude')
    const specs = yield* Specs
    const { session, snapshot } = yield* specs.create({
      sessionId: writer.id,
      type: 'feature',
      title: 'Export the journal',
    })
    const specId = snapshot.spec.id
    const agent = agentOf(session.id)
    yield* shaped(specId, session.id)
    yield* specs.declarePhase(specId, session.id, 'shape', { summary: 'Shaped.', assumptions: [] })
    yield* write(agent, specId, 'plan', 'Stream the rows into a file.')
    yield* specs.declarePhase(specId, session.id, 'plan', { summary: 'Planned.', assumptions: [] })
    yield* specs.writeStories(agent, {
      specId,
      stories: stories.map((title) => ({
        title,
        narrative: `As a user, I ${title.toLowerCase()}.`,
        priority: null,
        criteria: [`${title} works`],
      })),
    })
    yield* specs.writeTasks(agent, {
      specId,
      tasks: tasks.map((task) => ({
        title: task.title,
        result: `${task.title}, done`,
        type: 'code',
        executor: task.executor ?? 'agent',
        criteria: 'Its tests pass',
        dependsOn: [...(task.dependsOn ?? [])],
        stories: [...(task.stories ?? stories.slice(0, 1))],
      })),
    })
    yield* specs.declarePhase(specId, session.id, 'decompose', {
      summary: 'Decomposed.',
      assumptions: [],
    })
    const attested = yield* specs.attest(specId, session.id)
    const frozen = yield* specs.markReady({
      specId,
      expectedRevisionId: attested.revision.id,
      expectedContentVersion: attested.spec.contentVersion,
      sessionId: session.id,
    })
    const workspace = yield* sessions.mainOf(project.id)
    return {
      projectId: project.id,
      specId,
      key: frozen.spec.key,
      revisionId: frozen.revision.id,
      writerId: session.id,
      workspaceId: workspace.id,
      main,
      repository: join(main, 'sources', 'api'),
    }
  })

/** A build of that Spec asked for in `main`, which is ready: started at once (D8-13). */
export const launched = (specId: string, workspaceId: string) =>
  Effect.gen(function* () {
    const launch = yield* (yield* Launches).request(specId, workspaceId)
    if (launch.sessionId === null) return yield* Effect.die('the build did not start')
    return launch.sessionId
  })

/** The agent's approach note, as a suite's agent answers the `prepare` brief. */
export const NOTE =
  'T1: the exporter first. T2: the reader. T3: wire them; the risk is the encoding.'

/** The labels of the tasks a delivery hands now, in the order it lists them. */
export function handedLabels(handed: string): string[] {
  return [...handed.matchAll(/^## (T\d+) · /gm)].map((match) => match[1] ?? '')
}

/** `task_finished` on a task, as the agent calls it (D10-04). */
export const finished = (label: string): FakeStep => ({
  does: 'uses',
  call: 'task_finished',
  arguments: { task: label },
})

/** How a suite's build agent answers each kind of delivery. */
export interface BuildPlan {
  /** Its answer to `prepare`; the note by default. */
  readonly prepare?: readonly FakeStep[]
  /** What it does with the tasks an `execute` delivery hands; each finished by default. */
  readonly execute?: (labels: readonly string[], handed: string) => readonly FakeStep[]
  /** What it does with a resume brief; nothing by default. */
  readonly resume?: (labels: readonly string[], handed: string) => readonly FakeStep[]
  /** What it does in `verify`; a sentence by default. */
  readonly verify?: (handed: string) => readonly FakeStep[]
}

/**
 * A build agent: what it answers each delivery with, chosen from the brief it was handed, and every
 * text it was handed, in order — which is what a suite reads the briefs from.
 */
export function buildAgent(plan: BuildPlan = {}, script: Partial<FakeScript> = {}) {
  const handed: string[] = []
  const agent = fakeAgent({
    ...script,
    answersDeliveryWith: (text) => {
      handed.push(text)
      const labels = handedLabels(text)
      if (text.includes('# Before you continue')) return plan.resume?.(labels, text) ?? []
      if (text.includes('# Phase: prepare')) {
        return plan.prepare ?? [{ does: 'says', text: NOTE }]
      }
      if (text.includes('# Phase: verify')) {
        return plan.verify?.(text) ?? [{ does: 'says', text: 'Verified against the Spec.' }]
      }
      return plan.execute?.(labels, text) ?? labels.map(finished)
    },
  })
  return { agent, handed }
}

/** The build as the window reads it. */
export const buildOf = (sessionId: string) =>
  Effect.gen(function* () {
    return yield* (yield* Builds).view(sessionId)
  })

/** Where each task stands, by label. */
export const statesOf = (view: BuildView) =>
  Object.fromEntries(view.tasks.map((task) => [task.label, task.state]))

/**
 * Reads until what is waited for is true, in real time, and answers the last thing it read: a
 * build moves through deliveries, tool calls over HTTP and checks in the background.
 */
export const eventually = <A, E, R>(read: Effect.Effect<A, E, R>, ready: (seen: A) => boolean) =>
  Effect.gen(function* () {
    let seen = yield* read
    for (let tries = 0; tries < 400 && !ready(seen); tries += 1) {
      yield* Effect.promise(() => new Promise<void>((resolve) => setTimeout(resolve, 25)))
      seen = yield* read
    }
    if (!ready(seen)) return yield* Effect.die(`never came: ${JSON.stringify(seen)}`)
    return seen
  })

/** The Journal lines of a build Session, in order. */
export const journalOf = (sessionId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqliteClient
    return yield* sql<{
      type: string
      entity_kind: string
      entity_id: string
      session_id: string | null
      spec_id: string | null
      revision_id: string | null
      payload: string
    }>`SELECT type, entity_kind, entity_id, session_id, spec_id, revision_id, payload
      FROM domain_events WHERE session_id = ${sessionId} ORDER BY sequence`
  })
