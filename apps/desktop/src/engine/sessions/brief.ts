/**
 * A session's brief: the first message after its instructions.
 *
 * It starts with `[hemera:brief]`, then the role's fields (a field with nothing in it is left out,
 * never sent as "none"), then — only for a role that reads the Memory — the Memory block of the
 * mission. A replacement, or a session rebuilt after a restart, gets a `[hemera:resume]` block
 * after it: for a role that reads the Memory, when its predecessor stopped and its last recorded
 * action, with the request to check the real state first; for one that does not, only "start
 * again from the beginning", never an extract of the Journal (CT-06).
 */

import { START_AGAIN, deliveryBlock, resumeSaid } from '@hemera/core/domain'
import { Context, Effect, Layer } from 'effect'

import { Memory } from '../memory/index.ts'
import type { BriefField, BriefedSession, RoleEntry, SessionOwner } from './roles.ts'

/** What the brief reads of the Memory. */
export class BriefSources extends Context.Service<
  BriefSources,
  {
    /** Now, the current notes and the end of the Journal, once the Memory is ready. */
    readonly memoryBlock: (missionId: string) => Effect.Effect<string>
    /** The last line written by or about a lineage, or null when there is none. */
    readonly lastLine: (missionId: string, lineage: string) => Effect.Effect<string | null>
  }
>()('BriefSources') {}

/** The brief's sources in the mission's Memory; a Memory that cannot be read gives nothing. */
export const memoryBriefSources = Layer.effect(
  BriefSources,
  Effect.gen(function* () {
    const memory = yield* Memory
    return {
      memoryBlock: (missionId) => memory.briefBlock(missionId).pipe(Effect.orElseSucceed(() => '')),
      lastLine: (missionId, lineage) =>
        memory.lastRecorded(missionId, lineage).pipe(
          Effect.map((line) => (line === null ? null : line.text)),
          Effect.orElseSucceed(() => null),
        ),
    }
  }),
)

/** The predecessor a replacement takes over from. */
export interface Predecessor {
  readonly lineage: string
  /** When it stopped, as the user reads a time. */
  readonly stoppedAt: string
}

/** The role's fields, a field with no text left out. */
export const fieldsText = (fields: ReadonlyArray<BriefField>): string =>
  fields
    .flatMap((field) =>
      field.text === null || field.text.trim() === ''
        ? []
        : [`## ${field.label}\n\n${field.text.trim()}`],
    )
    .join('\n\n')

/** The first message of a session after its instructions. */
export const briefOf = (
  role: RoleEntry,
  owner: SessionOwner,
  session: BriefedSession,
  predecessor: Predecessor | null,
) =>
  Effect.gen(function* () {
    const sources = yield* BriefSources
    const fields = fieldsText(yield* role.brief(owner, session))
    const missionId = owner.kind === 'mission' ? owner.missionId : null
    const memory =
      role.readsMemory && missionId !== null ? (yield* sources.memoryBlock(missionId)).trim() : ''
    const brief = deliveryBlock(
      'brief',
      [fields, memory].filter((part) => part !== '').join('\n\n'),
    )
    // A session the user leads is handed the end of its conversation instead, in its fields.
    if (predecessor === null || role.ledByUser) return brief
    const resume =
      role.readsMemory && missionId !== null
        ? resumeSaid(predecessor.stoppedAt, yield* sources.lastLine(missionId, predecessor.lineage))
        : START_AGAIN
    return `${brief}\n\n${deliveryBlock('resume', resume)}`
  })
