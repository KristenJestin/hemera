/**
 * Technical output, kept apart from the journal.
 *
 * A long stream of output belongs to its execution context, not to the business provenance:
 * inserting it as an event would drown the journal and make it unreadable. It is appended in
 * blocks and read back in blocks, so consulting an execution never loads it whole.
 *
 * What was displayed and what was recorded are two different things. The store reports how
 * much it actually holds, so a portion that only reached the screen is never presented as
 * saved.
 */

import type { Database } from 'bun:sqlite'
import { and, asc, count, eq, gte, max, sql } from 'drizzle-orm'

import { orm } from './orm.ts'
import { activityOutput } from './schema.ts'

/** Which stream a block came from. */
export type OutputStream = 'stdout' | 'stderr'

export interface OutputBlock {
  contextId: string
  blockIndex: number
  stream: OutputStream
  content: string
  recordedAt: number
}

export interface AppendOutput {
  contextId: string
  stream: OutputStream
  content: string
  recordedAt: number
}

/** Blocks a read hands out at most. */
export const MAX_OUTPUT_BLOCKS = 100

export class OutputNotAnEventError extends Error {
  constructor() {
    super('technical output is recorded in its execution context, never as a journal event')
    this.name = 'OutputNotAnEventError'
  }
}

/** Appends one block of output and returns the block it became. */
export function appendOutput(database: Database, block: AppendOutput): OutputBlock {
  const next = nextBlockIndex(database, block.contextId)
  orm(database)
    .insert(activityOutput)
    .values({
      id: `${block.contextId}:${next}`,
      contextId: block.contextId,
      blockIndex: next,
      stream: block.stream,
      content: block.content,
      recordedAt: block.recordedAt,
    })
    .run()
  return { ...block, blockIndex: next }
}

function nextBlockIndex(database: Database, contextId: string): number {
  const row = orm(database)
    .select({ last: max(activityOutput.blockIndex) })
    .from(activityOutput)
    .where(eq(activityOutput.contextId, contextId))
    .get()
  return (row?.last ?? -1) + 1
}

export interface OutputPage {
  blocks: OutputBlock[]
  /** Index to read from next, or null when the end was reached. */
  nextBlockIndex: number | null
}

/** Reads one bounded run of blocks of an execution context. */
export function readOutput(
  database: Database,
  contextId: string,
  from = 0,
  limit = MAX_OUTPUT_BLOCKS,
): OutputPage {
  const size = Math.min(Math.max(limit, 1), MAX_OUTPUT_BLOCKS)
  const rows = orm(database)
    .select()
    .from(activityOutput)
    .where(and(eq(activityOutput.contextId, contextId), gte(activityOutput.blockIndex, from)))
    .orderBy(asc(activityOutput.blockIndex))
    .limit(size + 1)
    .all()

  const blocks = rows.slice(0, size).map((row) => ({
    contextId: row.contextId,
    blockIndex: row.blockIndex,
    stream: row.stream as OutputStream,
    content: row.content,
    recordedAt: row.recordedAt,
  }))
  const next =
    rows.length > size && blocks.length > 0 ? blocks[blocks.length - 1]!.blockIndex + 1 : null
  return { blocks, nextBlockIndex: next }
}

export interface OutputExtent {
  /** How many blocks the store actually holds for this context. */
  recordedBlocks: number
  /** Characters actually recorded; what only reached the screen is not counted. */
  recordedCharacters: number
}

/** What is really persisted for an execution context. */
export function outputExtent(database: Database, contextId: string): OutputExtent {
  const row = orm(database)
    .select({
      blocks: count(),
      // The length of what is stored, not of what was handed over: a block the store
      // refused would otherwise be counted as recorded.
      characters: sql<number>`coalesce(sum(length(${activityOutput.content})), 0)`,
    })
    .from(activityOutput)
    .where(eq(activityOutput.contextId, contextId))
    .get()
  return { recordedBlocks: row?.blocks ?? 0, recordedCharacters: row?.characters ?? 0 }
}

/** Whether a journal event type names technical output, which it never may. */
export function refuseOutputAsEvent(eventType: string): void {
  if (/output|stdout|stderr|log\b/i.test(eventType)) throw new OutputNotAnEventError()
}
