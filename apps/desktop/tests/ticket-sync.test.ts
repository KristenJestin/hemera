/**
 * The ticket sync (#97), on the engine as it starts, with the fake tracker of `fake-tracker.ts`
 * behind the providers' port (never a real tracker), a temporary data folder, and a Project Acme in
 * linked mode whose missions come from issues of `acme/shop`.
 *
 * Every wait is on state (`until`, a held grouped question), never on time; the schedule's own test
 * runs on the test clock.
 */

import { mkdirSync, realpathSync } from 'node:fs'
import { join } from 'node:path'

import { type Mark, OutdatedMark, parseTicketReference } from '@hemera/core/domain'
import { InvalidSyncInterval, TicketEventRefused } from '@hemera/ipc'
import { Duration, Effect, Fiber, Predicate, Queue, Stream } from 'effect'
import { TestClock } from 'effect/testing'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { DomainEvents } from '../src/engine/domain-events.ts'
import { readEvents } from '../src/engine/journal.ts'
import { deliveryOf } from '../src/main/notifications.ts'
import { getMission, moveMission } from '../src/engine/missions.ts'
import {
  REGISTRY,
  noticesOf,
  readNotificationSettings,
  setNotificationKind,
} from '../src/engine/notifications.ts'
import { freezeReadiness } from '../src/engine/planning/freeze.ts'
import { inputsOf } from '../src/engine/planning/questions.ts'
import { createProject } from '../src/engine/projects.ts'
import type { ReconciliationStep } from '../src/engine/reconciliation.ts'
import { createStart } from '../src/engine/start/field.ts'
import { Database } from '../src/engine/storage/database.ts'
import { ticketEventRuns } from '../src/engine/storage/schema.ts'
import {
  acknowledgeEvent,
  keepOwnVersion,
  keepVersion,
  ticketEventDifference,
  ticketEventsOf,
} from '../src/engine/tickets/events.ts'
import { missionTicket, readTicket } from '../src/engine/tickets/link.ts'
import { TicketProviders } from '../src/engine/tickets/search.ts'
import { addGithub, setSpecMode } from '../src/engine/tickets/store.ts'
import {
  TicketSync,
  lastCheckOf,
  syncIntervalOf,
  syncSchedule,
} from '../src/engine/tickets/sync.ts'
import { commandsEngine } from './commands-engine.ts'
import { type FakeTracker, fakeTracker } from './fake-tracker.ts'
import { repository } from './repositories.ts'
import { PASSING, everyAgentFound, until } from './sessions-world.ts'
import { removeFolders, temporaryFolder } from './storage.ts'

let data: string
let work: string
beforeEach(() => {
  data = realpathSync.native(temporaryFolder('ticket-sync'))
  work = realpathSync.native(temporaryFolder('ticket-sync-work'))
})
afterEach(removeFolders)

const engine = (tracker: FakeTracker, schedules = false) =>
  commandsEngine(data, {
    ticketProviders: tracker.layer,
    ticketSync: { schedules },
    missions: { guards: PASSING },
    // No agent of the machine is ever looked for: a Planner the sync wakes cannot start here.
    sessions: { discovery: everyAgentFound },
  })

/** Acme in linked mode, its GitHub provider listing `acme/shop`. */
const acme = (mode: 'linked' | 'local' = 'linked', name = 'Acme') =>
  Effect.gen(function* () {
    const main = join(work, name.toLowerCase())
    mkdirSync(main, { recursive: true })
    repository(join(main, 'api'))
    const project = yield* createProject({ name, mainCheckout: main, repositories: ['api'] })
    const provider = yield* addGithub(project.id, {
      host: 'github.com',
      repositories: ['acme/shop'],
    })
    yield* setSpecMode(project.id, mode)
    return { project, provider }
  })

const reference = (text: string) => {
  const parsed = parseTicketReference(text)
  if (parsed === null) throw new Error(`${text} is not a reference`)
  return parsed
}

/** A mission of the Project from `acme/shop#<number>`. */
const fromIssue = (projectId: string, number: number) =>
  createStart({
    projectId,
    ticket: { reference: reference(`acme/shop#${String(number)}`) },
    idempotencyKey: `issue-${String(number)}`,
  })

const check = (projectId: string) => TicketSync.use((sync) => sync.check(projectId))

const kinds = (missionId: string) =>
  Effect.map(ticketEventsOf(missionId), (events) => events.map((one) => one.kind))

const outdatedMarks = (missionId: string) =>
  Effect.map(getMission(missionId), (mission) =>
    mission.marks.flatMap((one): ReadonlyArray<Mark> =>
      Predicate.isTagged(one.mark, 'Outdated') ? [one.mark] : [],
    ),
  )

const eventTypes = (prefix: string) =>
  Effect.map(readEvents({}), (page) =>
    page.events.filter((one) => one.type.startsWith(prefix)).map((one) => one.type),
  )

describe('Only live missions are watched, in linked mode, one grouped request per provider', () => {
  test('a Done or cancelled mission and a local Project’s mission are not checked', async () => {
    const tracker = fakeTracker()
    for (const number of [1, 2, 3, 4]) tracker.set(number, {})
    await engine(tracker)(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { project } = yield* acme()
          const live = yield* fromIssue(project.id, 1)
          const building = yield* fromIssue(project.id, 2)
          const cancelled = yield* fromIssue(project.id, 3)
          const done = yield* fromIssue(project.id, 4)
          void live
          yield* moveMission(building.id, 'freeze', 'user')
          yield* moveMission(building.id, 'launch', 'user')
          yield* moveMission(cancelled.id, 'cancel', 'user')
          for (const move of ['freeze', 'launch'] as const)
            yield* moveMission(done.id, move, 'user')
          yield* moveMission(done.id, 'endBuilding', 'hemera')
          yield* moveMission(done.id, 'ship', 'user')
          yield* moveMission(done.id, 'complete', 'hemera')
          const local = yield* acme('local', 'Other')
          yield* fromIssue(local.project.id, 5).pipe(Effect.ignore)
          yield* check(project.id)
          yield* check(local.project.id)
        }),
      ),
    )
    expect(tracker.asked()).toEqual([{ host: 'github.com', keys: ['acme/shop#1', 'acme/shop#2'] }])
  })

  test('three missions of one provider are one request; two providers ask once each', async () => {
    const tracker = fakeTracker()
    for (const number of [1, 2, 3]) tracker.set(number, {})
    tracker.set(7, {}, 'git.acme.test')
    await engine(tracker)(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { project } = yield* acme()
          yield* addGithub(project.id, { host: 'git.acme.test', repositories: [] })
          for (const number of [1, 2, 3]) yield* fromIssue(project.id, number)
          yield* createStart({
            projectId: project.id,
            ticket: { reference: reference('https://git.acme.test/acme/shop/issues/7') },
            idempotencyKey: 'enterprise',
          })
          yield* check(project.id)
        }),
      ),
    )
    const asked = tracker.asked()
    expect(asked).toHaveLength(2)
    expect(asked.find((one) => one.host === 'github.com')?.keys).toEqual([
      'acme/shop#1',
      'acme/shop#2',
      'acme/shop#3',
    ])
    expect(asked.find((one) => one.host === 'git.acme.test')?.keys).toEqual(['acme/shop#7'])
  })

  test('only the tickets that moved are read in full', async () => {
    const tracker = fakeTracker()
    for (const number of [1, 2]) tracker.set(number, {})
    await engine(tracker)(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { project } = yield* acme()
          for (const number of [1, 2]) yield* fromIssue(project.id, number)
          const before = tracker.reads().length
          tracker.set(2, { title: 'Export notes as PDF' })
          yield* check(project.id)
          expect(tracker.reads().slice(before)).toEqual(['acme/shop#2'])
        }),
      ),
    )
  })
})

describe('A Project in local mode watches nothing, and keeps no last check', () => {
  test('its checks write neither the date of the last check nor tickets.checked', async () => {
    const tracker = fakeTracker()
    tracker.set(1, {})
    await engine(tracker)(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { project } = yield* acme('local')
          yield* fromIssue(project.id, 1)
          yield* check(project.id)
          yield* check(project.id)
          expect(yield* lastCheckOf(project.id)).toBeNull()
          expect(yield* eventTypes('tickets.checked')).toEqual([])
        }),
      ),
    )
  })
})

describe('Two checks of the same Project never overlap', () => {
  test('a second check waits for the first, then runs: one grouped question at a time', async () => {
    const tracker = fakeTracker()
    tracker.set(1, {})
    await engine(tracker)(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { project } = yield* acme()
          yield* fromIssue(project.id, 1)
          tracker.hold()
          const first = yield* Effect.forkChild(check(project.id))
          const second = yield* Effect.forkChild(check(project.id))
          yield* until(Effect.sync(() => tracker.running() === 1))
          expect(tracker.asked()).toHaveLength(1)
          tracker.release()
          yield* Fiber.join(first)
          yield* Fiber.join(second)
        }),
      ),
    )
    expect(tracker.asked()).toHaveLength(2)
    expect(tracker.mostAtOnce()).toBe(1)
  })
})

describe('The interval is a Project setting', () => {
  test('an hour by default; under five minutes is refused; the setting is kept', async () => {
    const tracker = fakeTracker()
    const [before, refused, after] = await engine(tracker)(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { project } = yield* acme()
          const was = yield* syncIntervalOf(project.id)
          const no = yield* Effect.flip(TicketSync.use((sync) => sync.setInterval(project.id, 4)))
          yield* TicketSync.use((sync) => sync.setInterval(project.id, 5))
          return [was, no, yield* syncIntervalOf(project.id)] as const
        }),
      ),
    )
    expect(before).toBe(60)
    expect(refused).toBeInstanceOf(InvalidSyncInterval)
    expect(after).toBe(5)
  })

  test('the schedule checks every Project at once, then each at its own interval; a change wakes it', async () => {
    const checked: string[] = []
    const intervals = new Map([
      ['a', 5],
      ['b', 60],
    ])
    const count = (projectId: string) => checked.filter((one) => one === projectId).length
    const reached = (projectId: string, times: number) =>
      TestClock.withLive(until(Effect.sync(() => count(projectId) >= times)))
    await Effect.runPromise(
      Effect.gen(function* () {
        const changes = yield* Queue.unbounded<void>()
        const schedule = yield* Effect.forkChild(
          syncSchedule({
            projects: Effect.sync(() =>
              [...intervals].map(([projectId, minutes]) => ({ projectId, minutes })),
            ),
            check: (projectId) => Effect.sync(() => checked.push(projectId)),
            changed: Queue.take(changes),
          }),
        )
        // The catch-up: every Project at once.
        yield* reached('a', 1)
        yield* reached('b', 1)
        yield* TestClock.adjust(Duration.minutes(5))
        yield* reached('a', 2)
        expect(count('b')).toBe(1)
        for (let minute = 5; minute < 60; minute += 5) {
          yield* TestClock.adjust(Duration.minutes(5))
          yield* reached('a', minute / 5 + 2)
        }
        yield* reached('b', 2)
        // Shorter now: the change wakes the schedule, which follows the new interval.
        intervals.set('b', 5)
        yield* Queue.offer(changes, undefined)
        yield* TestClock.adjust(Duration.minutes(5))
        yield* reached('b', 3)
        yield* Fiber.interrupt(schedule)
      }).pipe(Effect.provide(TestClock.layer())),
    )
  })
})

describe('A schedule that fails once goes on at the next interval', () => {
  test('the Projects cannot be read once: no check then, one an interval later', async () => {
    const checked: string[] = []
    let reads = 0
    await Effect.runPromise(
      Effect.gen(function* () {
        const schedule = yield* Effect.forkChild(
          syncSchedule({
            projects: Effect.suspend(() => {
              reads += 1
              return reads === 1
                ? Effect.fail(new Error('the data folder is busy'))
                : Effect.succeed([{ projectId: 'a', minutes: 60 }])
            }),
            check: (projectId) => Effect.sync(() => checked.push(projectId)),
            changed: Effect.never,
          }),
        )
        yield* TestClock.withLive(until(Effect.sync(() => reads >= 1)))
        expect(checked).toEqual([])
        yield* TestClock.adjust(Duration.minutes(60))
        yield* TestClock.withLive(until(Effect.sync(() => checked.length >= 1)))
        yield* Fiber.interrupt(schedule)
      }).pipe(Effect.provide(TestClock.layer())),
    )
    expect(checked).toEqual(['a'])
  })
})

describe('A catch-up runs at start, and after a restore’s reconciliation only', () => {
  test('a ticket changed while Hemera was closed is found at the next start', async () => {
    const tracker = fakeTracker()
    tracker.set(1, {})
    const missionId = await engine(tracker)(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { project } = yield* acme()
          return (yield* fromIssue(project.id, 1)).id
        }),
      ),
    )
    tracker.set(1, { title: 'Export notes as Markdown and PDF' })
    const found = await engine(
      tracker,
      true,
    )(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          yield* until(Effect.map(kinds(missionId), (all) => all.length > 0))
          return yield* kinds(missionId)
        }),
      ),
    )
    expect(found).toEqual(['description_changed'])
  })

  test('while a restore is reconciled, no check runs; once it ends, the catch-up does', async () => {
    const tracker = fakeTracker()
    tracker.set(1, {})
    await engine(tracker)(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { project } = yield* acme()
          yield* fromIssue(project.id, 1)
        }),
      ),
    )
    const backups = temporaryFolder('ticket-sync-backups')
    const backup = await engine(tracker)(({ profile }) => profile.calls.backup(backups))
    await engine(tracker)(({ profile }) => profile.calls.restore(backup))
    const entered = Promise.withResolvers<void>()
    const held = Promise.withResolvers<void>()
    const holding: ReconciliationStep = {
      name: 'held',
      per: 'profile',
      states: ['before', 'after'],
      recorded: () =>
        Effect.andThen(
          Effect.sync(() => entered.resolve()),
          Effect.as(
            Effect.promise(() => held.promise),
            'after',
          ),
        ),
      observed: () => Effect.succeed('after'),
      advance: () => Effect.void,
    }
    const asked = await commandsEngine(data, {
      ticketProviders: tracker.layer,
      ticketSync: { schedules: true },
      sessions: { discovery: everyAgentFound },
      reconciliationSteps: [holding],
    })(({ profile }) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => entered.promise)
        const during = tracker.asked().length
        held.resolve()
        yield* profile.gate
        yield* until(Effect.sync(() => tracker.asked().length > 0))
        return during
      }),
    )
    expect(asked).toBe(0)
  })
})

describe('A provider that fails is signalled once and tried again at the next check', () => {
  test('offline twice: one outage said, no last check; back: provider_back and the last check', async () => {
    const tracker = fakeTracker()
    tracker.set(1, {})
    await engine(tracker)(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { project } = yield* acme()
          yield* fromIssue(project.id, 1)
          tracker.offline(true)
          const first = yield* check(project.id)
          yield* check(project.id)
          expect(first.complete).toBe(false)
          expect(yield* lastCheckOf(project.id)).toBeNull()
          expect(yield* eventTypes('tickets.provider_')).toEqual([
            'tickets.provider_added',
            'tickets.provider_unreachable',
          ])
          tracker.offline(false)
          const back = yield* check(project.id)
          expect(back.complete).toBe(true)
          expect(yield* lastCheckOf(project.id)).toEqual(expect.any(String))
          expect(yield* eventTypes('tickets.provider_')).toEqual([
            'tickets.provider_added',
            'tickets.provider_unreachable',
            'tickets.provider_back',
          ])
        }),
      ),
    )
  })
})

describe('A watched ticket the provider no longer finds', () => {
  test('is said once on its mission; its last known version stays', async () => {
    const tracker = fakeTracker()
    tracker.set(1, {})
    await engine(tracker)(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { project } = yield* acme()
          const mission = yield* fromIssue(project.id, 1)
          tracker.set(1, { title: 'Moved on' })
          tracker.remove(1)
          yield* check(project.id)
          yield* check(project.id)
          expect(yield* eventTypes('tickets.ticket_missing')).toEqual(['tickets.ticket_missing'])
          expect((yield* missionTicket(mission.id))?.last?.title).toBe('Export notes as Markdown')
          expect(yield* ticketEventsOf(mission.id)).toEqual([])
        }),
      ),
    )
  })
})

describe('A watched ticket that cannot be read, or comes back', () => {
  test('a ticket that moved but cannot be read is said once, then read again once it can be', async () => {
    const tracker = fakeTracker()
    tracker.set(1, {})
    await engine(tracker)(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { project } = yield* acme()
          const mission = yield* fromIssue(project.id, 1)
          tracker.set(1, { title: 'Moved on' })
          tracker.unreadable(1, true)
          yield* check(project.id)
          yield* check(project.id)
          expect(yield* eventTypes('tickets.ticket_missing')).toEqual(['tickets.ticket_missing'])
          tracker.unreadable(1, false)
          yield* check(project.id)
          expect(yield* kinds(mission.id)).toEqual(['description_changed'])
        }),
      ),
    )
  })

  test('found again unchanged, a ticket that goes missing again is said again', async () => {
    const tracker = fakeTracker()
    tracker.set(1, {})
    await engine(tracker)(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { project } = yield* acme()
          const mission = yield* fromIssue(project.id, 1)
          tracker.hide(1, true)
          yield* check(project.id)
          tracker.hide(1, false)
          yield* check(project.id)
          tracker.hide(1, true)
          yield* check(project.id)
          expect(yield* eventTypes('tickets.ticket_missing')).toEqual([
            'tickets.ticket_missing',
            'tickets.ticket_missing',
          ])
          expect(yield* ticketEventsOf(mission.id)).toEqual([])
        }),
      ),
    )
  })
})

describe('Each kind of change gives the right event', () => {
  test('description, status, comment added, edited and removed; the last known version moves', async () => {
    const tracker = fakeTracker()
    tracker.set(1, {
      comments: [
        { id: 'IC_1', author: 'grace', body: 'Keep the accents.', editedAt: null },
        { id: 'IC_2', author: 'linus', body: 'Ship it as is.', editedAt: null },
      ],
    })
    const [events, linked] = await engine(tracker)(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { project } = yield* acme()
          const mission = yield* fromIssue(project.id, 1)
          tracker.set(1, {
            body: '## Why\nExports are slow and lossy.\n',
            state: 'closed',
            wording: 'closed · not planned',
            comments: [
              { id: 'IC_1', author: 'grace', body: 'Keep the accents, and emoji.', editedAt: null },
              { id: 'IC_3', author: 'ada', body: 'CSV too?', editedAt: null },
            ],
          })
          yield* check(project.id)
          return [yield* ticketEventsOf(mission.id), yield* missionTicket(mission.id)] as const
        }),
      ),
    )
    expect(events.map((one) => [one.kind, one.commentId, one.difference])).toEqual([
      ['description_changed', null, '- Exports are slow.\n+ Exports are slow and lossy.'],
      ['status_changed', null, 'open → closed · not planned'],
      ['comment_edited', 'IC_1', '- Keep the accents.\n+ Keep the accents, and emoji.'],
      ['comment_added', 'IC_3', '+ CSV too?'],
      ['comment_removed', 'IC_2', '- Ship it as is.'],
    ])
    expect(events.map((one) => one.sequence)).toEqual([1, 2, 3, 4, 5])
    expect(linked?.last?.status.wording).toBe('closed · not planned')
    expect(linked?.base?.status.wording).toBe('open')
  })

  test('a version Hemera wrote itself gives no event', async () => {
    const tracker = fakeTracker()
    tracker.set(1, {})
    const events = await engine(tracker)(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { project, provider } = yield* acme()
          const mission = yield* fromIssue(project.id, 1)
          // What #98 does: it writes the ticket, reads it back, and keeps that version as the last
          // known one at once.
          tracker.set(1, { body: '## Why\nWritten by Hemera.\n' })
          const live = yield* TicketProviders.use((providers) => providers.of(provider))
          const written = yield* live.read(reference('acme/shop#1'))
          yield* keepOwnVersion(mission.id, provider.id, written)
          yield* check(project.id)
          return yield* ticketEventsOf(mission.id)
        }),
      ),
    )
    expect(events).toEqual([])
  })

  test('a version older than the last known one is stale: nothing kept, no event', async () => {
    const tracker = fakeTracker()
    tracker.set(1, {})
    const seen = await engine(tracker)(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { project, provider } = yield* acme()
          const mission = yield* fromIssue(project.id, 1)
          const live = yield* TicketProviders.use((providers) => providers.of(provider))
          tracker.set(1, { body: '## Why\nSecond.\n' })
          const second = yield* live.read(reference('acme/shop#1'))
          tracker.set(1, { body: '## Why\nThird.\n' })
          const third = yield* live.read(reference('acme/shop#1'))
          // A read of the third version commits first; the slower read of the second after it.
          const newer = yield* keepVersion(mission.id, provider.id, third)
          const stale = yield* keepVersion(mission.id, provider.id, second)
          return {
            newer: newer.events.length,
            stale: stale.events,
            events: yield* kinds(mission.id),
            last: (yield* missionTicket(mission.id))?.last?.description,
          }
        }),
      ),
    )
    expect(seen.newer).toBeGreaterThan(0)
    expect(seen.stale).toEqual([])
    expect(seen.events).toEqual(['description_changed'])
    expect(seen.last).toBe('## Why\nThird.\n')
  })

  test('a version read before Hemera’s own write is stale: no event, no mark', async () => {
    const tracker = fakeTracker()
    tracker.set(1, {})
    const seen = await engine(tracker)(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { project, provider } = yield* acme()
          const mission = yield* fromIssue(project.id, 1)
          yield* moveMission(mission.id, 'freeze', 'user')
          const live = yield* TicketProviders.use((providers) => providers.of(provider))
          tracker.set(1, { body: '## Why\nRead by the sync.\n' })
          const older = yield* live.read(reference('acme/shop#1'))
          tracker.set(1, { body: '## Why\nWritten by Hemera.\n' })
          const written = yield* live.read(reference('acme/shop#1'))
          yield* keepOwnVersion(mission.id, provider.id, written)
          const kept = yield* keepVersion(mission.id, provider.id, older)
          return {
            kept: kept.events,
            events: yield* kinds(mission.id),
            marks: yield* outdatedMarks(mission.id),
            last: (yield* missionTicket(mission.id))?.last?.description,
          }
        }),
      ),
    )
    expect(seen.kept).toEqual([])
    expect(seen.events).toEqual([])
    expect(seen.marks).toEqual([])
    expect(seen.last).toBe('## Why\nWritten by Hemera.\n')
  })

  test('a Project in local mode is not watched: a read keeps the version and gives no event', async () => {
    const tracker = fakeTracker()
    tracker.set(1, {})
    const events = await engine(tracker)(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { project } = yield* acme('local')
          const mission = yield* fromIssue(project.id, 1)
          tracker.set(1, { title: 'Other' })
          yield* check(project.id)
          // A read of the ticket (the Chat's ticket_read) keeps it, as the last known version only.
          yield* readTicket(project.id, reference('acme/shop#1'))
          expect((yield* missionTicket(mission.id))?.last?.title).toBe('Other')
          return yield* ticketEventsOf(mission.id)
        }),
      ),
    )
    expect(events).toEqual([])
  })
})

describe('A changed description marks the mission outdated with the difference', () => {
  test('in Planning: delivered to the Planner as an input that blocks Freeze until integrated', async () => {
    const tracker = fakeTracker()
    tracker.set(1, {})
    await engine(tracker)(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { project } = yield* acme()
          const mission = yield* fromIssue(project.id, 1)
          tracker.set(1, { body: '## Why\nExports are slow and lossy.\n' })
          yield* check(project.id)
          const [event] = yield* ticketEventsOf(mission.id)
          const marks = yield* outdatedMarks(mission.id)
          expect(marks).toEqual([
            OutdatedMark.make({
              reason: 'ticket-changed',
              reference: 'acme/shop#1',
              difference: '- Exports are slow.\n+ Exports are slow and lossy.',
            }),
          ])
          const inputs = yield* inputsOf(mission.id)
          expect(inputs.map((one) => [one.kind, one.item])).toEqual([['ticket_event', event?.id]])
          const readiness = yield* freezeReadiness(mission.id)
          expect(readiness.unsettled.join(' ')).toContain(`the ticket event ${event?.id ?? ''}`)
          const difference = yield* ticketEventDifference(event?.id ?? '')
          expect(difference.before?.description).toBe('## Why\nExports are slow.\n')
          expect(difference.after?.description).toBe('## Why\nExports are slow and lossy.\n')
        }),
      ),
    )
  })

  test.each(['ready', 'building', 'review', 'shipping'] as const)(
    'in %s: marked outdated, an analysis asked, and nothing stops',
    async (stage) => {
      const tracker = fakeTracker()
      tracker.set(1, {})
      await engine(tracker)(({ profile }) =>
        profile.use(
          Effect.gen(function* () {
            const { project } = yield* acme()
            const mission = yield* fromIssue(project.id, 1)
            yield* moveMission(mission.id, 'freeze', 'user')
            if (stage !== 'ready') yield* moveMission(mission.id, 'launch', 'user')
            if (stage === 'review' || stage === 'shipping') {
              yield* moveMission(mission.id, 'endBuilding', 'hemera')
            }
            if (stage === 'shipping') yield* moveMission(mission.id, 'ship', 'user')
            tracker.set(1, { body: '## Why\nOther.\n' })
            yield* check(project.id)
            const after = yield* getMission(mission.id)
            expect(after.stage).toBe(stage)
            expect(yield* outdatedMarks(mission.id)).toHaveLength(1)
            expect(yield* inputsOf(mission.id)).toEqual([])
            const database = yield* Database
            const runs = yield* database.select().from(ticketEventRuns)
            expect(runs.map((one) => one.missionId)).toEqual([mission.id])
          }),
        ),
      )
    },
  )
})

describe('The status is a warning only; acknowledge lifts the mark without moving the base', () => {
  test('a status change creates no mark, and writes tickets.changed', async () => {
    const tracker = fakeTracker()
    tracker.set(1, {})
    await engine(tracker)(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { project } = yield* acme()
          const mission = yield* fromIssue(project.id, 1)
          yield* moveMission(mission.id, 'freeze', 'user')
          tracker.set(1, { state: 'closed', wording: 'closed' })
          yield* check(project.id)
          expect(yield* kinds(mission.id)).toEqual(['status_changed'])
          expect(yield* outdatedMarks(mission.id)).toEqual([])
          expect(yield* eventTypes('tickets.changed')).toEqual(['tickets.changed'])
          const database = yield* Database
          expect(yield* database.select().from(ticketEventRuns)).toEqual([])
        }),
      ),
    )
  })

  test('after the Freeze, acknowledge lifts the mark; the base stays the frozen one', async () => {
    const tracker = fakeTracker()
    tracker.set(1, {})
    await engine(tracker)(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { project } = yield* acme()
          const mission = yield* fromIssue(project.id, 1)
          const base = (yield* missionTicket(mission.id))?.base?.updatedAt
          yield* moveMission(mission.id, 'freeze', 'user')
          yield* moveMission(mission.id, 'launch', 'user')
          tracker.set(1, { body: '## Why\nOther.\n' })
          yield* check(project.id)
          const [event] = yield* ticketEventsOf(mission.id)
          const seen = yield* acknowledgeEvent(event?.id ?? '')
          expect(seen.state).toBe('seen')
          expect(yield* outdatedMarks(mission.id)).toEqual([])
          const linked = yield* missionTicket(mission.id)
          expect(linked?.base?.updatedAt).toBe(base)
          expect(linked?.last?.updatedAt).not.toBe(base)
          expect(yield* eventTypes('tickets.event_seen')).toEqual(['tickets.event_seen'])
        }),
      ),
    )
  })

  test('after the ticket’s key moved, acknowledge lifts the mark set under the new key', async () => {
    const tracker = fakeTracker()
    tracker.set(1, {})
    await engine(tracker)(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { project, provider } = yield* acme()
          const mission = yield* fromIssue(project.id, 1)
          yield* moveMission(mission.id, 'freeze', 'user')
          yield* moveMission(mission.id, 'launch', 'user')
          tracker.set(1, { body: '## Why\nOther.\n' })
          yield* check(project.id)
          const [first] = yield* ticketEventsOf(mission.id)
          yield* acknowledgeEvent(first?.id ?? '')
          // The ticket moved to another key (a Jira issue moved to another project), then changed.
          tracker.set(1, { body: '## Why\nOther again.\n' })
          const live = yield* TicketProviders.use((providers) => providers.of(provider))
          const moved = { ...(yield* live.read(reference('acme/shop#1'))), key: 'acme/moved#9' }
          yield* keepVersion(mission.id, provider.id, moved)
          const marked = yield* outdatedMarks(mission.id)
          const second = (yield* ticketEventsOf(mission.id)).at(-1)
          yield* acknowledgeEvent(second?.id ?? '')
          expect(
            marked.map((one) => (Predicate.isTagged(one, 'Outdated') ? one.reference : null)),
          ).toEqual(['acme/moved#9'])
          expect(yield* outdatedMarks(mission.id)).toEqual([])
        }),
      ),
    )
  })

  test('in Planning, acknowledge is refused: the Planner integrates the change', async () => {
    const tracker = fakeTracker()
    tracker.set(1, {})
    const refused = await engine(tracker)(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { project } = yield* acme()
          const mission = yield* fromIssue(project.id, 1)
          tracker.set(1, { body: '## Why\nOther.\n' })
          yield* check(project.id)
          const [event] = yield* ticketEventsOf(mission.id)
          return yield* Effect.flip(acknowledgeEvent(event?.id ?? ''))
        }),
      ),
    )
    expect(refused).toBeInstanceOf(TicketEventRefused)
  })
})

describe('Three notification kinds, on by default, each can be turned off', () => {
  test('a comment, a description and a status each notify under their kind', async () => {
    const tracker = fakeTracker()
    tracker.set(1, {})
    const [notices, settings] = await engine(tracker)(({ profile }) =>
      profile.use(
        Effect.scoped(
          Effect.gen(function* () {
            const { project } = yield* acme()
            const mission = yield* fromIssue(project.id, 1)
            yield* moveMission(mission.id, 'freeze', 'user')
            const committed = yield* DomainEvents.use((events) => events.subscribe)
            const told = yield* Effect.forkChild(
              Stream.runCollect(
                noticesOf(REGISTRY, committed).pipe(
                  Stream.filter(Predicate.isTagged('NoticeRaised')),
                  Stream.take(3),
                ),
              ),
            )
            tracker.set(1, {
              body: 'Other.',
              state: 'closed',
              wording: 'closed',
              comments: [{ id: 'IC_9', author: 'ada', body: 'CSV?', editedAt: null }],
            })
            yield* check(project.id)
            const raised = yield* Fiber.join(told)
            yield* setNotificationKind(REGISTRY, 'ticket-status', false)
            // Turned off: a later change of the status raises nothing; its comment still does,
            // and is said after the status.
            const later = yield* Effect.forkChild(
              Stream.runCollect(
                noticesOf(REGISTRY, committed).pipe(
                  Stream.flatMap((one) =>
                    Stream.fromIterable(
                      Predicate.isTagged(one, 'NoticeRaised') ? [one.notice] : [],
                    ),
                  ),
                  Stream.takeUntil((one) => one.kind === 'ticket-comment'),
                ),
              ),
            )
            tracker.set(1, {
              state: 'open',
              wording: 'reopened',
              comments: [
                { id: 'IC_9', author: 'ada', body: 'CSV?', editedAt: null },
                { id: 'IC_10', author: 'grace', body: 'Reopened for CSV.', editedAt: null },
              ],
            })
            yield* check(project.id)
            const after = [...(yield* Fiber.join(later))]
            const switched = yield* readNotificationSettings(REGISTRY)
            const situation = { focused: true, settings: switched, doNotDisturb: 'off' as const }
            const status = after.filter((one) => one.kind === 'ticket-status')
            const comment = after.filter((one) => one.kind === 'ticket-comment')
            expect(status).toHaveLength(1)
            expect(deliveryOf(status, situation)).toBeNull()
            expect(deliveryOf(comment, situation)).not.toBeNull()
            expect(deliveryOf(after, situation)?.id).toBe(comment[0]?.id)
            return [raised, switched] as const
          }),
        ),
      ),
    )
    expect(
      [...notices]
        .flatMap((one) => (Predicate.isTagged(one, 'NoticeRaised') ? [one.notice.kind] : []))
        .toSorted(),
    ).toEqual(['ticket-changed', 'ticket-comment', 'ticket-status'])
    const switches = settings.kinds.filter((one) => one.id.startsWith('ticket-'))
    expect(switches.map((one) => [one.id, one.byDefault, one.on])).toEqual([
      ['ticket-comment', true, true],
      ['ticket-changed', true, true],
      ['ticket-status', true, false],
    ])
  })
})
