/**
 * The `prelaunch` role (#139, open question 57): a short Planner session that reads what else
 * changed in the targeted repositories since the Freeze and says, for each file, whether it matters
 * for what the frozen Spec asks, in one `prelaunch_report`. It never writes the Spec: its tools are
 * the role table's, for reading and reporting.
 *
 * A role of its own rather than a mode of the Planner's, as the `ticket-event` role (#97): the
 * check's agent counts in the Project's cap of sub-agents, which counts by role, and the table then
 * takes every Spec writing tool away. It reads neither the Memory nor the Planning discussion.
 *
 * Apart from the check, so the role registry imports nothing that imports the sessions back.
 */

import { missionKey } from '@hemera/core/domain'
import type { SpecRequirement } from '@hemera/ipc'
import { eq } from 'drizzle-orm'
import { Effect } from 'effect'

import { specIn } from '../planning/store.ts'
import type { BriefField, BriefedSession, RoleEntry, SessionOwner } from '../sessions/roles.ts'
import { Database, refusedWhile } from '../storage/database.ts'
import { livingRequirements, missions } from '../storage/schema.ts'
import { checkOfLineage, resultsOf } from './store.ts'

/** The paragraph the Planner role holds for this mode, as the ticket writes it. */
export const PRELAUNCH_PARAGRAPH = `## Pre-launch check (mode prelaunch)
The Spec is frozen. You read; you write nothing in it, and you have no tool that could. Your brief
lists files that changed in the targeted repositories since the Spec was frozen (manifests,
lockfiles, test and CI configuration, other files), with their diff, and the living-spec
requirements the Spec changes. For each file, say whether it matters for what the Spec asks and
why, in one \`prelaunch_report\`. A file matters when the frozen Spec, a proof, a task or a decision
would be wrong or incomplete against it. Then end your turn.
- Say what you read, not what you expect. "Does not matter" needs a reason.
- Never propose a new version of the Spec here. Whether to launch or to go back to Planning is the
  user's choice.`

/** The `prelaunch` layer of the instructions. */
export const PRELAUNCH_TEMPLATE = `# Role: Planner, prelaunch mode

${PRELAUNCH_PARAGRAPH}

## Tools
\`spec_read\` (the frozen Spec); \`fs_read\`, \`fs_list\`, \`search\` (main checkout, read-only);
\`prelaunch_report\`.

## Never
- Write anything, anywhere: the Spec, the code, a ticket.
- Launch anything: launching is the user's.`

/** The most of one file's change the brief carries, and of all of them. */
const PATCH_MOST = 8_000
const PATCHES_MOST = 48_000

const cut = (patch: string, room: number): string =>
  patch.length <= room ? patch : `${patch.slice(0, Math.max(room, 0))}\n[cut: read the file itself]`

/** A requirement of the Spec that changes the living spec, with the living text it aims. */
const aimedLine = (requirement: SpecRequirement, living: string | null): string =>
  [
    `- ${requirement.id} (${requirement.delta} ${requirement.livingRef ?? ''}, written against version ${String(requirement.livingVersion ?? 0)}): ${requirement.text}`,
    living === null
      ? '  The living requirement is gone.'
      : `  The living requirement now: ${living}`,
  ].join('\n')

/** The brief of a check's session: the files handed to it with their diff, and the deltas. */
const prelaunchBriefOf = (owner: SessionOwner, session: BriefedSession) =>
  Effect.gen(function* () {
    if (owner.kind !== 'mission') return []
    const check = yield* checkOfLineage(session.lineage)
    if (check === null) return []
    const database = yield* Database
    const [mission] = yield* database
      .select({
        prefix: missions.keyPrefix,
        number: missions.keyNumber,
        projectId: missions.projectId,
      })
      .from(missions)
      .where(eq(missions.id, check.missionId))
      .pipe(Effect.mapError(refusedWhile('reading the mission')))
    if (mission === undefined) return []
    const spec = yield* database
      .transaction((transaction) => specIn(transaction, check.missionId))
      .pipe(Effect.catchTag('UnknownMission', () => Effect.succeed(null)))
    const results = resultsOf(check)
    let room = PATCHES_MOST
    const files = results.handed.map((item) => {
      const patch =
        results.patches.find((one) => one.repository === item.repository && one.path === item.path)
          ?.patch ?? ''
      const shown = cut(patch, Math.min(PATCH_MOST, room))
      room -= shown.length
      return [
        `- ${item.repository}/${item.path} (${item.kind}, ${item.status})`,
        '```diff',
        shown,
        '```',
      ].join('\n')
    })
    const aimed: string[] = []
    for (const requirement of spec?.requirements ?? []) {
      if (requirement.removed || requirement.livingRef === null) continue
      const [living] = yield* database
        .select({ text: livingRequirements.text, removed: livingRequirements.removed })
        .from(livingRequirements)
        .where(eq(livingRequirements.id, requirement.livingRef))
        .pipe(Effect.mapError(refusedWhile('reading the living spec')))
      aimed.push(
        aimedLine(requirement, living === undefined || living.removed ? null : living.text),
      )
    }
    const fields: ReadonlyArray<BriefField> = [
      {
        label: 'Your task',
        text: `${missionKey(mission.prefix, mission.number)} is Ready: its Spec is frozen at version ${String(spec?.version ?? 0)}. These files changed in the targeted repositories since the Freeze. Read each with its diff (spec_read gives the frozen Spec), then call prelaunch_report once, answering every file.`,
      },
      { label: 'Files changed since the Freeze', text: files.join('\n') },
      {
        label: 'Living-spec requirements the Spec changes',
        text: aimed.length === 0 ? null : aimed.join('\n'),
      },
    ]
    return fields
  })

export const PRELAUNCH_ROLE: RoleEntry = {
  id: 'prelaunch',
  displayName: 'the pre-launch Planner',
  ownerKind: 'mission',
  placeKind: 'main-checkout',
  writes: false,
  readsMemory: false,
  projectLayer: true,
  mainOf: null,
  template: PRELAUNCH_TEMPLATE,
  brief: prelaunchBriefOf,
  countsInCap: true,
  ledByUser: false,
}
