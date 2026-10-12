/**
 * A Project's checks (#143), as its settings keep them: the list, the defaults proposed from the
 * catalogue's check commands (only proposed: nothing is saved until the user accepts them), a check
 * written, removed or moved.
 *
 * Saving checks the whole check first (`checkRefusal`), then what only the Project knows: a
 * command of its catalogue, a repository it declares. A refusal carries the sentence the settings
 * show. A running mission never reads these rows: it reads the copy taken at its launch (CT-34).
 */

import {
  CHECK_WHEN,
  CHECK_WHERE,
  type CheckDraft,
  type CheckWhen,
  type CheckWhere,
  type ProjectCheck,
  checkRefusal,
  proposeChecks,
} from '@hemera/core/domain'
import { CheckRefused, type Project, UnknownProjectCheck } from '@hemera/ipc'
import { and, asc, eq } from 'drizzle-orm'
import { Effect } from 'effect'

import { listCommands } from './catalogue.ts'
import type { EventPayload } from './journal.ts'
import { getProject } from './projects.ts'
import { Database, type EngineTransaction, refusedWhile } from './storage/database.ts'
import { projectChecks } from './storage/schema.ts'
import { mutate } from './transaction.ts'

type CheckRow = typeof projectChecks.$inferSelect

const whereOf = (value: string): CheckWhere => CHECK_WHERE.find((one) => one === value) ?? 'root'
const whenOf = (value: string): CheckWhen => CHECK_WHEN.find((one) => one === value) ?? 'end'

const checkOf = (row: CheckRow): ProjectCheck => ({
  id: row.id,
  projectId: row.projectId,
  name: row.name,
  commandId: row.commandId,
  line: row.line,
  where: whereOf(row.where),
  repository: row.repository,
  when: whenOf(row.when),
  // Both or neither, as they are written.
  expect:
    row.expectPattern === null || row.expectMinimum === null
      ? null
      : { pattern: row.expectPattern, minimum: row.expectMinimum },
  files: row.files,
  rank: row.rank,
})

/** The columns a check is written as: its name and line trimmed, no line beside a command. */
const columnsOf = (draft: CheckDraft) => ({
  name: draft.name.trim(),
  commandId: draft.commandId,
  line: draft.commandId === null ? (draft.line?.trim() ?? '') : null,
  where: draft.where,
  repository: draft.repository,
  when: draft.when,
  expectPattern: draft.expect?.pattern ?? null,
  expectMinimum: draft.expect?.minimum ?? null,
  files: draft.files,
})

const rowsIn = (reader: EngineTransaction, projectId: string) =>
  reader
    .select()
    .from(projectChecks)
    .where(eq(projectChecks.projectId, projectId))
    .orderBy(asc(projectChecks.rank))
    .pipe(Effect.mapError(refusedWhile('reading the checks')))

const checkEvent = (type: string, projectId: string, payload: EventPayload) => ({
  type,
  entityKind: 'project',
  entityId: projectId,
  source: 'ui' as const,
  author: 'human' as const,
  payload,
})

/** The Project's checks, in their order. */
export const listChecks = (projectId: string) =>
  Effect.gen(function* () {
    yield* getProject(projectId)
    const database = yield* Database
    const rows = yield* database
      .select()
      .from(projectChecks)
      .where(eq(projectChecks.projectId, projectId))
      .orderBy(asc(projectChecks.rank))
      .pipe(Effect.mapError(refusedWhile('reading the checks')))
    return rows.map(checkOf)
  })

/**
 * The checks proposed from the catalogue's check commands, never saved: none for a Project that
 * already has checks, unless the user asks.
 */
export const proposedChecks = (projectId: string, asked: boolean) =>
  Effect.gen(function* () {
    const kept = yield* listChecks(projectId)
    if (kept.length > 0 && !asked) return []
    return proposeChecks(yield* listCommands(projectId))
  })

/** Why a check cannot be written beside the Project's others, or nothing. */
const refusal = (project: Project, draft: CheckDraft, taken: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const problem = checkRefusal(draft, taken)
    if (problem !== null) {
      return yield* new CheckRefused({ reason: problem.sentence, field: problem.field })
    }
    if (
      draft.repository !== null &&
      !project.repositories.some((one) => one.path === draft.repository)
    ) {
      return yield* new CheckRefused({
        reason: `${draft.repository} is not a repository of this Project.`,
      })
    }
    if (draft.commandId === null) return
    const commands = yield* listCommands(project.id)
    if (!commands.some((one) => one.id === draft.commandId)) {
      return yield* new CheckRefused({
        reason: 'The command chosen is no longer in the catalogue.',
      })
    }
  })

const inserted = (
  transaction: EngineTransaction,
  projectId: string,
  draft: CheckDraft,
  rank: number,
) =>
  Effect.gen(function* () {
    const row: CheckRow = {
      id: crypto.randomUUID(),
      projectId,
      ...columnsOf(draft),
      rank,
      createdAt: new Date().toISOString(),
    }
    yield* transaction
      .insert(projectChecks)
      .values(row)
      .pipe(Effect.mapError(refusedWhile('writing the check')))
    return checkOf(row)
  })

/** Writes a check: a new one, last, when `id` is null; the one `id` names otherwise. */
export const saveCheck = (projectId: string, id: string | null, draft: CheckDraft) =>
  Effect.gen(function* () {
    const project = yield* getProject(projectId)
    const database = yield* Database
    const rows = yield* database.transaction((reader) => rowsIn(reader, projectId))
    const existing = id === null ? undefined : rows.find((row) => row.id === id)
    if (id !== null && existing === undefined) return yield* new UnknownProjectCheck({ id })
    yield* refusal(
      project,
      draft,
      rows.filter((row) => row.id !== id).map((row) => row.name),
    )
    return yield* mutate('saving a check', (transaction) =>
      Effect.gen(function* () {
        if (existing === undefined) {
          const check = yield* inserted(
            transaction,
            projectId,
            draft,
            (rows.at(-1)?.rank ?? -1) + 1,
          )
          return {
            result: check,
            events: [
              checkEvent('check.created', projectId, { checkId: check.id, name: check.name }),
            ],
          }
        }
        const columns = columnsOf(draft)
        yield* transaction
          .update(projectChecks)
          .set(columns)
          .where(eq(projectChecks.id, existing.id))
          .pipe(Effect.mapError(refusedWhile('writing the check')))
        const check = checkOf({ ...existing, ...columns })
        return {
          result: check,
          events: [checkEvent('check.updated', projectId, { checkId: check.id, name: check.name })],
        }
      }),
    )
  })

/** Saves the proposals kept, in their order and all at once: one refused refuses them all. */
export const acceptChecks = (projectId: string, proposals: ReadonlyArray<CheckDraft>) =>
  Effect.gen(function* () {
    const project = yield* getProject(projectId)
    const database = yield* Database
    const rows = yield* database.transaction((reader) => rowsIn(reader, projectId))
    const taken = rows.map((row) => row.name)
    for (const proposal of proposals) {
      yield* refusal(project, proposal, taken)
      taken.push(proposal.name.trim())
    }
    return yield* mutate('accepting the proposed checks', (transaction) =>
      Effect.gen(function* () {
        let rank = (rows.at(-1)?.rank ?? -1) + 1
        const saved: ProjectCheck[] = []
        for (const proposal of proposals) {
          saved.push(yield* inserted(transaction, projectId, proposal, rank))
          rank += 1
        }
        return {
          result: saved,
          events: saved.map((check) =>
            checkEvent('check.created', projectId, { checkId: check.id, name: check.name }),
          ),
        }
      }),
    )
  })

/** Takes a check out of the Project; the results it left in Buildings stay. */
export const removeCheck = (projectId: string, id: string) =>
  Effect.gen(function* () {
    yield* getProject(projectId)
    yield* mutate('removing a check', (transaction) =>
      Effect.gen(function* () {
        const [removed] = yield* transaction
          .delete(projectChecks)
          .where(and(eq(projectChecks.id, id), eq(projectChecks.projectId, projectId)))
          .returning()
          .pipe(Effect.mapError(refusedWhile('removing the check')))
        if (removed === undefined) return yield* new UnknownProjectCheck({ id })
        return {
          result: undefined,
          events: [checkEvent('check.removed', projectId, { checkId: id, name: removed.name })],
        }
      }),
    )
  })

/** Moves a check to its 0-based place in the list; answers the list. */
export const moveCheck = (projectId: string, id: string, rank: number) =>
  Effect.gen(function* () {
    yield* getProject(projectId)
    yield* mutate('moving a check', (transaction) =>
      Effect.gen(function* () {
        const rows = yield* rowsIn(transaction, projectId)
        const moved = rows.find((row) => row.id === id)
        if (moved === undefined) return yield* new UnknownProjectCheck({ id })
        const others = rows.filter((row) => row.id !== id)
        const at = Math.max(0, Math.min(others.length, Math.trunc(rank)))
        const order = [...others.slice(0, at), moved, ...others.slice(at)]
        for (const [index, row] of order.entries()) {
          if (row.rank === index) continue
          yield* transaction
            .update(projectChecks)
            .set({ rank: index })
            .where(eq(projectChecks.id, row.id))
            .pipe(Effect.mapError(refusedWhile('moving the check')))
        }
        return {
          result: undefined,
          events: [checkEvent('check.moved', projectId, { checkId: id, rank: at })],
        }
      }),
    )
    return yield* listChecks(projectId)
  })
