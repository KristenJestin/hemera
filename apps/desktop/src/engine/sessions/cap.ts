/**
 * The Project's cap of simultaneous sub-agents (#41, CT-13). It counts every session Hemera runs
 * in the background for a Project beside the main one: the roles the registry says count, never
 * the main session of a mission nor a Chat. A slot is a lineage's: a replacement keeps it, and it
 * is released when the lineage stops.
 *
 * A launch an agent asks for above the cap is refused at once, with the sentence the agent reads;
 * never queued. A fixed Hemera phase waits for a slot in a fair queue of its Project, and Now says
 * so. One Project at its cap never affects another.
 */

import { slotWaitSentence, capRefusal } from '@hemera/core/domain'
import { eq } from 'drizzle-orm'
import { Context, Deferred, Effect, Layer, Semaphore } from 'effect'

import { Database, type DatabaseError, refusedWhile } from '../storage/database.ts'
import { projects } from '../storage/schema.ts'
import { SessionPost } from './post.ts'

/** Who asks for a launch: an agent's tool call, or a phase Hemera starts itself. */
export type RequestedBy = 'agent' | 'hemera'

/** A lineage asking for a slot, and the mission whose Now says it waits. */
export interface SlotAsked {
  readonly projectId: string
  readonly lineage: string
  readonly missionId: string | null
  readonly requestedBy: RequestedBy
}

export class Cap extends Context.Service<
  Cap,
  {
    /**
     * A slot for a lineage: held at once below the cap; above it, refused for an agent with the
     * sentence it reads, waited for by a Hemera phase. A lineage that holds one keeps it.
     */
    readonly acquire: (
      asked: SlotAsked,
    ) => Effect.Effect<
      { readonly held: true } | { readonly held: false; readonly sentence: string },
      DatabaseError
    >
    /** The lineage stopped: its slot goes to the first phase waiting in its Project. */
    readonly release: (lineage: string) => Effect.Effect<void, DatabaseError>
    /** The cap of a Project changed: the phases waiting take the slots it frees. */
    readonly wake: (projectId: string) => Effect.Effect<void, DatabaseError>
    /** What a lineage waiting for a slot reads (a Project's own phase), or null when it waits for none. */
    readonly waiting: (lineage: string) => Effect.Effect<string | null, DatabaseError>
  }
>()('Cap') {}

interface Waiting {
  readonly asked: SlotAsked
  readonly granted: Deferred.Deferred<void>
}

export const capLayer = Layer.effect(
  Cap,
  Effect.gen(function* () {
    const context = yield* Effect.context<Database>()
    const post = yield* SessionPost
    const lock = yield* Semaphore.make(1)
    /** The lineages holding a slot, by Project. */
    const held = new Map<string, Set<string>>()
    /** The phases waiting, by Project, the first come first. */
    const queues = new Map<string, Waiting[]>()

    const capOf = (projectId: string) =>
      Effect.gen(function* () {
        const database = yield* Database
        const [row] = yield* database
          .select({ cap: projects.subAgentCap })
          .from(projects)
          .where(eq(projects.id, projectId))
          .pipe(Effect.mapError(refusedWhile('reading the Project’s cap')))
        return row?.cap ?? 0
      }).pipe(Effect.provide(context))

    const holding = (projectId: string): Set<string> => {
      const found = held.get(projectId)
      if (found !== undefined) return found
      const fresh = new Set<string>()
      held.set(projectId, fresh)
      return fresh
    }

    const queueOf = (projectId: string): Waiting[] => {
      const found = queues.get(projectId)
      if (found !== undefined) return found
      const fresh: Waiting[] = []
      queues.set(projectId, fresh)
      return fresh
    }

    /** Hands the free slots of a Project to its phases waiting, in order; Now is told. */
    const grant = (projectId: string) =>
      Effect.gen(function* () {
        const cap = yield* capOf(projectId)
        const slots = holding(projectId)
        const queue = queueOf(projectId)
        while (queue.length > 0 && slots.size < cap) {
          const next = queue.shift()
          if (next === undefined) break
          slots.add(next.asked.lineage)
          if (next.asked.missionId !== null) yield* post.slotWait(next.asked.missionId, null)
          yield* Deferred.succeed(next.granted, undefined)
        }
        for (const waiting of queue) {
          if (waiting.asked.missionId === null) continue
          yield* post.slotWait(waiting.asked.missionId, slotWaitSentence(slots.size, cap))
        }
      })

    const projectOfLineage = (lineage: string): string | null =>
      [...held.entries()].find(([, slots]) => slots.has(lineage))?.[0] ?? null

    /** Whether a lineage holds a slot now, is refused one, or waits in the queue. */
    const decide = (asked: SlotAsked) =>
      Effect.gen(function* () {
        const slots = holding(asked.projectId)
        if (slots.has(asked.lineage)) return { held: true } as const
        const cap = yield* capOf(asked.projectId)
        const queue = queueOf(asked.projectId)
        if (slots.size < cap && queue.length === 0) {
          slots.add(asked.lineage)
          return { held: true } as const
        }
        if (asked.requestedBy === 'agent') {
          return { held: false, sentence: capRefusal(slots.size, cap) } as const
        }
        const granted = yield* Deferred.make<void>()
        queue.push({ asked, granted })
        yield* grant(asked.projectId)
        return { held: false, granted } as const
      }).pipe(Semaphore.withPermits(lock, 1))

    return {
      acquire: (asked) =>
        Effect.gen(function* () {
          const decided = yield* decide(asked)
          if (decided.held) return decided
          if (!('granted' in decided)) return decided
          const granted = decided.granted
          const queue = queueOf(asked.projectId)
          yield* Deferred.await(granted).pipe(
            Effect.onInterrupt(() =>
              Effect.gen(function* () {
                const index = queue.findIndex((one) => one.granted === granted)
                if (index >= 0) queue.splice(index, 1)
                if (asked.missionId !== null) yield* post.slotWait(asked.missionId, null)
              }),
            ),
          )
          return { held: true } as const
        }),
      release: (lineage) =>
        Effect.gen(function* () {
          const projectId = projectOfLineage(lineage)
          if (projectId === null) return
          holding(projectId).delete(lineage)
          yield* grant(projectId)
        }).pipe(Semaphore.withPermits(lock, 1)),
      wake: (projectId) => grant(projectId).pipe(Semaphore.withPermits(lock, 1)),
      waiting: (lineage) =>
        Effect.gen(function* () {
          const found = [...queues.entries()].find(([, queue]) =>
            queue.some((one) => one.asked.lineage === lineage),
          )
          if (found === undefined) return null
          const [projectId] = found
          return slotWaitSentence(holding(projectId).size, yield* capOf(projectId))
        }),
    }
  }),
)
