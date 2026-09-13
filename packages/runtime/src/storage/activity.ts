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
  database.run(
    `INSERT INTO activity_output (id, context_id, block_index, stream, content, recorded_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      `${block.contextId}:${next}`,
      block.contextId,
      next,
      block.stream,
      block.content,
      block.recordedAt,
    ],
  )
  return { ...block, blockIndex: next }
}

function nextBlockIndex(database: Database, contextId: string): number {
  const row = database
    .query('SELECT MAX(block_index) AS last FROM activity_output WHERE context_id = ?')
    .get(contextId) as { last: number | null }
  return (row.last ?? -1) + 1
}

export interface OutputPage {
  blocks: OutputBlock[]
  /** Index to read from next, or null when the end was reached. */
  nextBlockIndex: number | null
}

interface OutputRow {
  context_id: string
  block_index: number
  stream: string
  content: string
  recorded_at: number
}

/** Reads one bounded run of blocks of an execution context. */
export function readOutput(
  database: Database,
  contextId: string,
  from = 0,
  limit = MAX_OUTPUT_BLOCKS,
): OutputPage {
  const size = Math.min(Math.max(limit, 1), MAX_OUTPUT_BLOCKS)
  const rows = database
    .query(
      `SELECT * FROM activity_output
       WHERE context_id = ? AND block_index >= ?
       ORDER BY block_index LIMIT ?`,
    )
    .all(contextId, from, size + 1) as OutputRow[]

  const blocks = rows.slice(0, size).map((row) => ({
    contextId: row.context_id,
    blockIndex: row.block_index,
    stream: row.stream as OutputStream,
    content: row.content,
    recordedAt: row.recorded_at,
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
  const row = database
    .query(
      `SELECT COUNT(*) AS blocks, COALESCE(SUM(LENGTH(content)), 0) AS characters
       FROM activity_output WHERE context_id = ?`,
    )
    .get(contextId) as { blocks: number; characters: number }
  return { recordedBlocks: row.blocks, recordedCharacters: row.characters }
}

/** Whether a journal event type names technical output, which it never may. */
export function refuseOutputAsEvent(eventType: string): void {
  if (/output|stdout|stderr|log\b/i.test(eventType)) throw new OutputNotAnEventError()
}
