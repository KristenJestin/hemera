import { hemeraToolNamed } from '@hemera/core'
import type { SessionEntry } from '@hemera/ipc'
import type { ToolKind } from '@hemera/ui'
import { z } from 'zod'

import { hemeraToolCallOf } from './agent-tool-payloads.ts'

/**
 * The tool calls of a turn, folded into one group between two things the agent said (recette of
 * 26 September 2026, issue #149).
 *
 * A turn reads twelve files, lists five folders and runs two commands before it answers, and each
 * of those was a row of the thread: the answer was found at the end of a column of plumbing. So
 * every run of calls between two pieces of the agent's text is one row, folded — `12 actions`, and
 * what kinds they were — which unfolds to the rows it holds, as they were. Whatever the tools are:
 * the agent's own and Hemera's alike.
 *
 * A thought or a diff inside such a run goes into the group with the calls around it: they are
 * part of the work, not something said, and a thought between two reads would otherwise cut one
 * run of work into two groups. They are not counted: an action is a call. Anything else — the
 * agent's text, the user's message, a question, a permission, a run, a proposal, Hemera's own
 * line — ends the run, and a run of a single call stays the row it is.
 *
 * Pure and free of what `@hemera/ui` runs when it loads, so it is tested on Node; the page draws
 * the group.
 */

/** What a call is counted as: one of ACP's kinds, or a call to one of Hemera's own tools. */
export type ActionKind = ToolKind | 'hemera'

/** Where a call stands, as the group's dot says it: one running, one failed, or all done. */
export type ActionStatus = 'in_progress' | 'failed' | 'completed'

/** One call of a run. */
export interface Action {
  kind: ActionKind
  status: ActionStatus
}

/**
 * What a drawn block of the thread is to a run of calls: a call, a companion of the calls around
 * it (a thought, a diff), or `null` for anything else, which ends the run.
 */
export type Grouping = Action | 'companion' | null

/** What the agent's report of a call says of it, as far as counting it goes. */
const reportSchema = z.object({
  call: z.object({ title: z.string(), kind: z.string().nullable(), status: z.string().nullable() }),
})

const KINDS: readonly ToolKind[] = [
  'read',
  'edit',
  'delete',
  'move',
  'search',
  'execute',
  'think',
  'fetch',
  'other',
]

function parsed<S extends z.ZodType>(schema: S, payload: string): z.infer<S> | null {
  try {
    const read = schema.safeParse(JSON.parse(payload))
    return read.success ? read.data : null
  } catch {
    return null
  }
}

/** Where a call stands, told in the three words the group has: the rest are done. */
function statusOf(said: string | null): ActionStatus {
  if (said === 'pending' || said === 'in_progress') return 'in_progress'
  if (said === 'failed' || said === 'refused') return 'failed'
  return 'completed'
}

/**
 * What an entry of the thread is to a run of calls, read off the entry the page draws — Hemera's
 * own answer in place of the agent's report of it, where the thread holds both.
 */
export function groupingOf(entry: SessionEntry): Grouping {
  if (entry.kind === 'thought' || entry.kind === 'diff') return 'companion'
  if (entry.kind === 'hemera_tool_call') {
    const drawn = hemeraToolCallOf(entry)
    return drawn === null ? null : { kind: 'hemera', status: statusOf(drawn.status) }
  }
  if (entry.kind !== 'tool_call') return null
  const report = parsed(reportSchema, entry.payload)
  if (report === null) return null
  const { title, kind, status } = report.call
  if (hemeraToolNamed(title) !== null) return { kind: 'hemera', status: statusOf(status) }
  return { kind: KINDS.find((one) => one === kind) ?? 'other', status: statusOf(status) }
}

/** How many of one kind a group holds, in the words its line says them in. */
const SAID: Record<ActionKind, (count: number) => string> = {
  read: (count) => `read ${plural(count, 'file')}`,
  edit: (count) => `edited ${plural(count, 'file')}`,
  delete: (count) => `deleted ${plural(count, 'file')}`,
  move: (count) => `moved ${plural(count, 'file')}`,
  search: (count) => `searched ${count === 1 ? 'once' : `${String(count)} times`}`,
  execute: (count) => `ran ${plural(count, 'command')}`,
  think: (count) => `thought ${count === 1 ? 'once' : `${String(count)} times`}`,
  fetch: (count) => `fetched ${plural(count, 'page')}`,
  hemera: (count) => `${plural(count, 'Hemera call')}`,
  other: (count) => `${plural(count, 'other call')}`,
}

function plural(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? '' : 's'}`
}

/** What a group's line says it holds: `read 3 files, ran 2 commands`, kinds as they first came. */
export function summaryOf(actions: readonly Action[]): string {
  const counted = new Map<ActionKind, number>()
  for (const action of actions) counted.set(action.kind, (counted.get(action.kind) ?? 0) + 1)
  return [...counted].map(([kind, count]) => SAID[kind](count)).join(', ')
}

/** Where a group stands: running while one of its calls runs, failed if one failed, else done. */
export function groupStatusOf(actions: readonly Action[]): ActionStatus {
  if (actions.some((one) => one.status === 'in_progress')) return 'in_progress'
  if (actions.some((one) => one.status === 'failed')) return 'failed'
  return 'completed'
}

/** A piece of the thread once the runs are folded: a block as it was, or a group of them. */
export type Piece<T> =
  | { kind: 'one'; item: T }
  | { kind: 'group'; items: T[]; count: number; summary: string; status: ActionStatus }

/**
 * The blocks of a thread with every run of two calls or more folded into one group.
 *
 * `blocks` are the ones the thread draws, in order, each with what it is to a run. Companions at
 * either end of a run stay outside it — a thought before the first call is what the agent thought
 * before it began, and a diff after the last is read with what follows — and a run left with
 * fewer than two calls is not a group.
 */
export function groupActions<T>(blocks: readonly { item: T; grouping: Grouping }[]): Piece<T>[] {
  const pieces: Piece<T>[] = []
  let run: { item: T; grouping: Grouping }[] = []
  const close = (): void => {
    const first = run.findIndex((one) => one.grouping !== 'companion')
    const last = run.findLastIndex((one) => one.grouping !== 'companion')
    const actions = run.flatMap((one) =>
      one.grouping === null || one.grouping === 'companion' ? [] : [one.grouping],
    )
    if (actions.length < 2) {
      for (const one of run) pieces.push({ kind: 'one', item: one.item })
    } else {
      for (const one of run.slice(0, first)) pieces.push({ kind: 'one', item: one.item })
      pieces.push({
        kind: 'group',
        items: run.slice(first, last + 1).map((one) => one.item),
        count: actions.length,
        summary: summaryOf(actions),
        status: groupStatusOf(actions),
      })
      for (const one of run.slice(last + 1)) pieces.push({ kind: 'one', item: one.item })
    }
    run = []
  }
  for (const block of blocks) {
    if (block.grouping === null) {
      close()
      pieces.push({ kind: 'one', item: block.item })
      continue
    }
    run.push(block)
  }
  close()
  return pieces
}
