/**
 * What Planning shares in memory between the gate, which runs the Planner's writes, and the parts
 * above it (#85): which Spec changed, what each Planner turn wrote (one `spec.drafted` per turn
 * that wrote, never one per call), which sections are being written while a call runs, and each
 * declaration Hemera's check passed. A board in memory: the Spec itself is in the database.
 */

import type { SpecSectionName } from '@hemera/core/domain'
import { SECTION_TITLES } from '@hemera/core/domain'
import { Context, Effect, Layer, PubSub, Semaphore, Stream } from 'effect'
import type { Scope } from 'effect'

import type { Log } from '../../main/diagnostic.ts'

/** One thing a Planner's call wrote, as the turn's Journal line says it. */
export type Wrote =
  | { readonly kind: 'section'; readonly name: SpecSectionName }
  | { readonly kind: 'added' | 'changed' | 'removed'; readonly id: string }
  | { readonly kind: 'described' }

/** A declaration Hemera's check passed: `first` when none was recorded before in this Planning. */
export interface Declared {
  readonly missionId: string
  readonly version: number
  readonly first: boolean
}

export class SpecBoard extends Context.Service<
  SpecBoard,
  {
    /** A mission's Spec changed: its followers read it again. */
    readonly changed: (missionId: string) => Effect.Effect<void>
    /** The missions whose Spec changes from now on, for as long as the scope lasts. */
    readonly changes: Effect.Effect<Stream.Stream<string>, never, Scope.Scope>
    /** A call of a session wrote these items of its mission's Spec. */
    readonly wrote: (
      sessionId: string,
      missionId: string,
      items: ReadonlyArray<Wrote>,
    ) => Effect.Effect<void>
    /** What a session's turn wrote, taken: null when it wrote nothing. */
    readonly takeWrites: (
      sessionId: string,
    ) => Effect.Effect<{ readonly missionId: string; readonly items: ReadonlyArray<Wrote> } | null>
    /** A `spec_write_section` call began, for a section of a mission, or ended. */
    readonly writing: (
      call: string,
      at: { readonly missionId: string; readonly section: SpecSectionName } | null,
    ) => Effect.Effect<void>
    /** The sections of a mission being written now. */
    readonly beingWritten: (missionId: string) => Effect.Effect<ReadonlySet<SpecSectionName>>
    readonly declared: (declared: Declared) => Effect.Effect<void>
    /** `spec.declared_complete`: every passing declaration from now on (#91, #92 follow it). */
    readonly declarations: Effect.Effect<Stream.Stream<Declared>, never, Scope.Scope>
    /**
     * Runs the rewrite of a mission's readable file after its other rewrites: two at once could
     * leave the file at the older version.
     */
    readonly filing: (
      missionId: string,
    ) => <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
    /** Says in the diagnostic log what Planning could not do and went on without. */
    readonly said: (line: string) => Effect.Effect<void>
  }
>()('SpecBoard') {}

export const specBoardLayer = (log: Log) =>
  Layer.effect(
    SpecBoard,
    Effect.gen(function* () {
      const changes = yield* PubSub.unbounded<string>()
      const declarations = yield* PubSub.unbounded<Declared>()
      const writes = new Map<string, { missionId: string; items: Wrote[] }>()
      const calls = new Map<string, { missionId: string; section: SpecSectionName }>()
      const changed = (missionId: string) => PubSub.publish(changes, missionId).pipe(Effect.asVoid)
      const files = new Map<string, Semaphore.Semaphore>()
      const fileLock = (missionId: string) => {
        const known = files.get(missionId)
        if (known !== undefined) return known
        const made = Semaphore.makeUnsafe(1)
        files.set(missionId, made)
        return made
      }
      return {
        changed,
        changes: Effect.map(PubSub.subscribe(changes), Stream.fromSubscription),
        wrote: (sessionId, missionId, items) =>
          Effect.sync(() => {
            const kept = writes.get(sessionId) ?? { missionId, items: [] }
            kept.items.push(...items)
            writes.set(sessionId, kept)
          }),
        takeWrites: (sessionId) =>
          Effect.sync(() => {
            const kept = writes.get(sessionId)
            writes.delete(sessionId)
            return kept === undefined || kept.items.length === 0 ? null : kept
          }),
        writing: (call, at) =>
          Effect.suspend(() => {
            const before = calls.get(call)
            if (at === null) calls.delete(call)
            else calls.set(call, at)
            const missionId = at?.missionId ?? before?.missionId
            return missionId === undefined ? Effect.void : changed(missionId)
          }),
        beingWritten: (missionId) =>
          Effect.sync(
            () =>
              new Set(
                [...calls.values()]
                  .filter((call) => call.missionId === missionId)
                  .map((call) => call.section),
              ),
          ),
        declared: (declared) => PubSub.publish(declarations, declared).pipe(Effect.asVoid),
        declarations: Effect.map(PubSub.subscribe(declarations), Stream.fromSubscription),
        filing: (missionId) => Semaphore.withPermits(fileLock(missionId), 1),
        said: (line) => Effect.sync(() => log(`planning: ${line}`)),
      }
    }),
  )

/** Ids said as runs: `R1 to R4, R6`. */
const runsOf = (ids: ReadonlyArray<string>): string => {
  const numbered = ids.map((id) => ({ id, number: Number(/^R(\d+)$/.exec(id)?.[1] ?? Number.NaN) }))
  const said: string[] = []
  let start = 0
  for (let at = 1; at <= numbered.length; at += 1) {
    const previous = numbered[at - 1]
    const current = numbered[at]
    if (current !== undefined && previous !== undefined && current.number === previous.number + 1)
      continue
    const first = numbered[start]
    if (first !== undefined && previous !== undefined) {
      said.push(first.id === previous.id ? first.id : `${first.id} to ${previous.id}`)
    }
    start = at
  }
  return said.join(', ')
}

/** What a turn wrote, as one Journal line: "Wrote Why, Goals; added R1 to R4; removed R2". */
export function draftedSaid(items: ReadonlyArray<Wrote>): string {
  const once = (kind: Wrote['kind']) => [
    ...new Set(
      items.flatMap((item) => {
        if (item.kind !== kind) return []
        if (item.kind === 'section') return [SECTION_TITLES[item.name]]
        return item.kind === 'described' ? [] : [item.id]
      }),
    ),
  ]
  const sections = once('section')
  const added = once('added')
  const changed = once('changed').filter((id) => !added.includes(id))
  const removed = once('removed')
  return [
    sections.length === 0 ? null : `wrote ${sections.join(', ')}`,
    added.length === 0 ? null : `added ${runsOf(added)}`,
    changed.length === 0 ? null : `changed ${runsOf(changed)}`,
    removed.length === 0 ? null : `removed ${runsOf(removed)}`,
    items.some((item) => item.kind === 'described') ? 'named the mission' : null,
  ]
    .filter((part) => part !== null)
    .join('; ')
    .replace(/^./, (first) => first.toUpperCase())
}
