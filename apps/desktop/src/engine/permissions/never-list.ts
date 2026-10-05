/**
 * A Project's "never" list: the commands always refused to its agents. It is read live by every
 * call (a change applies to the next one, in every mission) and replaced whole by the user. An
 * entry is a program with its leading arguments, or a command of the Project's catalogue.
 */

import { NeverEntry } from '@hemera/core/domain'
import { asc, eq } from 'drizzle-orm'
import { Effect, Option, Predicate, Schema } from 'effect'

import { getCommand } from '../catalogue.ts'
import { getProject } from '../projects.ts'
import { Database, refusedWhile } from '../storage/database.ts'
import { projectNeverEntries } from '../storage/schema.ts'
import { mutate } from '../transaction.ts'

const readEntry = Schema.decodeUnknownOption(Schema.fromJsonString(NeverEntry))

/** A Project's "never" list, in its order; an entry this version cannot read is left out. */
export const neverList = (projectId: string) =>
  Effect.gen(function* () {
    yield* getProject(projectId)
    const database = yield* Database
    const rows = yield* database
      .select()
      .from(projectNeverEntries)
      .where(eq(projectNeverEntries.projectId, projectId))
      .orderBy(asc(projectNeverEntries.position))
      .pipe(Effect.mapError(refusedWhile('reading the never list')))
    return rows.flatMap((row) => Option.toArray(readEntry(row.entry)))
  })

/**
 * Replaces a Project's "never" list. A catalogue command it names must be one of the Project's;
 * a program's words are kept as they were written, without the empty ones.
 */
export const setNeverList = (projectId: string, entries: ReadonlyArray<NeverEntry>) =>
  Effect.gen(function* () {
    yield* getProject(projectId)
    for (const entry of entries) {
      if (Predicate.isTagged(entry, 'Command')) yield* getCommand(projectId, entry.commandId)
    }
    yield* mutate('writing the never list', (transaction) =>
      Effect.gen(function* () {
        yield* transaction
          .delete(projectNeverEntries)
          .where(eq(projectNeverEntries.projectId, projectId))
          .pipe(Effect.mapError(refusedWhile('writing the never list')))
        if (entries.length > 0) {
          yield* transaction
            .insert(projectNeverEntries)
            .values(
              entries.map((entry, position) => ({
                id: crypto.randomUUID(),
                projectId,
                position,
                entry: JSON.stringify(entry),
              })),
            )
            .pipe(Effect.mapError(refusedWhile('writing the never list')))
        }
        return {
          result: undefined,
          events: [
            {
              type: 'project.never_list_changed',
              entityKind: 'project',
              entityId: projectId,
              source: 'ui',
              author: 'human',
              payload: { entries: entries.length },
            } as const,
          ],
        }
      }),
    )
    return yield* neverList(projectId)
  })
