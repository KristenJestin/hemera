/**
 * The Notes: what was learned on the way, numbered in their mission, added and condensed.
 *
 * Condensing writes one note that replaces several: the replaced notes keep their rows with the
 * number of the note that replaced them, are left out of the brief and of the default reading, and
 * stay readable with `all`. Each is an event, and one Journal line.
 */

import type { Masked } from '@hemera/core/domain'
import { AgentAuthor, type MemoryNote } from '@hemera/ipc'
import { and, asc, eq, inArray, isNull, max } from 'drizzle-orm'
import { Effect } from 'effect'

import type { NewEvent } from '../journal.ts'
import { Database, type EngineTransaction, refusedWhile } from '../storage/database.ts'
import { memoryNotes } from '../storage/schema.ts'
import { authorColumnsOf, authorOf } from './journal.ts'

type NoteRow = typeof memoryNotes.$inferSelect

const noteOf = (row: NoteRow): MemoryNote => ({
  number: row.number,
  missionId: row.missionId,
  text: row.text,
  topic: row.topic,
  author: authorOf(row),
  at: row.createdAt,
  replacedBy: row.replacedBy,
})

/** A mission's notes in their order: the current ones, or all of them with `all`. */
export const readNotes = (missionId: string, all: boolean) =>
  Effect.gen(function* () {
    const database = yield* Database
    const rows = yield* database
      .select()
      .from(memoryNotes)
      .where(
        and(eq(memoryNotes.missionId, missionId), all ? undefined : isNull(memoryNotes.replacedBy)),
      )
      .orderBy(asc(memoryNotes.number))
      .pipe(Effect.mapError(refusedWhile('reading the notes')))
    return rows.map(noteOf)
  })

/** Who writes a note: an agent's session. */
export interface NoteAuthor {
  readonly role: string
  readonly sessionId: string
}

const nextNumber = (transaction: EngineTransaction, missionId: string) =>
  Effect.map(
    transaction
      .select({ last: max(memoryNotes.number) })
      .from(memoryNotes)
      .where(eq(memoryNotes.missionId, missionId))
      .pipe(Effect.mapError(refusedWhile('numbering a note'))),
    ([row]) => (row?.last ?? 0) + 1,
  )

const insertNote = (
  transaction: EngineTransaction,
  missionId: string,
  text: Masked<string>,
  topic: Masked<string> | null,
  author: NoteAuthor,
) =>
  Effect.gen(function* () {
    const number = yield* nextNumber(transaction, missionId)
    yield* transaction
      .insert(memoryNotes)
      .values({
        id: crypto.randomUUID(),
        missionId,
        number,
        text,
        topic,
        ...authorColumnsOf(AgentAuthor.make({ role: author.role, sessionId: author.sessionId })),
        replacedBy: null,
        createdAt: new Date().toISOString(),
      })
      .pipe(Effect.mapError(refusedWhile('writing a note')))
    return number
  })

const noteEvent = (
  type: string,
  missionId: string,
  author: NoteAuthor,
  payload: NewEvent['payload'],
): NewEvent => ({
  type,
  entityKind: 'mission',
  entityId: missionId,
  source: 'system',
  author: 'agent',
  payload: { ...payload, role: author.role, sessionId: author.sessionId },
})

/** Adds a note; answers its number and its event. */
export const addNote = (
  transaction: EngineTransaction,
  missionId: string,
  text: Masked<string>,
  topic: Masked<string> | null,
  author: NoteAuthor,
) =>
  Effect.map(insertNote(transaction, missionId, text, topic, author), (number) => ({
    number,
    event: noteEvent('memory.note_added', missionId, author, { number, text, topic }),
  }))

/**
 * Replaces current notes by one; answers its number and its event, or the numbers among `replaces`
 * that are not current notes of the mission, and then writes nothing.
 */
export const condenseNotes = (
  transaction: EngineTransaction,
  missionId: string,
  replaces: ReadonlyArray<number>,
  text: Masked<string>,
  topic: Masked<string> | null,
  author: NoteAuthor,
) =>
  Effect.gen(function* () {
    const wanted = [...new Set(replaces)]
    const found = yield* transaction
      .select({ number: memoryNotes.number })
      .from(memoryNotes)
      .where(
        and(
          eq(memoryNotes.missionId, missionId),
          inArray(memoryNotes.number, wanted),
          isNull(memoryNotes.replacedBy),
        ),
      )
      .pipe(Effect.mapError(refusedWhile('reading the notes')))
    const current = new Set(found.map((row) => row.number))
    const missing = wanted.filter((number) => !current.has(number))
    if (missing.length > 0) return { missing } as const
    const number = yield* insertNote(transaction, missionId, text, topic, author)
    yield* transaction
      .update(memoryNotes)
      .set({ replacedBy: number })
      .where(and(eq(memoryNotes.missionId, missionId), inArray(memoryNotes.number, wanted)))
      .pipe(Effect.mapError(refusedWhile('condensing the notes')))
    return {
      number,
      event: noteEvent('memory.notes_condensed', missionId, author, {
        number,
        replaced: wanted.map(String),
        text,
        topic,
      }),
    } as const
  })
