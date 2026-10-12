/**
 * The Prototyper in Planning (#222), around the helpers that run it: the user's ask for a
 * prototype, handed to the Planner as `[hemera:prototype]`; the user's verdict on a Prototyper's
 * result; and what the Freeze reads of them: a Prototyper running, or done and not judged yet,
 * holds it, and every result judged is frozen with the Spec.
 */

import {
  type PrototypeVerdict,
  PROTOTYPER,
  STAGES,
  type Stage,
  helperLabel,
  missionKey,
  prototypeUnsettled,
} from '@hemera/core/domain'
import { type FrozenPrototype, PlanningRefused, UnknownHelper } from '@hemera/ipc'
import { and, asc, eq } from 'drizzle-orm'
import { Effect } from 'effect'

import { helperEvent, helperRow } from '../building/helper-store.ts'
import { Secrets } from '../secrets.ts'
import { type EngineTransaction, refusedWhile } from '../storage/database.ts'
import { helpers } from '../storage/schema.ts'
import { mutate } from '../transaction.ts'
import { missionRow } from './store.ts'
import { PlannerWake } from './wake.ts'

const stageOf = (stage: string): Stage => STAGES.find((one) => one === stage) ?? 'cancelled'

const capitalised = (text: string): string => `${text.charAt(0).toUpperCase()}${text.slice(1)}`

/** What the Planner is handed when the user asks for a prototype. */
export const prototypeAsked = (question: string): string =>
  `The user asks for a prototype: ${question}\nLaunch the Prototyper with helper_launch (helper "prototyper"), their question in its brief.`

/** The user asks for a prototype: the Planner is handed it, and launches the Prototyper. */
export const askPrototype = (missionId: string, question: string) =>
  Effect.gen(function* () {
    const mission = yield* mutate('reading the mission', (transaction) =>
      Effect.map(missionRow(transaction, missionId), (row) => ({ result: row, events: [] })),
    )
    const key = missionKey(mission.keyPrefix, mission.keyNumber)
    const refused = new PlanningRefused({
      reason: `${key} is ${capitalised(stageOf(mission.stage))}: a prototype is asked for in Planning.`,
    })
    if (stageOf(mission.stage) !== 'planning') return yield* refused
    const told = yield* PlannerWake.use((wake) =>
      wake.deliver(missionId, 'prototype', prototypeAsked(question)),
    )
    // The mission left Planning between the read and the delivery.
    if (!told) return yield* refused
  })

/**
 * The user's verdict on a Prototyper's result, with what they said: in Planning, once it handed it
 * back. Given again, the latest stands.
 */
export const judgePrototype = (helperId: string, verdict: PrototypeVerdict, note: string | null) =>
  mutate('judging a prototype', (transaction) =>
    Effect.gen(function* () {
      const row = yield* helperRow(helperId, transaction)
      if (row === null) return yield* new UnknownHelper({ id: helperId })
      const label = helperLabel(row.number)
      if (row.definition !== PROTOTYPER.id) {
        return yield* new PlanningRefused({ reason: `${label} is not a Prototyper.` })
      }
      // A helper's row goes with its mission's: its mission is there.
      const mission = yield* missionRow(transaction, row.missionId).pipe(
        Effect.catchTag('UnknownMission', Effect.die),
      )
      const stage = stageOf(mission.stage)
      if (stage !== 'planning') {
        return yield* new PlanningRefused({
          reason: `${missionKey(mission.keyPrefix, mission.keyNumber)} is ${capitalised(stage)}: a prototype is judged in Planning.`,
        })
      }
      if (row.state !== 'done') {
        return yield* new PlanningRefused({
          reason:
            row.state === 'failed'
              ? `${label} failed: it has no result to judge.`
              : `${label} has no result to judge yet.`,
        })
      }
      const secrets = yield* Secrets
      const said = note === null || note.trim() === '' ? null : secrets.mask(note.trim())
      yield* transaction
        .update(helpers)
        .set({ verdict, verdictNote: said, judgedAt: new Date().toISOString() })
        .where(eq(helpers.id, row.id))
        .pipe(Effect.mapError(refusedWhile('judging a prototype')))
      return {
        result: undefined,
        events: [
          {
            ...helperEvent('prototype.judged', row, { verdict, note: said }),
            source: 'ui' as const,
            author: 'human' as const,
          },
        ],
      }
    }),
  )

/** A mission's Prototypers, the first launched first, in the transaction given. */
const prototypersIn = (transaction: EngineTransaction, missionId: string) =>
  transaction
    .select()
    .from(helpers)
    .where(and(eq(helpers.missionId, missionId), eq(helpers.definition, PROTOTYPER.id)))
    .orderBy(asc(helpers.number))
    .pipe(Effect.mapError(refusedWhile('reading the Prototypers')))

const verdictOf = (verdict: string | null): PrototypeVerdict | null =>
  verdict === 'validated' || verdict === 'set-aside' ? verdict : null

/** The Prototypers that hold the Freeze, in words: one running, one done and not judged. */
export const prototypesUnsettledIn = (transaction: EngineTransaction, missionId: string) =>
  Effect.map(prototypersIn(transaction, missionId), (rows) =>
    rows.flatMap((row) => {
      const said = prototypeUnsettled({
        label: helperLabel(row.number),
        state: row.state === 'running' || row.state === 'done' ? row.state : 'failed',
        verdict: verdictOf(row.verdict),
        question: row.brief,
      })
      return said === null ? [] : [said]
    }),
  )

/** Every Prototyper's result the user judged, as the Freeze keeps it. */
export const frozenPrototypesIn = (transaction: EngineTransaction, missionId: string) =>
  Effect.map(prototypersIn(transaction, missionId), (rows) =>
    rows.flatMap((row): ReadonlyArray<FrozenPrototype> => {
      const verdict = verdictOf(row.verdict)
      if (verdict === null || row.result === null) return []
      return [
        {
          helper: helperLabel(row.number),
          question: row.brief,
          verdict,
          note: row.verdictNote,
          result: row.result,
        },
      ]
    }),
  )
