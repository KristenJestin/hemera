/**
 * Needs you as the window follows it: every pending need read once and kept up to date by the
 * engine's changes, in the order Home lists them, with the words its cards say, answered from the
 * card, and a need that ends shown a moment before it leaves.
 */

import {
  ApplicationOwner,
  ChosenAnswer,
  DecisionFields,
  EnvironmentFields,
  ErrorFields,
  MissionOwner,
  PermissionAnswer,
  PermissionFields,
  ProjectOwner,
  permissionChoices,
  type NeedAnswer,
  type NeedFields,
  type NeedOwner,
} from '@hemera/core/domain'
import {
  MissionChanged,
  NeedAnswerRefused,
  NeedChanged,
  StorageFailed,
  type Mission,
  type MissionsChange,
  type Need,
  type NeedAnswerAsked,
  type NeedGroup,
} from '@hemera/ipc'
import { Predicate } from 'effect'
import { describe, expect, test, vi } from 'vite-plus/test'

import type { Link } from '../src/renderer/link.ts'
import {
  cardOf,
  followNeeds,
  handlersFor,
  needRowsOf,
  waitingCount,
  whenOf,
  type NeedsState,
} from '../src/renderer/needs.ts'

const NOW = new Date('2026-10-05T12:00:00.000Z')

const APP: NeedOwner = ApplicationOwner.make({})
const ACME: NeedOwner = ProjectOwner.make({ projectId: 'acme' })
const onMission = (missionId: string, projectId = 'acme'): NeedOwner =>
  MissionOwner.make({ projectId, missionId, taskId: null })

const ENVIRONMENT = EnvironmentFields.make({
  missing: 'Git is not on the PATH',
  action: 'Install Git, then Retry.',
  settingsSection: null,
})
const DECISION = DecisionFields.make({
  question: 'Which table holds the invoices?',
  options: ['billing_invoices', 'invoices'],
  recommended: { option: 'invoices', reason: 'the api already reads it' },
})
const ERROR = ErrorFields.make({
  failed: 'The shared package does not build',
  attempts: [
    { what: 'Built shared', output: 'error TS2307' },
    { what: 'Restored money.ts', output: 'error TS2307' },
    { what: 'Rebuilt with a clean cache', output: 'error TS2307' },
  ],
  proposals: ['Move the money helpers back into shared/src.'],
})
const PERMISSION = PermissionFields.make({
  call: 'cat ~/.ssh/config',
  agentReason: 'The deploy step needs the staging host.',
  hemeraReason: 'Outside the Workspace: ~/.ssh/config',
  sensitive: false,
})

let made = 0
const need = (
  owner: NeedOwner,
  fields: NeedFields,
  createdAt: string,
  more: Partial<Need> = {},
): Need => {
  made += 1
  return {
    id: `need-${String(made)}`,
    owner,
    fields,
    choices: Predicate.isTagged(fields, 'Permission')
      ? permissionChoices({
          ownedByMission: Predicate.isTagged(owner, 'Mission'),
          sensitive: fields.sensitive,
        })
      : [],
    requestedBy: null,
    state: 'pending',
    answer: null,
    endedReason: null,
    createdAt,
    endedAt: null,
    ...more,
  }
}

const mission = (id: string, key: string, updatedAt: string): Mission => ({
  id,
  projectId: 'acme',
  key,
  title: 'Add roles',
  idea: { sentence: 'Add roles', ticket: null },
  type: 'feature',
  ticketLink: null,
  stage: 'building',
  round: 0,
  frozen: true,
  marks: [],
  ball: null,
  needs: [],
  cleanup: null,
  unstopped: [],
  createdAt: '2026-10-05T08:00:00.000Z',
  updatedAt,
})

const PROJECTS = [
  { id: 'acme', name: 'Acme' },
  { id: 'labs', name: 'Acme Labs' },
]

const ready = (
  needs: ReadonlyArray<Need>,
  missions: ReadonlyArray<Mission> = [],
): Extract<NeedsState, { kind: 'ready' }> => ({
  kind: 'ready',
  needs,
  missions: new Map(missions.map((one) => [one.id, { key: one.key, updatedAt: one.updatedAt }])),
  answers: new Map(),
})

describe('The order Home lists the needs in', () => {
  test('Hemera’s own first, then each Project in the sidebar’s order', () => {
    const labs = need(ProjectOwner.make({ projectId: 'labs' }), ENVIRONMENT, '2026-10-05T09:00:00Z')
    const acme = need(ACME, ENVIRONMENT, '2026-10-05T10:00:00Z')
    const app = need(APP, ENVIRONMENT, '2026-10-05T11:00:00Z')
    const rows = needRowsOf(ready([labs, acme, app]), PROJECTS, NOW)
    expect(rows.map((row) => [row.id, row.project])).toEqual([
      [app.id, 'Hemera'],
      [acme.id, 'Acme'],
      [labs.id, 'Acme Labs'],
    ])
  })

  test('in a Project, its own needs first, then by mission, the latest activity first, each mission’s oldest first', () => {
    const older = mission('m1', 'ACME-11', '2026-10-05T09:00:00Z')
    const busier = mission('m2', 'ACME-12', '2026-10-05T11:30:00Z')
    const a = need(onMission('m1'), DECISION, '2026-10-05T08:00:00Z')
    const b = need(onMission('m2'), DECISION, '2026-10-05T10:00:00Z')
    const c = need(onMission('m2'), ERROR, '2026-10-05T09:00:00Z')
    const own = need(ACME, ENVIRONMENT, '2026-10-05T11:00:00Z')
    const rows = needRowsOf(ready([a, b, c, own], [older, busier]), PROJECTS, NOW)
    expect(rows.map((row) => row.id)).toEqual([own.id, c.id, b.id, a.id])
    expect(rows.map((row) => row.need.missionKey)).toEqual([
      undefined,
      'ACME-12',
      'ACME-12',
      'ACME-11',
    ])
  })

  test('filtered to a Project, only its needs', () => {
    const app = need(APP, ENVIRONMENT, '2026-10-05T11:00:00Z')
    const acme = need(ACME, ENVIRONMENT, '2026-10-05T10:00:00Z')
    const labs = need(ProjectOwner.make({ projectId: 'labs' }), ENVIRONMENT, '2026-10-05T09:00:00Z')
    const rows = needRowsOf(ready([app, acme, labs]), PROJECTS, NOW, 'acme')
    expect(rows.map((row) => row.id)).toEqual([acme.id])
  })

  test('the badge counts what still waits, not what was just answered', () => {
    const waiting = need(APP, ENVIRONMENT, '2026-10-05T11:00:00Z')
    const answered = need(ACME, DECISION, '2026-10-05T10:00:00Z', {
      state: 'answered',
      answer: ChosenAnswer.make({ option: 'invoices' }),
    })
    expect(waitingCount(ready([waiting, answered]))).toBe(1)
    expect(waitingCount({ kind: 'loading' })).toBe(0)
  })
})

describe('What each card says', () => {
  test('when, in a few words', () => {
    expect(whenOf('2026-10-05T11:59:40.000Z', NOW)).toBe('now')
    expect(whenOf('2026-10-05T11:56:00.000Z', NOW)).toBe('4 min')
    expect(whenOf('2026-10-05T10:00:00.000Z', NOW)).toBe('2 h')
    expect(whenOf('2026-10-04T10:00:00.000Z', NOW)).toBe('yesterday')
    expect(whenOf('2026-10-01T10:00:00.000Z', NOW)).toBe('1 Oct')
  })

  test('something missing: what is missing, the action in words, and Retry', () => {
    const card = cardOf(need(APP, ENVIRONMENT, '2026-10-05T10:00:00Z'), NOW)
    expect(card).toMatchObject({
      title: 'Git is not on the PATH',
      text: 'Install Git, then Retry.',
      when: '2 h',
      ask: { kind: 'environment' },
    })
    expect(card.ask).not.toHaveProperty('action')
  })

  test('something a setting answers: the link names its section', () => {
    const fields = { ...ENVIRONMENT, settingsSection: 'models' }
    expect(cardOf(need(APP, fields, '2026-10-05T10:00:00Z'), NOW).ask).toEqual({
      kind: 'environment',
      settings: 'Models by role',
    })
    const unknown = { ...ENVIRONMENT, settingsSection: 'nowhere' }
    expect(cardOf(need(APP, unknown, '2026-10-05T10:00:00Z'), NOW).ask).toEqual({
      kind: 'environment',
    })
  })

  test('a decision: its question, its options, the recommended one first and marked', () => {
    const card = cardOf(
      need(onMission('m1'), DECISION, '2026-10-05T10:00:00Z', { requestedBy: 'planner' }),
      NOW,
      'ACME-12',
    )
    expect(card).toMatchObject({
      title: 'Which table holds the invoices?',
      missionKey: 'ACME-12',
      role: 'planner',
      ask: {
        kind: 'decision',
        options: [
          { label: 'invoices', recommended: 'the api already reads it' },
          { label: 'billing_invoices' },
        ],
      },
    })
  })

  test('an error: what failed, what was tried, what is proposed', () => {
    expect(cardOf(need(onMission('m1'), ERROR, '2026-10-05T10:00:00Z'), NOW)).toMatchObject({
      title: 'The shared package does not build',
      ask: {
        kind: 'error',
        attempts: ERROR.attempts,
        proposed: 'Move the money helpers back into shared/src.',
      },
    })
    const none = { ...ERROR, proposals: [] }
    expect(cardOf(need(onMission('m1'), none, '2026-10-05T10:00:00Z'), NOW).ask).not.toHaveProperty(
      'proposed',
    )
  })

  test('a permission: the agent’s reason as its title, the call, Hemera’s reason, and only the choices offered', () => {
    const outside = cardOf(need(ACME, PERMISSION, '2026-10-05T10:00:00Z'), NOW)
    expect(outside).toMatchObject({
      title: 'The deploy step needs the staging host.',
      ask: {
        kind: 'permission',
        command: 'cat ~/.ssh/config',
        hemeraReason: 'Outside the Workspace: ~/.ssh/config',
        choices: ['allow-once', 'deny'],
      },
    })
    const sensitive = { ...PERMISSION, sensitive: true }
    expect(cardOf(need(onMission('m1'), sensitive, '2026-10-05T10:00:00Z'), NOW).ask).toMatchObject(
      {
        choices: ['allow-once', 'deny'],
      },
    )
    expect(
      cardOf(need(onMission('m1'), PERMISSION, '2026-10-05T10:00:00Z'), NOW).ask,
    ).toMatchObject({
      choices: ['allow-once', 'allow-for-mission', 'deny'],
    })
  })

  test('answered, it says the answer; expired or resolved, the reason', () => {
    const allowed = need(onMission('m1'), PERMISSION, '2026-10-05T10:00:00Z', {
      state: 'answered',
      answer: PermissionAnswer.make({ choice: 'allow-for-mission' }),
    })
    expect(cardOf(allowed, NOW).status).toEqual({
      state: 'applied',
      answer: 'Allowed for this mission',
    })
    const chosen = need(onMission('m1'), DECISION, '2026-10-05T10:00:00Z', {
      state: 'answered',
      answer: ChosenAnswer.make({ option: 'invoices' }),
    })
    expect(cardOf(chosen, NOW).status).toEqual({ state: 'applied', answer: 'invoices' })
    const expired = need(onMission('m1'), DECISION, '2026-10-05T10:00:00Z', {
      state: 'expired',
      endedReason: 'the mission was cancelled',
    })
    expect(cardOf(expired, NOW).status).toEqual({
      state: 'expired',
      reason: 'the mission was cancelled',
    })
    const resolved = need(APP, ENVIRONMENT, '2026-10-05T10:00:00Z', {
      state: 'withdrawn',
      endedReason: 'what was missing is there now',
    })
    expect(cardOf(resolved, NOW).status).toEqual({
      state: 'applied',
      answer: 'what was missing is there now',
    })
  })
})

describe('What a card’s buttons do', () => {
  const tools = () => ({ answer: vi.fn(), recheck: vi.fn(), openSettings: vi.fn() })

  test('a permission choice answers with that choice, under its button’s label', () => {
    const asked = need(onMission('m1'), PERMISSION, '2026-10-05T10:00:00Z')
    const on = tools()
    handlersFor(asked, on).onPermission?.('allow-for-mission')
    expect(on.answer).toHaveBeenCalledWith(
      asked.id,
      'Allow for this mission',
      PermissionAnswer.make({ choice: 'allow-for-mission' }),
    )
  })

  test('a decision answers with the option chosen, and offers no answer of one’s own', () => {
    const asked = need(onMission('m1'), DECISION, '2026-10-05T10:00:00Z')
    const on = tools()
    const handlers = handlersFor(asked, on)
    handlers.onChoose?.('invoices')
    expect(on.answer).toHaveBeenCalledWith(
      asked.id,
      'invoices',
      ChosenAnswer.make({ option: 'invoices' }),
    )
    expect(handlers.onWrite).toBeUndefined()
  })

  test('an error’s Apply chooses what is proposed', () => {
    const asked = need(onMission('m1'), ERROR, '2026-10-05T10:00:00Z')
    const on = tools()
    handlersFor(asked, on).onApply?.()
    expect(on.answer).toHaveBeenCalledWith(
      asked.id,
      'Apply',
      ChosenAnswer.make({ option: 'Move the money helpers back into shared/src.' }),
    )
  })

  test('something missing is retried, and its link opens its settings section', () => {
    const asked = need(APP, { ...ENVIRONMENT, settingsSection: 'hemera-auto' }, NOW.toISOString())
    const on = tools()
    const handlers = handlersFor(asked, on)
    handlers.onRetry?.()
    expect(on.recheck).toHaveBeenCalledWith(asked.id)
    handlers.onSettings?.()
    expect(on.openSettings).toHaveBeenCalledWith('hemera-auto')
  })
})

interface Pending<A> {
  readonly resolve: (value: A) => void
  readonly reject: (error: Error) => void
}

/** A link whose engine answers when the test says, with what the test says. */
function scripted() {
  const lists: Array<Pending<ReadonlyArray<NeedGroup>>> = []
  const answers: Array<Pending<Need> & { asked: NeedAnswerAsked }> = []
  const retries: Array<Pending<Need>> = []
  const missionsAsked: string[] = []
  const missions: Array<Pending<Mission>> = []
  const listeners = new Set<(change: MissionsChange) => void>()
  const link: Pick<Link, 'needs' | 'mission' | 'answerNeed' | 'retryNeed' | 'onMissionChanges'> = {
    needs: () => new Promise((resolve, reject) => lists.push({ resolve, reject })),
    mission: (id) =>
      new Promise((resolve, reject) => {
        missionsAsked.push(id)
        missions.push({ resolve, reject })
      }),
    answerNeed: (asked) =>
      new Promise((resolve, reject) => answers.push({ resolve, reject, asked })),
    retryNeed: () => new Promise((resolve, reject) => retries.push({ resolve, reject })),
    onMissionChanges: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
  return {
    link,
    answers,
    retries,
    missionsAsked,
    missions,
    listening: () => listeners.size,
    list: (groups: ReadonlyArray<NeedGroup>) => lists.shift()?.resolve(groups),
    refuseList: (error: Error) => lists.shift()?.reject(error),
    change: (change: MissionsChange) => {
      for (const listener of listeners) listener(change)
    },
  }
}

/** A clock whose lingering ends when the test says. */
function lingering() {
  const waiting: Array<() => void> = []
  return {
    linger: (end: () => void) => {
      waiting.push(end)
      return () => undefined
    },
    end: () => {
      for (const end of waiting.splice(0)) end()
    },
  }
}

const readyNeeds = (states: NeedsState[]) => {
  const last = states.at(-1)
  return last?.kind === 'ready' ? last.needs : []
}

describe('Needs you follows the engine', () => {
  test('on its way, then every pending need, flattened in the engine’s order', async () => {
    const engine = scripted()
    const states: NeedsState[] = []
    followNeeds(engine.link, (state) => states.push(state), lingering().linger)
    expect(states.at(-1)).toEqual({ kind: 'loading' })
    const app = need(APP, ENVIRONMENT, '2026-10-05T10:00:00Z')
    const acme = need(ACME, ENVIRONMENT, '2026-10-05T11:00:00Z')
    engine.list([
      { projectId: null, needs: [app] },
      { projectId: 'acme', needs: [acme] },
    ])
    await vi.waitFor(() => expect(readyNeeds(states)).toEqual([app, acme]))
  })

  test('a need created later arrives live, and one heard while the list was on its way is kept', async () => {
    const engine = scripted()
    const states: NeedsState[] = []
    followNeeds(engine.link, (state) => states.push(state), lingering().linger)
    const early = need(APP, ENVIRONMENT, '2026-10-05T10:00:00Z')
    engine.change(NeedChanged.make({ need: early }))
    engine.list([])
    await vi.waitFor(() => expect(readyNeeds(states)).toEqual([early]))
    const later = need(ACME, DECISION, '2026-10-05T11:00:00Z')
    engine.change(NeedChanged.make({ need: later }))
    expect(readyNeeds(states)).toEqual([early, later])
  })

  test('a need that ends stays a moment, settled, then leaves', async () => {
    const engine = scripted()
    const clock = lingering()
    const states: NeedsState[] = []
    followNeeds(engine.link, (state) => states.push(state), clock.linger)
    const asked = need(APP, ENVIRONMENT, '2026-10-05T10:00:00Z')
    engine.list([{ projectId: null, needs: [asked] }])
    await vi.waitFor(() => expect(readyNeeds(states)).toHaveLength(1))
    const expired = { ...asked, state: 'expired' as const, endedReason: 'it no longer holds' }
    engine.change(NeedChanged.make({ need: expired }))
    expect(readyNeeds(states)).toEqual([expired])
    clock.end()
    expect(readyNeeds(states)).toEqual([])
  })

  test('an ended need never heard of is not shown', async () => {
    const engine = scripted()
    const states: NeedsState[] = []
    followNeeds(engine.link, (state) => states.push(state), lingering().linger)
    engine.list([])
    await vi.waitFor(() => expect(states.at(-1)?.kind).toBe('ready'))
    const ended = need(APP, ENVIRONMENT, '2026-10-05T10:00:00Z', { state: 'answered' })
    engine.change(NeedChanged.make({ need: ended }))
    expect(readyNeeds(states)).toEqual([])
  })

  test('the mission of a need is read once for its key, and kept up to date by its changes', async () => {
    const engine = scripted()
    const states: NeedsState[] = []
    followNeeds(engine.link, (state) => states.push(state), lingering().linger)
    const a = need(onMission('m1'), DECISION, '2026-10-05T10:00:00Z')
    const b = need(onMission('m1'), ERROR, '2026-10-05T10:30:00Z')
    engine.list([{ projectId: 'acme', needs: [a, b] }])
    await vi.waitFor(() => expect(engine.missionsAsked).toEqual(['m1']))
    engine.missions.shift()?.resolve(mission('m1', 'ACME-12', '2026-10-05T10:00:00Z'))
    await vi.waitFor(() => {
      const last = states.at(-1)
      expect(last?.kind === 'ready' && last.missions.get('m1')?.key).toBe('ACME-12')
    })
    engine.change(
      MissionChanged.make({ mission: mission('m1', 'ACME-12', '2026-10-05T11:00:00Z') }),
    )
    const last = states.at(-1)
    expect(last?.kind === 'ready' && last.missions.get('m1')?.updatedAt).toBe(
      '2026-10-05T11:00:00Z',
    )
  })

  test('needs that cannot be read are said in the engine’s words, and read again on demand', async () => {
    const engine = scripted()
    const states: NeedsState[] = []
    const following = followNeeds(engine.link, (state) => states.push(state), lingering().linger)
    engine.refuseList(new StorageFailed({ sentence: 'The data folder refused while reading.' }))
    await vi.waitFor(() =>
      expect(states.at(-1)).toEqual({
        kind: 'failed',
        sentence: 'The data folder refused while reading.',
      }),
    )
    following.retry()
    engine.list([])
    await vi.waitFor(() => expect(states.at(-1)?.kind).toBe('ready'))
  })

  test('stopped, it no longer listens', () => {
    const engine = scripted()
    followNeeds(engine.link, () => undefined, lingering().linger).stop()
    expect(engine.listening()).toBe(0)
  })
})

describe('Answering from a card', () => {
  const started = async () => {
    const engine = scripted()
    const clock = lingering()
    const states: NeedsState[] = []
    const following = followNeeds(engine.link, (state) => states.push(state), clock.linger)
    const asked = need(onMission('m1'), DECISION, '2026-10-05T10:00:00Z')
    engine.list([{ projectId: 'acme', needs: [asked] }])
    await vi.waitFor(() => expect(readyNeeds(states)).toHaveLength(1))
    const answersOf = () => {
      const last = states.at(-1)
      return last?.kind === 'ready' ? last.answers.get(asked.id) : undefined
    }
    return { engine, clock, states, following, asked, answersOf }
  }

  test('the answer goes with a key of its own; its button waits; answered, the card settles then leaves', async () => {
    const { engine, clock, states, following, asked, answersOf } = await started()
    const chosen: NeedAnswer = ChosenAnswer.make({ option: 'invoices' })
    following.answer(asked.id, 'invoices', chosen)
    expect(answersOf()).toEqual({ answering: 'invoices' })
    const sent = engine.answers[0]
    expect(sent?.asked).toMatchObject({ id: asked.id, answer: chosen })
    expect(sent?.asked.key).toMatch(/\S{8,}/)
    sent?.resolve({ ...asked, state: 'answered', answer: chosen })
    await vi.waitFor(() => expect(answersOf()).toBeUndefined())
    expect(readyNeeds(states)[0]?.state).toBe('answered')
    clock.end()
    expect(readyNeeds(states)).toEqual([])
  })

  test('a refused answer says why and keeps the card to answer again', async () => {
    const { engine, states, following, asked, answersOf } = await started()
    following.answer(asked.id, 'invoices', ChosenAnswer.make({ option: 'invoices' }))
    engine.answers[0]?.reject(new NeedAnswerRefused({ reason: 'it is not one of the options' }))
    await vi.waitFor(() =>
      expect(answersOf()).toEqual({
        failure: 'This answer is refused: it is not one of the options.',
      }),
    )
    expect(readyNeeds(states)).toEqual([asked])
  })

  test('Retry on what is still missing says so; on what is there now, the need settles', async () => {
    const engine = scripted()
    const states: NeedsState[] = []
    const following = followNeeds(engine.link, (state) => states.push(state), lingering().linger)
    const asked = need(APP, ENVIRONMENT, '2026-10-05T10:00:00Z')
    engine.list([{ projectId: null, needs: [asked] }])
    await vi.waitFor(() => expect(readyNeeds(states)).toHaveLength(1))
    const answersOf = () => {
      const last = states.at(-1)
      return last?.kind === 'ready' ? last.answers.get(asked.id) : undefined
    }
    following.recheck(asked.id)
    expect(answersOf()).toEqual({ answering: 'Retry' })
    engine.retries.shift()?.resolve(asked)
    await vi.waitFor(() => expect(answersOf()).toEqual({ failure: 'It is still missing.' }))
    following.recheck(asked.id)
    engine.retries
      .shift()
      ?.resolve({ ...asked, state: 'withdrawn', endedReason: 'what was missing is there now' })
    await vi.waitFor(() => expect(readyNeeds(states)[0]?.state).toBe('withdrawn'))
    expect(answersOf()).toBeUndefined()
  })

  test('a card waiting or refused says so on its row', () => {
    const asked = need(onMission('m1'), DECISION, '2026-10-05T10:00:00Z')
    const state: NeedsState = {
      ...ready([asked]),
      answers: new Map([[asked.id, { failure: 'Hemera’s engine stopped.' }]]),
    }
    expect(needRowsOf(state, PROJECTS, NOW)[0]?.need).toMatchObject({
      failure: 'Hemera’s engine stopped.',
    })
  })
})
