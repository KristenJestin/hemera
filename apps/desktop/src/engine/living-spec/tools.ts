/**
 * The living spec's tools (#93), as the gate executes them once it let a call through. Reading is
 * the Planner's, the Chat's and the living spec agent's, always of the session's own Project; the
 * proposals are the living spec agent's, for the run its session's lineage reads. No tool
 * validates, rejects or drops: that is the user's alone.
 */

import type { ToolArguments } from '@hemera/core/domain'
import { Effect } from 'effect'

import { getSession } from '../sessions/store.ts'
import type { Grant } from '../tools/access.ts'
import { type ToolAnswer, answered, failure, refusal } from '../tools/files.ts'
import {
  type Proposed,
  finishRun,
  livingSpecPage,
  proposeDomain,
  proposeObsolete,
  proposeRequirement,
  runOfLineage,
} from './store.ts'

const failed = <E extends { readonly message: string }>(error: E) =>
  Effect.succeed(failure(`the call failed: ${error.message}`))

/** The run the grant's session reads for; the refusal it reads when there is none. */
const runOf = (grant: Grant) =>
  Effect.gen(function* () {
    const session = yield* getSession(grant.sessionId)
    const run = yield* runOfLineage(session.lineage)
    return run?.projectId === grant.projectId ? run : null
  })

const NO_RUN = refusal('refused: this session reads the living spec for no bootstrap run')

/** A proposal's answer: its refusal as the agent reads it, or what it proposed. */
const proposing = <A, E extends { readonly message: string }, R>(
  grant: Grant,
  propose: (runId: string) => Effect.Effect<Proposed<A>, E, R>,
  said: (done: A) => string,
) =>
  Effect.gen(function* () {
    const run = yield* runOf(grant)
    if (run === null) return NO_RUN
    const outcome = yield* propose(run.id)
    return 'refused' in outcome ? refusal(outcome.refused) : answered(said(outcome.done))
  }).pipe(Effect.catch(failed))

export const livingSpecRead = (grant: Grant, args: ToolArguments<'living_spec_read'>) =>
  livingSpecPage(grant.projectId, args).pipe(
    Effect.map((page): ToolAnswer =>
      'found' in page ? answered(page.found) : refusal(`refused: ${page.missing}`),
    ),
    Effect.catch(failed),
  )

export const livingDomainPropose = (grant: Grant, args: ToolArguments<'living_domain_propose'>) =>
  proposing(
    grant,
    (runId) => proposeDomain(runId, args),
    (name) => `Proposed: the domain ${name}. Propose its requirements now.`,
  )

export const livingRequirementPropose = (
  grant: Grant,
  args: ToolArguments<'living_requirement_propose'>,
) =>
  proposing(
    grant,
    (runId) => proposeRequirement(runId, args),
    (id) =>
      args.replaces === undefined
        ? `Proposed: ${id}, in ${args.domain}.`
        : `Proposed: a replacement of ${id}, applied if the user validates ${args.domain}.`,
  )

export const livingRequirementObsolete = (
  grant: Grant,
  args: ToolArguments<'living_requirement_obsolete'>,
) =>
  proposing(
    grant,
    (runId) => proposeObsolete(runId, args),
    (id) => `Proposed: ${id} is obsolete, removed if the user validates its domain.`,
  )

export const livingSpecDone = (grant: Grant, args: ToolArguments<'living_spec_done'>) =>
  proposing(
    grant,
    (runId) => finishRun(runId, args.summary),
    () => 'Done: your summary is kept and the user is told. End your turn now.',
  )
