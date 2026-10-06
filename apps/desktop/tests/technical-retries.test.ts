/**
 * CT-14's technical retries (#41): three replacements of one lineage in 30 minutes make an error
 * need on its owner ("the agent keeps failing"), with the reasons and the last lines it wrote, and
 * stop the replacements until the user answers; a restart's resume counts nowhere; a replacement
 * spends no business attempt and no launch. On the engine as it starts, with the fake agent.
 */

import { realpathSync } from 'node:fs'

import { ChosenAnswer } from '@hemera/core/domain'
import { Effect, Predicate } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { answerNeed, listNeeds, recheckNeeds } from '../src/engine/needs.ts'
import { setRoleSetting } from '../src/engine/sessions/cascade.ts'
import { Sessions } from '../src/engine/sessions/service.ts'
import { getSession, sessionsIn } from '../src/engine/sessions/store.ts'
import { Database } from '../src/engine/storage/database.ts'
import { missionSpent } from '../src/engine/storage/schema.ts'
import { removeFolders, temporaryFolder } from './storage.ts'
import { acmeIn, sessionsEngine, until, within } from './sessions-world.ts'

let data: string
let work: string

beforeEach(() => {
  data = realpathSync.native(temporaryFolder('technical-retries'))
  work = realpathSync.native(temporaryFolder('technical-retries-work'))
})
afterEach(removeFolders)

const acme = Effect.suspend(() => acmeIn(work))

const SAYS_DONE = { steps: [{ does: 'says' as const, text: 'Still exporting the invoices.' }] }

const pendingNeeds = Effect.map(listNeeds, (groups) => groups.flatMap((group) => group.needs))

/** The live session of a lineage, once its start has settled. */
const liveOf = (lineage: string) =>
  Effect.gen(function* () {
    const [live] = (yield* sessionsIn(['starting', 'working', 'idle'])).filter(
      (one) => one.lineage === lineage,
    )
    if (live === undefined) return yield* Effect.die(new Error('no live session'))
    yield* Sessions.use((sessions) => sessions.settled(live.id))
    return live
  })

const replaceLive = (lineage: string, reason: string) =>
  Effect.gen(function* () {
    const live = yield* liveOf(lineage)
    return yield* Sessions.use((sessions) => sessions.replace(live.id, reason))
  })

describe('Three replacements of one lineage in 30 minutes (CT-14)', () => {
  test('the third makes an error need with the reasons and the output, and stops the replacements', async () => {
    const { run } = sessionsEngine(data, () => SAYS_DONE)
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { owner, main } = yield* acme
          const first = yield* Sessions.use((sessions) =>
            sessions.open({ owner, role: 'builder', provider: 'claude', folder: main }),
          )
          const second = yield* replaceLive(first.lineage, 'its agent stopped')
          const third = yield* replaceLive(first.lineage, 'no activity for 5 minutes')
          const last = yield* liveOf(first.lineage)
          const refused = yield* Sessions.use((sessions) =>
            sessions.replace(last.id, 'its agent stopped'),
          )
          const needs = yield* pendingNeeds
          const spent = yield* Effect.flatMap(Database, (database) =>
            database.select().from(missionSpent),
          )
          return {
            second,
            third,
            refused,
            needs,
            last: yield* getSession(last.id),
            live: (yield* sessionsIn(['starting', 'working', 'idle'])).length,
            spent,
          }
        }),
      ),
    )
    expect(seen.second).not.toBeNull()
    expect(seen.third).not.toBeNull()
    expect(seen.refused).toBeNull()
    expect(seen.last.state).toBe('failed')
    expect(seen.live).toBe(0)
    expect(seen.needs).toHaveLength(1)
    const fields = seen.needs[0]?.fields
    const error = Predicate.isTagged(fields, 'Error') ? fields : null
    expect(error?.failed).toContain('The agent keeps failing: the Builder')
    expect(error?.attempts.map((attempt) => attempt.what)).toEqual([
      'its agent stopped',
      'no activity for 5 minutes',
      'its agent stopped',
    ])
    expect(error?.attempts[2]?.output).toContain('Still exporting the invoices.')
    expect(error?.proposals).toEqual(['Retry', 'Change the model for this role'])
    expect(seen.spent).toEqual([])
  })

  test('answering it starts the lineage again, its count begun anew', async () => {
    const { run } = sessionsEngine(data, () => SAYS_DONE)
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { owner, main } = yield* acme
          const first = yield* Sessions.use((sessions) =>
            sessions.open({ owner, role: 'builder', provider: 'claude', folder: main }),
          )
          yield* replaceLive(first.lineage, 'its agent stopped')
          yield* replaceLive(first.lineage, 'its agent stopped')
          yield* replaceLive(first.lineage, 'its agent stopped')
          const [need] = yield* pendingNeeds
          if (need === undefined) return yield* Effect.die(new Error('no need'))
          yield* answerNeed({
            id: need.id,
            key: 'answer-1',
            answer: ChosenAnswer.make({ option: 'Retry' }),
          })
          yield* until(
            Effect.map(sessionsIn(['starting', 'working', 'idle']), (live) => live.length === 1),
          )
          const again = yield* replaceLive(first.lineage, 'its agent stopped')
          return { again }
        }),
      ),
    )
    expect(seen.again).not.toBeNull()
  })

  test('“Change the model” starts the lineage again only once its setting changed', async () => {
    const { run } = sessionsEngine(data, () => SAYS_DONE)
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { owner, main } = yield* acme
          const first = yield* Sessions.use((sessions) =>
            sessions.open({ owner, role: 'builder', folder: main }),
          )
          yield* replaceLive(first.lineage, 'its agent stopped')
          yield* replaceLive(first.lineage, 'its agent stopped')
          yield* replaceLive(first.lineage, 'its agent stopped')
          const [need] = yield* pendingNeeds
          if (need === undefined) return yield* Effect.die(new Error('no need'))
          yield* answerNeed({
            id: need.id,
            key: 'answer-1',
            answer: ChosenAnswer.make({ option: 'Change the model for this role' }),
          })
          yield* until(Effect.map(pendingNeeds, (needs) => needs.some((one) => one.id !== need.id)))
          const [waiting] = yield* pendingNeeds
          yield* recheckNeeds
          const liveBefore = yield* sessionsIn(['starting', 'working', 'idle'])
          yield* setRoleSetting('app', null, 'builder', {
            agent: 'codex',
            model: null,
            effort: null,
          })
          yield* recheckNeeds
          yield* until(
            Effect.map(sessionsIn(['starting', 'working', 'idle']), (live) => live.length === 1),
          )
          const after = yield* liveOf(first.lineage)
          return {
            waiting,
            liveBefore: liveBefore.length,
            after: yield* getSession(after.id),
            lineage: first.lineage,
          }
        }),
      ),
    )
    const fields = seen.waiting?.fields
    expect(Predicate.isTagged(fields, 'Environment') ? fields.settingsSection : null).toBe('models')
    expect(seen.liveBefore).toBe(0)
    expect(seen.after).toMatchObject({ lineage: seen.lineage, provider: 'codex' })
  })

  test('a resume after a restart counts nowhere', async () => {
    const { run } = sessionsEngine(data, () => SAYS_DONE)
    const lineage = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { owner, main } = yield* acme
          const first = yield* Sessions.use((sessions) =>
            sessions.open({ owner, role: 'builder', provider: 'claude', folder: main }),
          )
          yield* replaceLive(first.lineage, 'its agent stopped')
          yield* liveOf(first.lineage)
          return first.lineage
        }),
      ),
    )
    const again = await sessionsEngine(data, () => SAYS_DONE).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          yield* until(
            Effect.map(sessionsIn(['starting', 'working', 'idle']), (live) =>
              live.some((one) => one.lineage === lineage && one.epoch === 2),
            ),
          )
          return yield* replaceLive(lineage, 'its agent stopped')
        }),
      ),
    )
    expect(again).not.toBeNull()
  })
})
