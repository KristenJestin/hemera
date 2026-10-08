/**
 * The `living-spec` role (#93, open question 57): a Project's own session that reads every
 * repository's main checkout, read-only, and proposes the living spec domain by domain. It has no
 * mission, so no Memory and no Memory tool; it counts in the Project's cap; it validates nothing.
 * Its brief is the run as the database holds it: what was already proposed or validated, so a
 * session that replaces another goes on from there and never proposes the same domain twice.
 *
 * What the living spec does not know: Hemera does not detect behaviour changed outside Hemera in
 * 1.0 (a colleague changes a behaviour without a mission). The pre-launch check and the Probes
 * report a gap when they see one, and the user can re-run the bootstrap of one domain.
 */

import { Effect, Option, Schema } from 'effect'

import { RunCommit } from '@hemera/ipc'
import { getProject } from '../projects.ts'
import type { BriefedSession, RoleEntry, SessionOwner } from '../sessions/roles.ts'
import { livingTextOf, runOfLineage } from './store.ts'

/** The `living-spec` role's layer of the instructions, as the ticket writes it. */
export const LIVING_SPEC_TEMPLATE = `# Role: Living spec

## Mission
Describe what this Project does today, as requirements a user would recognise, grouped by
domain. You read the code; you never change it. The user validates your proposal domain by
domain, whenever they like. Until then everything you write is a proposal, and it is shown as one.

## Inputs (your brief)
The Project's repositories (main checkout, read-only) with the commit you read, the domains and
requirements already proposed or validated, and, for a run on one domain, that domain with its
requirements and their versions. The Spec language. You have no mission and no Memory.

## Tools
\`fs_read\`, \`fs_list\`, \`search\` (main checkout, read-only); \`living_spec_read\`;
\`living_domain_propose\`; \`living_requirement_propose\`; \`living_requirement_obsolete\` (run on one
domain only); \`living_spec_done\`.

## How you work
1. Map the Project first: its entry points, what a user can do with it, its interfaces (screens,
   commands, API endpoints, files it reads or writes).
2. Propose domains a user would name ("Search", "Export", "Accounts"), not code folders.
3. For each domain, propose requirements that describe observable behaviour, each with one or
   more scenarios WHEN … THEN … that a test could check.
4. Describe what the code does today, not what it should do. When you are not sure (dead code, a
   flag you cannot resolve, behaviour that depends on data you cannot see), write it in
   \`uncertainty\`. A requirement you cannot ground in code you read is not proposed.
5. Read \`living_spec_read\` before proposing: never propose a domain or a requirement twice. If you
   replace a session that stopped, go on from what is already there.
6. On a run on one domain, compare the code with each existing requirement: propose a
   replacement (\`replaces\`) only where the behaviour differs, and \`living_requirement_obsolete\`
   only where it is gone.
7. Write in the Project's Spec language, {project.specLanguage}.
8. End with \`living_spec_done\` and a short summary: domains proposed, what you left out and why.

## Never
- Invent a behaviour you did not read in the code.
- Describe internals (classes, functions, tables) as requirements.
- Validate, reject or remove anything: that is the user's.
- Write or run anything.`

const readCommits = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Array(RunCommit)))

/** The run of the session's lineage, with what it reads and what is already there. */
const livingSpecBrief = (owner: SessionOwner, session: BriefedSession) =>
  Effect.gen(function* () {
    if (owner.kind !== 'project') return []
    const project = yield* getProject(owner.projectId).pipe(
      Effect.catchTag('UnknownProject', () => Effect.succeed(null)),
    )
    const run = yield* runOfLineage(session.lineage)
    if (project === null || run === null) return []
    const commits = Option.getOrElse(readCommits(run.commits), () => [])
    const scope = run.domainId === null ? '' : yield* livingTextOf(owner.projectId, run.domainId)
    const already = yield* livingTextOf(owner.projectId)
    return [
      {
        label: `Living spec · ${project.name}`,
        text:
          run.domainId === null
            ? 'Run: the whole living spec. Propose its domains, then their requirements.'
            : 'Run: one domain. Propose requirements for it only: a replacement (`replaces`) where the behaviour differs, `living_requirement_obsolete` where it is gone.',
      },
      {
        label: 'Repositories (main checkout, read-only)',
        text: commits
          .map((one) => `- ${one.repository} at ${one.commit ?? 'no commit yet'}`)
          .join('\n'),
      },
      { label: 'The domain of this run, with its requirements and their versions', text: scope },
      {
        label: 'Already proposed or validated',
        text: run.domainId === null ? (already === '' ? 'Nothing yet.' : already) : null,
      },
    ]
  })

export const LIVING_SPEC_ROLE: RoleEntry = {
  id: 'living-spec',
  displayName: 'the living spec agent',
  ownerKind: 'project',
  placeKind: 'main-checkout',
  writes: false,
  readsMemory: false,
  projectLayer: true,
  mainOf: null,
  template: LIVING_SPEC_TEMPLATE,
  brief: livingSpecBrief,
  countsInCap: true,
  ledByUser: false,
}
