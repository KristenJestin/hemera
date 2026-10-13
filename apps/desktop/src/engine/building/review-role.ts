/**
 * The two reviewers of the automatic review (#147): `spec-reviewer` (does the result meet the
 * frozen Spec?) and `code-reviewer` (is the code correct, tested and safe?). One pass each, fresh
 * context, read-only, on the checkpoint of the result: no write tool, no command tool, no Memory
 * (CT-06), so no Now, Notes or Journal in their brief, at first launch as at resume.
 *
 * Their brief is composed by Hemera from their pass, the checkpoint and the Building's evidence,
 * never from the Builder's reasoning, Journal or thread. Apart from the reviewers' service, so the
 * role registry imports nothing that imports the sessions back.
 */

import { REVIEWER_NAMES, ROOT_REPOSITORY, missionKey } from '@hemera/core/domain'
import { eq } from 'drizzle-orm'
import { Effect } from 'effect'

import type { BriefField, BriefedSession, RoleEntry, SessionOwner } from '../sessions/roles.ts'
import { Database, refusedWhile } from '../storage/database.ts'
import { buildings, checkpointRepositories, missions } from '../storage/schema.ts'
import {
  beforeRedSaid,
  documentationSaid,
  evidenceIn,
  finalChecksSaid,
  listedOrNull,
  manualSaid,
  outsideSaid,
  proofRunsSaid,
} from './review-evidence.ts'
import { checkpointFilesIn, reviewPassOfLineage, reviewerOf } from './review-store.ts'

/** The Spec reviewer's layer of the instructions, as the ticket writes it. */
export const SPEC_REVIEWER_TEMPLATE = `# Role: Spec reviewer

## Mission
One pass, fresh context, read-only: does the result meet the frozen Spec? Every requirement,
every scenario, every proof, every decision taken since Freeze. You report; you fix nothing. Every
finding you report becomes work or a question for the user, so report only what should change.

## Inputs
The frozen Spec with its decisions and effective plan, a checkpoint of the result per repository,
the evidence (final checks, red and green proof runs, manual scenarios), the documenter's report.
You never get the builder's reasoning, and you do not need it.

## Tools
spec_read, checkpoint_read, evidence_read, search, fs_read (on the checkpoint), review_report.

A finding: severity (blocking, warning, suggestion), requirement and scenario if any, repository,
path, line if any, text (in {user.language}), contradicts_spec (true when fixing it would change
what the Spec says), evidence (what you read that shows it).

## What you check
- Each automated scenario has a valid red then an up-to-date green of its proof; manual scenarios
  are marked as such.
- The proof tests still test what the scenario says: not weakened, not skipped, not always green.
- Every requirement's delta is in the code; nothing the Non-goals exclude was built.
- The decisions and the migration plan are applied. The documentation matches the result.

## When you stop
One review_report, then end. An empty report is valid.

## Never
- Edit anything or run commands.
- Grade on taste: cite the Spec for every blocking finding.
- Mark contradicts_spec false on a finding whose fix would change the Spec's meaning.
- Review code quality beyond the contract: that is the code reviewer's.`

/** The Code reviewer's layer of the instructions, as the ticket writes it. */
export const CODE_REVIEWER_TEMPLATE = `# Role: Code reviewer

## Mission
One pass, fresh context, read-only: is the code correct, tested and safe? You report; you fix
nothing. Every finding you report becomes work or a question for the user, so report only what
should change.

## Inputs
A checkpoint of the result per repository, the frozen Spec (as context, not to judge it again),
the check evidence, the repository's own conventions. Never the builder's reasoning.

## Tools
checkpoint_read, fs_read, search (on the checkpoint), spec_read, evidence_read, review_report.

## What you check
- Correctness: logic errors, edge cases, error paths, concurrency, resource leaks.
- Tests: the changed behaviour is tested, and the tests would fail if the code were wrong.
- Security: input handling, injection, secrets in code or logs, permissions, unsafe paths.
- Fit: the change follows the repository's conventions and does not duplicate existing code.
- Files changed outside their task's targets, and code written before its red: look at them.

## When you stop
One review_report, then end.

## Never
- Edit anything or run commands.
- Report style points the linter already enforces.
- Reopen a Spec decision as a code finding: if the code is right but the Spec seems wrong, say so
  with contradicts_spec true.
- Report something you did not read in the checkpoint.`

const placeSaid = (repository: string): string =>
  repository === ROOT_REPOSITORY ? 'the Workspace root' : repository

/** The brief of a reviewer's session, from its pass, its checkpoint and the evidence. */
const reviewerBriefOf = (owner: SessionOwner, session: BriefedSession) =>
  Effect.gen(function* () {
    if (owner.kind !== 'mission') return []
    const database = yield* Database
    const pass = yield* reviewPassOfLineage(database, session.lineage)
    if (pass === null) return []
    const [mission] = yield* database
      .select({ prefix: missions.keyPrefix, number: missions.keyNumber })
      .from(missions)
      .where(eq(missions.id, pass.missionId))
      .pipe(Effect.mapError(refusedWhile('reading the mission')))
    const [building] = yield* database
      .select()
      .from(buildings)
      .where(eq(buildings.id, pass.buildingId))
      .pipe(Effect.mapError(refusedWhile('reading the Building')))
    if (mission === undefined || building === undefined) return []
    const repositories = yield* database
      .select()
      .from(checkpointRepositories)
      .where(eq(checkpointRepositories.checkpointId, pass.checkpointId))
      .orderBy(checkpointRepositories.position)
      .pipe(Effect.mapError(refusedWhile('reading the checkpoint')))
    const files = yield* checkpointFilesIn(database, pass.checkpointId)
    const evidence = yield* evidenceIn(database, building)
    const reviewer = reviewerOf(pass)
    const spec = reviewer === 'spec-reviewer'
    const taken = repositories
      .map(
        (one) =>
          `- ${placeSaid(one.repository)}: base ${one.base ?? 'none'}, merge base ${one.mergeBase ?? 'none'}, ${String(files.filter((file) => file.repository === one.repository).length)} file(s) changed`,
      )
      .join('\n')
    const fields: ReadonlyArray<BriefField> = [
      {
        label: `${REVIEWER_NAMES[reviewer]} · ${missionKey(mission.prefix, mission.number)} · ${building.label}`,
        text: [
          `Checkpoint: ${pass.checkpointId}, repositories:`,
          taken === '' ? '- none' : taken,
          'Spec: spec_read (frozen, with the decisions taken since Freeze and the effective plan).',
          'Read the result with checkpoint_read, fs_read and search, which read the checkpoint, never the live Workspace; the evidence with evidence_read. Then call review_report once and end your turn.',
        ].join('\n'),
      },
      { label: 'Final checks', text: listedOrNull(finalChecksSaid(evidence)) },
      { label: 'Proof runs', text: spec ? listedOrNull(proofRunsSaid(evidence)) : null },
      { label: 'Manual scenarios', text: spec ? listedOrNull(manualSaid(evidence)) : null },
      { label: 'Documentation', text: listedOrNull(documentationSaid(evidence)) },
      { label: 'Changed outside its targets', text: listedOrNull(outsideSaid(evidence)) },
      { label: 'Written before the red', text: listedOrNull(beforeRedSaid(evidence)) },
    ]
    return fields
  })

const reviewerRole = (id: 'spec-reviewer' | 'code-reviewer', template: string): RoleEntry => ({
  id,
  displayName: `the ${REVIEWER_NAMES[id].toLowerCase()}`,
  ownerKind: 'mission',
  placeKind: 'workspace',
  writes: false,
  // CT-06: no Memory tool, no Now, Notes or Journal in its brief, at launch as at resume.
  readsMemory: false,
  projectLayer: true,
  mainOf: null,
  template,
  brief: reviewerBriefOf,
  countsInCap: true,
  ledByUser: false,
})

export const SPEC_REVIEWER_ROLE = reviewerRole('spec-reviewer', SPEC_REVIEWER_TEMPLATE)
export const CODE_REVIEWER_ROLE = reviewerRole('code-reviewer', CODE_REVIEWER_TEMPLATE)
