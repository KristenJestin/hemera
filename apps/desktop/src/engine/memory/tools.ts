/**
 * The agents' Memory tools, as the gate executes them once it has let a call through: reading the
 * Memory of the session's mission (or, read-only, of a mission it depends on; a Project's session,
 * the Chat, reads any mission of its Project), and writing only what the agent alone knows. No
 * write takes a mission: a session writes its own mission's Memory.
 */

import { readFile } from 'node:fs/promises'

import { type ToolArguments, missionKeyParts, sizeSaid } from '@hemera/core/domain'
import { AgentAuthor, type UnknownMission } from '@hemera/ipc'
import { and, eq } from 'drizzle-orm'
import { Effect } from 'effect'

import { Database, type DatabaseError, refusedWhile } from '../storage/database.ts'
import { missions } from '../storage/schema.ts'
import type { Grant } from '../tools/access.ts'
import { type ToolAnswer, answered, failure, refusal } from '../tools/files.ts'
import {
  Evidence,
  Memory,
  type MemoryCaller,
  type MemoryRefused,
  MissionDependencies,
} from './index.ts'
import { EvidenceRefused } from './evidence.ts'
import { lineText, notesText, nowText } from './render.ts'

/** The caller a grant stands for, when its session works for a mission. */
const callerOf = (grant: Grant): MemoryCaller | null =>
  grant.missionId === null
    ? null
    : {
        sessionId: grant.sessionId,
        role: grant.role,
        epoch: grant.epoch,
        missionId: grant.missionId,
      }

const NO_MISSION = refusal('refused: this session works for no mission')

/** The answer of a write the Memory refused, or of one that failed. */
const settled = <A, R>(
  effect: Effect.Effect<A, MemoryRefused | EvidenceRefused | DatabaseError | UnknownMission, R>,
  done: (value: A) => ToolAnswer,
) =>
  effect.pipe(
    Effect.map(done),
    Effect.catchTags({
      MemoryRefused: (refused) => Effect.succeed(refusal(refused.message)),
      EvidenceRefused: (refused) => Effect.succeed(refusal(`refused: ${refused.message}`)),
    }),
    Effect.catch((failed) => Effect.succeed(failure(`the call failed: ${failed.message}`))),
  )

/**
 * The mission `memory_read` reads: the session's own, a dependency named by its key, or, for a
 * Project's session, any mission of its Project named by its key.
 */
const readTarget = (grant: Grant, key: string | undefined) =>
  Effect.gen(function* () {
    const own = grant.missionId
    if (key === undefined) {
      return own === null
        ? ({ refused: 'name the mission to read by its key (`ACME-3`)' } as const)
        : ({ missionId: own } as const)
    }
    const parts = missionKeyParts(key)
    const database = yield* Database
    const [found] =
      parts === null
        ? []
        : yield* database
            .select({ id: missions.id, projectId: missions.projectId })
            .from(missions)
            .where(and(eq(missions.keyPrefix, parts.prefix), eq(missions.keyNumber, parts.number)))
            .pipe(Effect.mapError(refusedWhile('reading a mission')))
    if (found === undefined) return { refused: `no mission is ${key}` } as const
    if (found.id === own) return { missionId: found.id } as const
    if (found.projectId !== grant.projectId) {
      return {
        refused: `${key} is a mission of another Project, and nothing crosses Projects`,
      } as const
    }
    if (own === null) return { missionId: found.id } as const
    const accepted = yield* MissionDependencies.use((dependencies) => dependencies(own))
    if (!accepted.includes(found.id)) {
      return { refused: `this mission does not depend on ${key}` } as const
    }
    return { missionId: found.id } as const
  })

export const memoryRead = (grant: Grant, args: ToolArguments<'memory_read'>) =>
  Effect.gen(function* () {
    const target = yield* readTarget(grant, args.mission)
    if ('refused' in target) return refusal(`refused: ${target.refused}`)
    const memory = yield* Memory
    switch (args.part) {
      case 'now':
        return answered(nowText(yield* memory.now(target.missionId)))
      case 'notes': {
        const notes = yield* memory.notes(target.missionId, args.all ?? false)
        return answered(notes.length === 0 ? 'The mission has no note yet.' : notesText(notes))
      }
      case 'journal': {
        const page = yield* memory.journal(target.missionId, args.before ?? null)
        const lines = page.lines.map(lineText).join('\n')
        const further =
          page.before === null
            ? 'This is the first line of the Journal.'
            : `Older lines: memory_read with part journal and before ${String(page.before)}.`
        return answered(
          page.lines.length === 0 ? 'The Journal has no line here.' : `${lines}\n\n${further}`,
        )
      }
    }
  }).pipe(Effect.catch((failed) => Effect.succeed(failure(`the call failed: ${failed.message}`))))

export const nowSet = (grant: Grant, args: ToolArguments<'now_set'>) => {
  const caller = callerOf(grant)
  if (caller === null) return Effect.succeed(NO_MISSION)
  return settled(
    Memory.use((memory) =>
      memory.setNow(caller, { doing: args.doing ?? null, next: args.next ?? null }),
    ),
    () => answered('Now is updated.'),
  )
}

export const journalAdd = (grant: Grant, args: ToolArguments<'journal_add'>) => {
  const caller = callerOf(grant)
  if (caller === null) return Effect.succeed(NO_MISSION)
  return settled(
    Memory.use((memory) => memory.addJournal(caller, args.text)),
    () => answered('Added to the Journal.'),
  )
}

export const noteAdd = (grant: Grant, args: ToolArguments<'note_add'>) => {
  const caller = callerOf(grant)
  if (caller === null) return Effect.succeed(NO_MISSION)
  return settled(
    Memory.use((memory) => memory.addNote(caller, args.text, args.topic ?? null)),
    (number) => answered(`Note ${String(number)} is added.`),
  )
}

export const notesCondense = (grant: Grant, args: ToolArguments<'notes_condense'>) => {
  const caller = callerOf(grant)
  if (caller === null) return Effect.succeed(NO_MISSION)
  return settled(
    Memory.use((memory) =>
      memory.condenseNotes(caller, args.replaces, args.text, args.topic ?? null),
    ),
    (number) =>
      answered(`Notes ${args.replaces.join(', ')} are replaced by note ${String(number)}.`),
  )
}

/** `path` is the resolved path the gate let through its places rule, or null for a content. */
export const evidenceAdd = (
  grant: Grant,
  args: ToolArguments<'evidence_add'>,
  path: string | null,
) => {
  const caller = callerOf(grant)
  if (caller === null) return Effect.succeed(NO_MISSION)
  return settled(
    Effect.gen(function* () {
      yield* Memory.use((memory) => Effect.andThen(memory.ready, memory.checkEpoch(caller)))
      const content =
        path === null
          ? { text: args.content ?? '' }
          : {
              bytes: new Uint8Array(
                yield* Effect.tryPromise({
                  try: () => readFile(path),
                  catch: (cause) =>
                    new EvidenceRefused({
                      reason: `could not read ${args.path ?? path}: ${cause instanceof Error ? cause.message : String(cause)}`,
                    }),
                }),
              ),
            }
      return yield* Evidence.use((evidence) =>
        evidence.put({
          missionId: caller.missionId,
          content,
          name: args.name,
          about: args.about ?? null,
          author: AgentAuthor.make({ role: caller.role, sessionId: caller.sessionId }),
        }),
      )
    }),
    (item) =>
      answered(`Kept as evidence: ${item.name} (${item.mediaType}, ${sizeSaid(item.size)}).`),
  )
}
