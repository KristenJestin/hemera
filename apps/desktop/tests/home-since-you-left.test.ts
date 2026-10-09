/**
 * "Since you left" on Home: the events worth telling since the user last looked, grouped by
 * mission, newest first, paged, and followed. Each test runs the engine as it starts, over a data
 * folder of its own; the events are written through the same door as the engine's own, so what a
 * test reads is what a real change would have told.
 */

import { mkdirSync, realpathSync } from 'node:fs'
import { join } from 'node:path'

import { ErrorFields, MissionOwner, DecisionFields } from '@hemera/core/domain'
import type { SincePage } from '@hemera/ipc'
import { Effect, Fiber, Stream } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import {
  SINCE_PAGE,
  lookedAtHome,
  sinceYouLeft,
  sinceYouLeftChanges,
} from '../src/engine/home/since-you-left.ts'
import type { EventPayload, NewEvent } from '../src/engine/journal.ts'
import { createMission } from '../src/engine/missions.ts'
import { createNeed, needService } from '../src/engine/needs.ts'
import { createProject } from '../src/engine/projects.ts'
import { mutate } from '../src/engine/transaction.ts'
import { commandsEngine, until } from './commands-engine.ts'
import { removeFolders, temporaryFolder } from './storage.ts'

let data: string
let work: string

beforeEach(() => {
  data = realpathSync.native(temporaryFolder('since-you-left'))
  work = realpathSync.native(temporaryFolder('since-you-left-work'))
})
afterEach(removeFolders)

const engine = () => commandsEngine(data)

const acme = () => {
  const folder = join(work, 'acme')
  mkdirSync(folder, { recursive: true })
  return createProject({ name: 'Acme', mainCheckout: folder, repositories: [] })
}

const mission = (projectId: string, sentence: string) =>
  createMission({ projectId, idea: { sentence, ticket: null } })

/** An event of the engine's own, written and told as a change would have. */
const tell = (
  event: Pick<NewEvent, 'type' | 'entityKind' | 'entityId'> & { payload?: EventPayload },
) =>
  mutate('telling an event', () =>
    Effect.succeed({
      result: undefined,
      events: [
        {
          type: event.type,
          entityKind: event.entityKind,
          entityId: event.entityId,
          source: 'system' as const,
          author: 'hemera' as const,
          payload: event.payload ?? {},
        },
      ],
    }),
  )

const triaged = (missionId: string) =>
  tell({ type: 'planning.triaged', entityKind: 'mission', entityId: missionId })

const delivered = (missionId: string, on: string) =>
  tell({ type: 'mission.unblocked', entityKind: 'mission', entityId: missionId, payload: { on } })

const done = (missionId: string) =>
  tell({
    type: 'mission.moved',
    entityKind: 'mission',
    entityId: missionId,
    payload: { from: 'shipping', to: 'done', move: 'ship', actor: 'user', round: 1 },
  })

const sequences = (page: SincePage) =>
  page.groups.flatMap((group) => group.events.map((event) => event.sequence))

describe('Since you left', () => {
  test('groups the events by mission, the mission of the newest event first, each newest first', async () => {
    const page = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const project = yield* acme()
          const first = yield* mission(project.id, 'Add roles')
          const second = yield* mission(project.id, 'Export notes')
          yield* triaged(first.id)
          yield* done(second.id)
          yield* delivered(first.id, 'ACME-9')
          return yield* sinceYouLeft(null)
        }),
      ),
    )
    expect(page.before).toBeNull()
    expect(page.groups.map((group) => group.title)).toEqual(['Add roles', 'Export notes'])
    const [one, two] = page.groups
    expect(one?.missionKey).toBe('ACME-1')
    expect(one?.events.map((event) => event.tone)).toEqual(['lifted', 'answer'])
    expect(one?.events[0]?.text).toBe('ACME-9 is delivered: this mission can be built')
    expect(one?.events[0]?.at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(two?.events.map((event) => event.tone)).toEqual(['done'])
    expect(two?.events[0]?.text).toBe('The mission is done')
    const newestFirst = one?.events.map((event) => event.sequence) ?? []
    expect(newestFirst[0]).toBeGreaterThan(newestFirst[1] ?? Infinity)
  })

  test('tells only the events worth telling', async () => {
    const page = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const project = yield* acme()
          const one = yield* mission(project.id, 'Add roles')
          // A move the user made towards Review, a mark, a pending decision: not told.
          yield* tell({
            type: 'mission.moved',
            entityKind: 'mission',
            entityId: one.id,
            payload: { from: 'planning', to: 'building', move: 'launch', actor: 'user', round: 1 },
          })
          yield* tell({ type: 'mission.mark_set', entityKind: 'mission', entityId: one.id })
          yield* createNeed(
            needService('billing'),
            MissionOwner.make({ projectId: project.id, missionId: one.id, taskId: null }),
            DecisionFields.make({
              question: 'Which table?',
              options: ['a', 'b'],
              recommended: null,
            }),
          )
          yield* tell({
            type: 'tickets.changed',
            entityKind: 'mission',
            entityId: one.id,
            payload: { kind: 'label_added', key: '#12' },
          })
          return yield* sinceYouLeft(null)
        }),
      ),
    )
    expect(page.groups).toEqual([])
  })

  test('says a failure, a ticket change, a restore and a triage answer in plain words', async () => {
    const page = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const project = yield* acme()
          const one = yield* mission(project.id, 'Add roles')
          yield* createNeed(
            needService('billing'),
            MissionOwner.make({ projectId: project.id, missionId: one.id, taskId: null }),
            ErrorFields.make({ failed: 'The build broke', attempts: [], proposals: [] }),
          )
          yield* tell({
            type: 'tickets.changed',
            entityKind: 'mission',
            entityId: one.id,
            payload: { kind: 'comment_added', key: '#12' },
          })
          yield* tell({
            type: 'mission.restored',
            entityKind: 'mission',
            entityId: one.id,
            payload: { takenAt: '2026-10-01' },
          })
          yield* triaged(one.id)
          return yield* sinceYouLeft(null)
        }),
      ),
    )
    expect(page.groups).toHaveLength(1)
    const events = page.groups[0]?.events ?? []
    expect(events.map((event) => [event.tone, event.text])).toEqual([
      ['answer', 'The Planner answered the triage'],
      ['info', 'Restored from a backup'],
      ['ticket', 'A comment on #12'],
      ['failed', 'Something failed on this mission'],
    ])
  })

  test('puts the events of a Project itself under the Project', async () => {
    const page = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const project = yield* acme()
          yield* tell({
            type: 'livingSpec.bootstrap_finished',
            entityKind: 'project',
            entityId: project.id,
            payload: { state: 'done' },
          })
          yield* tell({
            type: 'livingSpec.bootstrap_finished',
            entityKind: 'project',
            entityId: project.id,
            payload: { state: 'failed' },
          })
          return { page: yield* sinceYouLeft(null), projectId: project.id }
        }),
      ),
    )
    const [group] = page.page.groups
    expect(page.page.groups).toHaveLength(1)
    expect(group).toMatchObject({
      projectId: page.projectId,
      missionId: null,
      missionKey: null,
      title: 'Acme',
      ball: null,
    })
    expect(group?.events.map((event) => event.tone)).toEqual(['failed', 'done'])
  })

  test('shows nothing older once the user looked, and only what comes after', async () => {
    const { seen, quiet, newer } = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const project = yield* acme()
          const one = yield* mission(project.id, 'Add roles')
          yield* triaged(one.id)
          const before = yield* sinceYouLeft(null)
          yield* lookedAtHome(Math.max(...sequences(before)))
          const after = yield* sinceYouLeft(null)
          // Looking again, with nothing new, moves nothing back.
          yield* lookedAtHome(1)
          yield* delivered(one.id, 'ACME-9')
          const later = yield* sinceYouLeft(null)
          return { seen: before, quiet: after, newer: later }
        }),
      ),
    )
    expect(sequences(seen)).toHaveLength(1)
    expect(quiet).toEqual({ groups: [], before: null })
    expect(newer.groups[0]?.events.map((event) => event.tone)).toEqual(['lifted'])
  })

  test('an event committed after the page was read is still told once the user looked up to it', async () => {
    const { read, after } = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const project = yield* acme()
          const one = yield* mission(project.id, 'Add roles')
          yield* triaged(one.id)
          const first = yield* sinceYouLeft(null)
          // Committed after the page was drawn: never rendered.
          yield* delivered(one.id, 'ACME-9')
          yield* lookedAtHome(Math.max(...sequences(first)))
          return { read: first, after: yield* sinceYouLeft(null) }
        }),
      ),
    )
    expect(sequences(read)).toHaveLength(1)
    expect(after.groups[0]?.events.map((event) => event.tone)).toEqual(['lifted'])
  })

  test('the cursor never goes past the latest event and never goes back', async () => {
    const pages = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const project = yield* acme()
          const one = yield* mission(project.id, 'Add roles')
          yield* triaged(one.id)
          yield* lookedAtHome(1_000_000)
          // Further than anything that exists: later events are still new.
          yield* delivered(one.id, 'ACME-9')
          const later = yield* sinceYouLeft(null)
          yield* lookedAtHome(0)
          return { later, again: yield* sinceYouLeft(null) }
        }),
      ),
    )
    expect(pages.later.groups[0]?.events.map((event) => event.tone)).toEqual(['lifted'])
    expect(pages.again).toEqual(pages.later)
  })

  test('looking sends the first page again, for the other windows', async () => {
    const pages = await engine()(({ profile }) =>
      profile.use(
        Effect.scoped(
          Effect.gen(function* () {
            const project = yield* acme()
            const one = yield* mission(project.id, 'Add roles')
            yield* triaged(one.id)
            const heard: SincePage[] = []
            const following = yield* Effect.forkChild(
              Stream.runForEach(sinceYouLeftChanges, (page) => Effect.sync(() => heard.push(page))),
            )
            yield* until(
              Effect.sync(() => heard.length),
              (count) => count >= 1,
            )
            yield* lookedAtHome(Math.max(...sequences(heard[0] ?? { groups: [], before: null })))
            yield* until(
              Effect.sync(() => heard.length),
              (count) => count >= 2,
            )
            yield* Fiber.interrupt(following)
            return heard
          }),
        ),
      ),
    )
    expect(pages[0]?.groups).toHaveLength(1)
    expect(pages.at(-1)?.groups).toEqual([])
  })

  test('keeps the cursor across an engine restart', async () => {
    await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const project = yield* acme()
          const one = yield* mission(project.id, 'Add roles')
          yield* triaged(one.id)
          yield* lookedAtHome(Math.max(...sequences(yield* sinceYouLeft(null))))
        }),
      ),
    )
    const page = await engine()(({ profile }) => profile.use(sinceYouLeft(null)))
    expect(page.groups).toEqual([])
  })

  test('pages by the cursor: a full page, then the older events, then no more', async () => {
    const { latest, older } = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const project = yield* acme()
          const one = yield* mission(project.id, 'Add roles')
          for (let n = 0; n < SINCE_PAGE + 5; n += 1) yield* triaged(one.id)
          const newest = yield* sinceYouLeft(null)
          const second = yield* sinceYouLeft(newest.before)
          return { latest: newest, older: second }
        }),
      ),
    )
    expect(sequences(latest)).toHaveLength(SINCE_PAGE)
    expect(latest.before).not.toBeNull()
    expect(sequences(older)).toHaveLength(5)
    expect(older.before).toBeNull()
    const all = [...sequences(latest), ...sequences(older)]
    expect(new Set(all).size).toBe(SINCE_PAGE + 5)
    expect(Math.min(...sequences(latest))).toBeGreaterThan(Math.max(...sequences(older)))
  })

  test('sends the first page again after each event worth telling, and not for another', async () => {
    const pages = await engine()(({ profile }) =>
      profile.use(
        Effect.scoped(
          Effect.gen(function* () {
            const project = yield* acme()
            const one = yield* mission(project.id, 'Add roles')
            const heard: SincePage[] = []
            const following = yield* Effect.forkChild(
              Stream.runForEach(sinceYouLeftChanges, (page) => Effect.sync(() => heard.push(page))),
            )
            yield* until(
              Effect.sync(() => heard.length),
              (count) => count >= 1,
            )
            yield* tell({ type: 'mission.mark_set', entityKind: 'mission', entityId: one.id })
            yield* triaged(one.id)
            yield* until(
              Effect.sync(() => heard.length),
              (count) => count >= 2,
            )
            yield* Fiber.interrupt(following)
            return heard
          }),
        ),
      ),
    )
    expect(pages).toHaveLength(2)
    expect(pages[0]?.groups).toEqual([])
    expect(pages[1]?.groups[0]?.events.map((event) => event.tone)).toEqual(['answer'])
  })
})
