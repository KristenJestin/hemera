/**
 * The `documenter` role (#146): a fixed phase of Hemera at the end of every Building and every
 * round, a child of the mission (never of the Builder), that brings the Project's documentation in
 * line with what the code now does, in the Workspace, in the same diff as the code. It writes only
 * the files the mission's doc recipes name (the gate's guard), has no command tool (the role
 * table), and ends with one `docs_report`.
 *
 * Its brief is read from its pass: the files its pass hands it (the Building's, or the special
 * tasks' in a delta pass), the recipes that apply, and the Notes with the Memory block. Apart from
 * the documenter's service, so the role registry imports nothing that imports the sessions back.
 */

import { missionKey } from '@hemera/core/domain'
import { eq } from 'drizzle-orm'
import { Effect } from 'effect'

import type { BriefField, BriefedSession, RoleEntry, SessionOwner } from '../sessions/roles.ts'
import { Database, refusedWhile } from '../storage/database.ts'
import { buildings, missions } from '../storage/schema.ts'
import { applicableRecipes, filesOfPass, passOfLineage } from './documenter-store.ts'

/** The documenter's layer of the instructions, as the ticket writes it. */
export const DOCUMENTER_TEMPLATE = `# Role: Documenter

## Mission
At the end of every build and every round, bring the Project's documentation in line with what the
code now does. You write in the Workspace, in the same diff as the code. You write documentation
only, never code, and only the files the Project's doc recipes name.

## Inputs
The frozen Spec (and, in a round, its points and decisions), the files changed per repository
(all of the build's, or only those of the last fixes when your pass is a delta), the Project's
doc recipes (which files, and what each is for), the Notes.

## Tools
fs_read, fs_list, search (the Workspace); fs_write, fs_edit (the recipes' files only); spec_read;
build_read; docs_report.

## How you work
1. For each recipe, read what the change touches and the documentation that covers it.
2. Update what is now wrong, add what is new, remove what no longer exists. Match the existing
   tone, structure and language of each document.
3. Describe what the code does, not what the Spec hoped for. If they differ, write what the code
   does and say so in your report.
4. In a delta pass, look only at the files your brief lists.

## When you stop
One docs_report, then end. "No change" is accepted only with a reason specific to this change
(not "nothing to document"); the user sees it as evidence.

## Never
- Touch source code, tests, configuration or generated files.
- Document a feature the code does not have, or a step you did not see work.
- Create a document the recipes do not ask for.
- Write the Spec's or Hemera's own vocabulary into the Project's documentation.`

/** Where a recipe's files are, as the brief names them. */
const placeSaid = (repository: string | null): string =>
  repository === null ? 'the Workspace root' : repository

/** The brief of a documenter's session, from its pass. */
const documenterBriefOf = (owner: SessionOwner, session: BriefedSession) =>
  Effect.gen(function* () {
    if (owner.kind !== 'mission') return []
    const database = yield* Database
    const pass = yield* passOfLineage(database, session.lineage)
    if (pass === null) return []
    const [mission] = yield* database
      .select({ prefix: missions.keyPrefix, number: missions.keyNumber })
      .from(missions)
      .where(eq(missions.id, pass.missionId))
      .pipe(Effect.mapError(refusedWhile('reading the mission')))
    const [building] = yield* database
      .select({ label: buildings.label })
      .from(buildings)
      .where(eq(buildings.id, pass.buildingId))
      .pipe(Effect.mapError(refusedWhile('reading the Building')))
    if (mission === undefined || building === undefined) return []
    const delta = pass.mode === 'delta'
    const files = filesOfPass(pass).map((one) => `- ${one.repository}/${one.path} (${one.status})`)
    const recipes = (yield* applicableRecipes(pass.missionId)).map(
      (one) => `- ${placeSaid(one.repository)}: ${one.path}: ${one.purpose}`,
    )
    const fields: ReadonlyArray<BriefField> = [
      {
        label: `Documenter · ${missionKey(mission.prefix, mission.number)} · ${building.label} · ${delta ? 'delta' : 'full'}`,
        text: `Spec: spec_read (frozen). Bring the documentation the recipes name in line with what the code now does, then call docs_report once and end your turn.${delta ? ' This pass is a delta: look only at the files listed.' : ''}`,
      },
      {
        label: delta
          ? 'Changed by the special tasks'
          : 'Changed files, since the base snapshot of the Building',
        text: files.length === 0 ? 'No file changed.' : files.join('\n'),
      },
      {
        label: 'Doc recipes',
        text:
          recipes.length === 0
            ? 'No recipe applies: report why with docs_report.'
            : recipes.join('\n'),
      },
    ]
    return fields
  })

export const DOCUMENTER_ROLE: RoleEntry = {
  id: 'documenter',
  displayName: 'the documenter',
  ownerKind: 'mission',
  placeKind: 'workspace',
  writes: true,
  // Its brief carries the Notes with the Memory block, and it holds `now_set`.
  readsMemory: true,
  projectLayer: true,
  mainOf: null,
  template: DOCUMENTER_TEMPLATE,
  brief: documenterBriefOf,
  countsInCap: true,
  ledByUser: false,
}
