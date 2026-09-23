/**
 * The execution of the `define` protocol, persisted per revision in `spec_phases` (design D7-08).
 *
 * The protocol itself is `DEFINE_PROTOCOL` in `@hemera/core`, and so is every decision about it:
 * which phase opens, which becomes stale, what a phase must hold to finish. This file writes
 * what those pure functions decide, and says so in the Journal.
 */

import {
  type PhaseId,
  type SectionName,
  type SpecPhase,
  type SpecSnapshot,
  type SpecWriter,
  DEFINE_PROTOCOL,
  nextPhaseStates,
  phaseExit,
  sectionOwner,
  staleAfterWrite,
} from '@hemera/core'
import { eq } from 'drizzle-orm'
import { Data, Effect } from 'effect'

import type { NewEvent } from '../journal.ts'
import type { EngineTransaction } from '../storage/database.ts'
import { specPhases } from '../storage/schema.ts'
import { failed, specEvent } from './snapshot.ts'

/** A phase declaration the protocol refuses: not open, or its exit checks fail (D7-08). */
export class PhaseRefusedError extends Data.TaggedError('PhaseRefusedError')<{
  readonly reason: string
}> {
  override get message(): string {
    return this.reason
  }
}

/** What an agent hands over when it declares a phase finished (D7-08). */
export interface Declaration {
  summary: string
  assumptions: readonly string[]
}

/** The event a phase entering a state is journaled as (D7-13). */
const ENTERED: Partial<Record<SpecPhase['state'], string>> = {
  open: 'spec.phase_opened',
  finished: 'spec.phase_finished',
  stale: 'spec.phase_stale',
}

function iso(epoch: number | null): string | null {
  return epoch === null ? null : new Date(epoch).toISOString()
}

/**
 * The phases of a new revision (D7-08): every available phase pending, then opened by the
 * protocol when it waits for nothing (`shape`); `prototype` is unavailable in this version.
 */
export function firstPhases(revisionId: string): SpecPhase[] {
  return nextPhaseStates(
    DEFINE_PROTOCOL.phases.map(({ id, available }) => ({
      id: crypto.randomUUID(),
      revisionId,
      phase: id,
      state: available ? 'pending' : 'unavailable',
      summary: null,
      assumptions: [],
      basis: {},
      protocolVersion: DEFINE_PROTOCOL.version,
      declaredAt: null,
    })),
  )
}

/** Writes the phase rows of a revision, as they are handed. */
export function insertPhases(transaction: EngineTransaction, phases: readonly SpecPhase[]) {
  return transaction
    .insert(specPhases)
    .values(
      phases.map((phase) => ({
        id: phase.id,
        revisionId: phase.revisionId,
        phase: phase.phase,
        state: phase.state,
        summary: phase.summary,
        assumptions: JSON.stringify(phase.assumptions),
        basis: JSON.stringify(phase.basis),
        protocolVersion: phase.protocolVersion,
        declaredAt: iso(phase.declaredAt),
      })),
    )
    .pipe(Effect.mapError(failed('writing the phases')))
}

/**
 * Persists every phase whose state changed from `before` to `after`, and journals each entry into
 * `open`, `finished` or `stale` (D7-13).
 */
function settle(
  transaction: EngineTransaction,
  snapshot: SpecSnapshot,
  before: readonly SpecPhase[],
  after: readonly SpecPhase[],
  actor: SpecWriter,
) {
  return Effect.gen(function* () {
    const events: NewEvent[] = []
    for (const phase of after) {
      const was = before.find((candidate) => candidate.id === phase.id)
      if (was?.state === phase.state) continue
      yield* transaction
        .update(specPhases)
        .set({
          state: phase.state,
          summary: phase.summary,
          assumptions: JSON.stringify(phase.assumptions),
          basis: JSON.stringify(phase.basis),
          declaredAt: iso(phase.declaredAt),
        })
        .where(eq(specPhases.id, phase.id))
        .pipe(Effect.mapError(failed('writing the phase')))
      const type = ENTERED[phase.state]
      if (type === undefined) continue
      events.push(
        specEvent(snapshot.spec, snapshot.revision.id, type, {
          author: actor.kind,
          sessionId: actor.sessionId,
          phaseId: phase.phase,
          payload: { phase: phase.phase, state: phase.state },
        }),
      )
    }
    return events
  })
}

/**
 * After a section write (D7-08): the finished phases it depends on become `stale`, and every
 * phase the protocol now allows opens.
 */
export function afterSectionWrite(
  transaction: EngineTransaction,
  snapshot: SpecSnapshot,
  section: SectionName,
  actor: SpecWriter,
) {
  const stale = staleAfterWrite(section, snapshot.phases)
  const marked = snapshot.phases.map((phase): SpecPhase =>
    stale.includes(phase.phase) ? { ...phase, state: 'stale' } : phase,
  )
  return settle(transaction, snapshot, snapshot.phases, nextPhaseStates(marked), actor)
}

/** The versions of the sections a phase owns, as it is declared on them (D7-08). */
function basisOf(phase: PhaseId, snapshot: SpecSnapshot): SpecPhase['basis'] {
  return Object.fromEntries(
    snapshot.sections
      .filter((section) => sectionOwner(section.name) === phase)
      .map((section) => [section.name, section.version]),
  )
}

/**
 * Declares a phase finished (D7-08): only an open or stale phase, and only when its mechanical
 * exit checks pass; the basis is the current version of the sections it owns. Then every phase
 * the protocol allows opens.
 */
export function declare(
  transaction: EngineTransaction,
  snapshot: SpecSnapshot,
  phase: PhaseId,
  actor: SpecWriter,
  declaration: Declaration,
) {
  return Effect.gen(function* () {
    const row = snapshot.phases.find((candidate) => candidate.phase === phase)
    if (row === undefined || (row.state !== 'open' && row.state !== 'stale')) {
      return yield* Effect.fail(
        new PhaseRefusedError({
          reason: `The ${phase} phase is ${row?.state ?? 'missing'}: only an open or stale phase is declared finished.`,
        }),
      )
    }
    const failures = phaseExit(phase, snapshot)
    if (failures.length > 0) {
      return yield* Effect.fail(
        new PhaseRefusedError({
          reason: `The ${phase} phase cannot finish: ${failures.map((failure) => failure.message).join('; ')}.`,
        }),
      )
    }
    const finished = snapshot.phases.map((candidate): SpecPhase =>
      candidate.id === row.id
        ? {
            ...candidate,
            state: 'finished',
            summary: declaration.summary,
            assumptions: [...declaration.assumptions],
            basis: basisOf(phase, snapshot),
            declaredAt: Date.now(),
          }
        : candidate,
    )
    const declared = specEvent(snapshot.spec, snapshot.revision.id, 'spec.phase_declared', {
      author: actor.kind,
      sessionId: actor.sessionId,
      phaseId: phase,
      payload: {
        phase,
        summary: declaration.summary,
        assumptions: declaration.assumptions.length,
      },
    })
    const settled = yield* settle(
      transaction,
      snapshot,
      snapshot.phases,
      nextPhaseStates(finished),
      actor,
    )
    return [declared, ...settled]
  })
}
