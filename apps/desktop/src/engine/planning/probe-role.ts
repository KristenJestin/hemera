/**
 * The `probe` role (#89): a sub-agent of the Planner, in a worktree of its own taken from the
 * up-to-date base, which it may write in and nowhere else; it reads the Memory, counts in the
 * Project's cap, and is the main session of no stage. Its brief is its Probe as it is kept: the
 * question, the scenario it serves, the Planner's hints, its folder and its base commits, and what
 * of the Project it must know before it runs anything.
 */

import { probeLabel } from '@hemera/core/domain'
import { eq } from 'drizzle-orm'
import { Effect, Match } from 'effect'

import { listCommands } from '../catalogue.ts'
import { listResources } from '../resources/declarations.ts'
import type { BriefField, BriefedSession, RoleEntry, SessionOwner } from '../sessions/roles.ts'
import { Database, refusedWhile } from '../storage/database.ts'
import { missions } from '../storage/schema.ts'
import { basesOf, probeOfLineage } from './probe-store.ts'
import { specIn } from './store.ts'

/** The Probe's layer of the instructions, as the ticket writes it. */
export const PROBE_TEMPLATE = `# Role: Probe

## Mission
Answer one question by running things instead of assuming: reproduce a bug, check how a library
or the code behaves, measure. You work alone in a temporary worktree of the up-to-date base
branch, already prepared with the Project's recipe. Your report becomes the proof of a scenario,
so it must be exact enough for a Builder to replay it word for word.

## Inputs
The question, the scenario it serves (WHEN/THEN) if any, the Planner's hints, your folder and its
base commit, the Project's catalogue, the exclusive resources, the commands that always ask, the
Notes.

## How you work
1. Read the code the question touches.
2. Write the smallest test or command that shows the behaviour. Prefer an automated test in the
   Project's own test setup, at the path a Builder would use. Fixtures, helpers and data you add
   in your folder are kept with your report.
3. Run it. Record the exact command and the verbatim output, and mark the key line that shows the
   behaviour.
4. Try the obvious neighbours (other inputs, boundary values) and note those that break too.
5. Call \`probe_report\`.

## Returns / when you stop
One \`probe_report\`, then end. If a step is held for approval and nothing else can be done, report
\`inconclusive\` with what is missing rather than wait.

## Never
- Talk to the user or the Planner: your only output is the report.
- Fix the bug. You show it.
- Write outside your folder, commit, create a branch, or touch the main checkout.
- Run migrations, seeds or resets on a shared resource outside the gate.
- Report \`reproduced\` without an observed output from a real run.
- Paraphrase an output instead of quoting it.

## Failure modes to avoid
- A test that passes or fails whatever the code does.
- Actions that depend on something you did by hand and did not write down.
- Answering a broader question than the one asked.`

const freshnessSaid = Match.type<ReturnType<typeof basesOf>[number]['freshness']>().pipe(
  Match.tagsExhaustive({
    FetchedNow: ({ at }) => `fetched ${at}`,
    NotFetchedSince: ({ since }) => `not fetched since ${since ?? 'it was added'}`,
    LocalBranch: () => 'its local branch: it has no remote',
  }),
)

/** The Probe's brief, from its row, its mission's Spec and its Project; empty fields left out. */
const probeBrief = (owner: SessionOwner, session: BriefedSession) =>
  Effect.gen(function* () {
    if (owner.kind !== 'mission') return []
    const probe = yield* probeOfLineage(session.lineage)
    if (probe === null) return []
    const database = yield* Database
    const [mission] = yield* database
      .select({ projectId: missions.projectId })
      .from(missions)
      .where(eq(missions.id, owner.missionId))
      .pipe(Effect.mapError(refusedWhile('reading the mission')))
    if (mission === undefined) return []
    const spec = yield* database
      .transaction((transaction) => specIn(transaction, owner.missionId))
      .pipe(Effect.catchTag('UnknownMission', () => Effect.succeed(null)))
    const scenario =
      probe.scenario === null
        ? null
        : (spec?.requirements
            .flatMap((requirement) => requirement.scenarios)
            .find((one) => one.id === probe.scenario) ?? null)
    const commands = yield* listCommands(mission.projectId).pipe(
      Effect.catchTag('UnknownProject', () => Effect.succeed([])),
    )
    const resources = yield* listResources(mission.projectId).pipe(
      Effect.catchTag('UnknownProject', () => Effect.succeed([])),
    )
    const named = (ids: ReadonlyArray<string>) =>
      ids.map((id) => commands.find((one) => one.id === id)?.name ?? id).join(', ')
    const asking = [
      ...commands.filter((one) => one.askBeforeRunning).map((one) => one.name),
      ...resources.flatMap((one) =>
        one.changes.map((id) => commands.find((command) => command.id === id)?.name ?? id),
      ),
    ]
    const bases = basesOf(probe)
    const fields: ReadonlyArray<BriefField> = [
      {
        label: `Probe ${probeLabel(probe.number)} · ${spec?.key ?? ''}`,
        text: `Question: ${probe.question}`,
      },
      {
        label: 'Scenario',
        text:
          probe.scenario === null
            ? null
            : scenario === null
              ? probe.scenario
              : `${probe.scenario}\nWHEN ${scenario.when}\nTHEN ${scenario.then}`,
      },
      { label: 'Hints from the Planner', text: probe.brief },
      {
        label: 'Your folder',
        text: [
          `${probe.folder}: write here and nowhere else.`,
          ...bases.map(
            (base) =>
              `- ${base.repository}: detached at ${base.commit} (${base.ref}, ${freshnessSaid(base.freshness)})`,
          ),
        ].join('\n'),
      },
      {
        label: 'Catalogue',
        text:
          commands.length === 0
            ? null
            : commands.map((one) => `- ${one.id} ${one.name}: ${one.line}`).join('\n'),
      },
      {
        label: 'Exclusive resources',
        text:
          resources.length === 0
            ? null
            : resources
                .map(
                  (one) =>
                    `- ${one.name}: used by ${named(one.uses) || 'none'}; changed by ${named(one.changes) || 'none'}`,
                )
                .join('\n'),
      },
      {
        label: 'Commands that always ask',
        text: asking.length === 0 ? null : [...new Set(asking)].join(', '),
      },
    ]
    return fields
  })

export const PROBE_ROLE: RoleEntry = {
  id: 'probe',
  displayName: 'the Probe',
  ownerKind: 'mission',
  placeKind: 'own-worktree',
  writes: true,
  readsMemory: true,
  projectLayer: true,
  mainOf: null,
  template: PROBE_TEMPLATE,
  brief: probeBrief,
  countsInCap: true,
  ledByUser: false,
}
