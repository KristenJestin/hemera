/**
 * The living spec as the window feeds it: the engine's records in the page's words, the follower
 * that reads them and sends the gestures, and the Project's need of a model.
 */

import { EnvironmentFields, ProjectOwner } from '@hemera/core/domain'
import {
  LivingObsolete,
  LivingReplace,
  type BootstrapRun,
  type LivingChange,
  type LivingDomain,
  type LivingRequirement,
  type LivingSpecState,
  type Need,
  type NeedGroup,
} from '@hemera/ipc'
import { describe, expect, test } from 'vite-plus/test'

import {
  changeOf,
  domainOf,
  followLivingSpec,
  livingDataOf,
  noModelIn,
  requirementOf,
  runOf,
  type LivingSpecLink,
  type LivingSpecView,
} from '../src/renderer/living-spec-model.ts'

const NOW = new Date('2026-10-05T12:00:00.000Z')

const domain = (more: Partial<LivingDomain> = {}): LivingDomain => ({
  id: 'd1',
  projectId: 'acme',
  name: 'Invoicing',
  summary: 'Invoices are made and sent.',
  uncertainty: '',
  state: 'proposed',
  validatedAt: null,
  proposed: 1,
  validated: 1,
  pending: 0,
  lastChange: '2026-10-04T09:00:00.000Z',
  ...more,
})

const requirement = (more: Partial<LivingRequirement> = {}): LivingRequirement => ({
  id: 'LR1',
  domainId: 'd1',
  text: 'An invoice is numbered.',
  scenarios: [{ when: 'it is made', then: 'it gets the next number' }],
  origin: null,
  state: 'validated',
  uncertainty: '',
  version: 1,
  removed: false,
  pending: null,
  ...more,
})

const run = (more: Partial<BootstrapRun> = {}): BootstrapRun => ({
  id: 'run1',
  projectId: 'acme',
  domainId: null,
  state: 'done',
  sentence: null,
  commits: [],
  summary: null,
  startedAt: '2026-10-05T10:00:00.000Z',
  endedAt: '2026-10-05T10:05:00.000Z',
  ...more,
})

const change = (more: Partial<LivingChange> = {}): LivingChange => ({
  what: 'modified',
  versionBefore: 1,
  versionAfter: 2,
  textBefore: 'before',
  textAfter: 'after',
  scenariosBefore: null,
  scenariosAfter: null,
  by: 'user',
  byMission: null,
  at: '2026-10-04T09:00:00.000Z',
  ...more,
})

describe('the records in the page words', () => {
  test('a pending replacement or removal becomes a plain kind', () => {
    const replace = requirementOf(
      requirement({
        pending: LivingReplace.make({
          text: 'new',
          scenarios: [{ when: 'w', then: 't' }],
          uncertainty: 'unsure',
        }),
      }),
    )
    expect(replace.pending).toEqual({
      kind: 'replace',
      text: 'new',
      scenarios: [{ when: 'w', then: 't' }],
      uncertainty: 'unsure',
    })
    const obsolete = requirementOf(
      requirement({ pending: LivingObsolete.make({ reason: 'it is gone' }) }),
    )
    expect(obsolete.pending).toEqual({ kind: 'obsolete', reason: 'it is gone' })
    expect(requirementOf(requirement()).pending).toBeNull()
  })

  test('a domain says when it last changed in words', () => {
    expect(domainOf(domain(), NOW).lastChange).toBe('yesterday')
    expect(domainOf(domain({ lastChange: '2026-10-05T11:56:00.000Z' }), NOW).lastChange).toBe(
      '4 min',
    )
  })

  test('a history change says its date in words, and keeps what is not a date', () => {
    expect(changeOf(change(), NOW).at).toBe('yesterday')
    expect(changeOf(change({ at: 'long ago' }), NOW).at).toBe('long ago')
  })

  test('a run carries its instants in milliseconds', () => {
    expect(runOf(run())).toEqual({
      id: 'run1',
      domainId: null,
      state: 'done',
      sentence: null,
      startedAt: Date.parse('2026-10-05T10:00:00.000Z'),
      endedAt: Date.parse('2026-10-05T10:05:00.000Z'),
    })
    expect(runOf(run({ state: 'running', endedAt: null })).endedAt).toBeNull()
  })

  test('a domain not read yet has no key among the requirements', () => {
    const state: LivingSpecState = {
      domains: [domain(), domain({ id: 'd2', name: 'Payments' })],
      runs: [run()],
    }
    const data = livingDataOf(state, new Map([['d1', [requirement()]]]), false, NOW)
    expect(Object.keys(data.requirements)).toEqual(['d1'])
    expect(data.domains.map((one) => one.name)).toEqual(['Invoicing', 'Payments'])
    expect(data.runs).toHaveLength(1)
    expect(data.noModel).toBe(false)
  })
})

const need = (more: Partial<Need> = {}): Need => ({
  id: 'n1',
  owner: ProjectOwner.make({ projectId: 'acme' }),
  fields: EnvironmentFields.make({
    missing:
      'The living spec agent cannot start: Claude Code does not take the model huge: not offered',
    action: 'Choose another model for the living spec agent in Models by role, then Retry.',
    settingsSection: 'models',
  }),
  choices: [],
  requestedBy: null,
  state: 'pending',
  answer: null,
  endedReason: null,
  createdAt: '2026-10-05T09:00:00.000Z',
  endedAt: null,
  ...more,
})

describe('the Project need of a model', () => {
  const groups = (...needs: Need[]): NeedGroup[] => [{ projectId: 'acme', needs }]

  test('a pending need of the reading agent on its model is a missing model', () => {
    expect(noModelIn(groups(need()), 'acme')).toBe(true)
  })

  test('another Project, a settled need or another agent is not', () => {
    expect(noModelIn(groups(need()), 'other')).toBe(false)
    expect(noModelIn(groups(need({ state: 'answered' })), 'acme')).toBe(false)
    const chat = need({
      fields: EnvironmentFields.make({
        missing: 'The chat cannot start: no model',
        action: 'Choose one.',
        settingsSection: 'models',
      }),
    })
    expect(noModelIn(groups(chat), 'acme')).toBe(false)
    const agents = need({
      fields: EnvironmentFields.make({
        missing: 'The living spec agent cannot start: not signed in',
        action: 'Sign in.',
        settingsSection: 'agents',
      }),
    })
    expect(noModelIn(groups(agents), 'acme')).toBe(false)
  })
})

/** A promise a test settles when it chooses. */
const later = <A>() => {
  let settle: (value: A) => void = () => undefined
  let fail: (error: Error) => void = () => undefined
  const promise = new Promise<A>((resolve, reject) => {
    settle = resolve
    fail = reject
  })
  return { promise, settle, fail }
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

interface World {
  link: LivingSpecLink
  views: LivingSpecView[]
  last: () => LivingSpecView
  send: (state: LivingSpecState) => void
  end: (error: Error) => void
  subscriptions: () => number
  calls: Array<{ call: string; args: unknown[] }>
}

/** A link that answers what the test gives it and records the rest. */
function world(played: Partial<LivingSpecLink> = {}): World {
  const calls: World['calls'] = []
  let listener: (state: LivingSpecState) => void = () => undefined
  let onEnd: (error: Error) => void = () => undefined
  let subscriptions = 0
  const record =
    <A>(call: string, answer: A) =>
    (...args: unknown[]): Promise<A> => {
      calls.push({ call, args })
      return Promise.resolve(answer)
    }
  const link: LivingSpecLink = {
    onLivingSpec: (_project, heard, ended) => {
      subscriptions += 1
      listener = heard
      onEnd = ended
      return () => undefined
    },
    livingSpecRequirements: record('requirements', []),
    livingSpecRequirement: () => new Promise(() => undefined),
    validateDomain: record('validate', undefined),
    rejectDomain: record('reject', undefined),
    dropRequirement: record('drop', undefined),
    bootstrapLivingSpec: record('bootstrap', run()),
    needs: record('needs', []),
    ...played,
  }
  const views: LivingSpecView[] = []
  return {
    link,
    views,
    last: () => {
      const view = views.at(-1)
      if (view === undefined) throw new Error('no view yet')
      return view
    },
    send: (state) => listener(state),
    end: (error) => onEnd(error),
    subscriptions: () => subscriptions,
    calls,
  }
}

const STATE: LivingSpecState = {
  domains: [domain(), domain({ id: 'd2', name: 'Payments' })],
  runs: [run()],
}

describe('following the living spec', () => {
  test('the first state shows the domains and reads the requirements of the first', async () => {
    const played = world({
      livingSpecRequirements: (_project, domainId) =>
        Promise.resolve(domainId === 'd1' ? [requirement()] : []),
    })
    followLivingSpec(
      played.link,
      'acme',
      (view) => played.views.push(view),
      () => NOW,
    )
    played.send(STATE)
    expect(played.last().data?.domains).toHaveLength(2)
    expect(played.last().data?.requirements).toEqual({})
    await flush()
    expect(Object.keys(played.last().data?.requirements ?? {})).toEqual(['d1'])
  })

  test('opening a domain reads its requirements', async () => {
    const played = world()
    const following = followLivingSpec(
      played.link,
      'acme',
      (view) => played.views.push(view),
      () => NOW,
    )
    played.send(STATE)
    await flush()
    following.openDomain('d2')
    expect(played.last().opened).toBe('d2')
    await flush()
    expect(Object.keys(played.last().data?.requirements ?? {}).toSorted()).toEqual(['d1', 'd2'])
  })

  test('a change of a domain read reads its requirements again', async () => {
    const played = world()
    followLivingSpec(
      played.link,
      'acme',
      (view) => played.views.push(view),
      () => NOW,
    )
    played.send(STATE)
    await flush()
    const before = played.calls.filter((one) => one.call === 'requirements').length
    played.send({
      ...STATE,
      domains: [domain({ proposed: 0 }), domain({ id: 'd2', name: 'Payments' })],
    })
    await flush()
    expect(played.calls.filter((one) => one.call === 'requirements')).toHaveLength(before + 1)
  })

  test('validating names the requirements shown that wait on the user', async () => {
    const proposed = requirement({ id: 'LR2', state: 'proposed', version: 3 })
    const replaced = requirement({
      id: 'LR3',
      version: 2,
      pending: LivingObsolete.make({ reason: 'gone' }),
    })
    const settled = requirement({ id: 'LR1' })
    const played = world({
      livingSpecRequirements: () => Promise.resolve([settled, proposed, replaced]),
    })
    const following = followLivingSpec(
      played.link,
      'acme',
      (view) => played.views.push(view),
      () => NOW,
    )
    played.send(STATE)
    await flush()
    following.validate('d1')
    expect(played.last().busy).toBe('d1')
    await flush()
    const sent = played.calls.find((one) => one.call === 'validate')
    expect(sent?.args).toEqual([
      'd1',
      [
        { id: 'LR2', version: 3, pending: null },
        { id: 'LR3', version: 2, pending: LivingObsolete.make({ reason: 'gone' }) },
      ],
    ])
    expect(played.last().busy).toBeUndefined()
  })

  test('rejecting names what is shown too, and reads the domain again', async () => {
    let reads = 0
    const played = world({
      livingSpecRequirements: () => {
        reads += 1
        return Promise.resolve([requirement({ id: 'LR2', state: 'proposed' })])
      },
    })
    const following = followLivingSpec(
      played.link,
      'acme',
      (view) => played.views.push(view),
      () => NOW,
    )
    played.send(STATE)
    await flush()
    const before = reads
    following.reject('d1')
    await flush()
    expect(played.calls.find((one) => one.call === 'reject')?.args).toEqual([
      'd1',
      [{ id: 'LR2', version: 1, pending: null }],
    ])
    expect(reads).toBe(before + 1)
  })

  test('a refusal lands in refused and frees the domain', async () => {
    const played = world({
      livingSpecRequirements: () => Promise.resolve([requirement({ state: 'proposed' })]),
      validateDomain: () => Promise.reject(new Error('The domain changed while you read it.')),
    })
    const following = followLivingSpec(
      played.link,
      'acme',
      (view) => played.views.push(view),
      () => NOW,
    )
    played.send(STATE)
    await flush()
    following.validate('d1')
    await flush()
    expect(played.last().refused).toBe('The domain changed while you read it.')
    expect(played.last().busy).toBeUndefined()
  })

  test('dropping a requirement reads its domain again', async () => {
    let reads = 0
    const played = world({
      livingSpecRequirements: () => {
        reads += 1
        return Promise.resolve([requirement({ id: 'LR2', state: 'proposed' })])
      },
    })
    const following = followLivingSpec(
      played.link,
      'acme',
      (view) => played.views.push(view),
      () => NOW,
    )
    played.send(STATE)
    await flush()
    const before = reads
    following.drop('LR2')
    expect(played.last().busy).toBe('LR2')
    await flush()
    expect(played.calls.find((one) => one.call === 'drop')?.args).toEqual(['LR2'])
    expect(reads).toBe(before + 1)
  })

  test('reading again starts the reading of one domain or of all', async () => {
    const played = world()
    const following = followLivingSpec(
      played.link,
      'acme',
      (view) => played.views.push(view),
      () => NOW,
    )
    played.send(STATE)
    following.reread('d2')
    following.read()
    await flush()
    expect(played.calls.filter((one) => one.call === 'bootstrap').map((one) => one.args)).toEqual([
      ['acme', 'd2'],
      ['acme'],
    ])
  })

  test('the answer of a read that a later one overtook is dropped', async () => {
    const first = later<LivingRequirement[]>()
    const second = later<LivingRequirement[]>()
    const answers = [first, second]
    let asked = 0
    const played = world({
      livingSpecRequirements: () => {
        const answer = answers[asked]
        asked += 1
        return answer === undefined ? Promise.resolve([]) : answer.promise
      },
    })
    const following = followLivingSpec(
      played.link,
      'acme',
      (view) => played.views.push(view),
      () => NOW,
    )
    played.send(STATE)
    following.openDomain('d1')
    second.settle([requirement({ text: 'The newer reading.' })])
    await flush()
    first.settle([requirement({ text: 'The older reading.' })])
    await flush()
    expect(played.last().data?.requirements.d1?.[0]?.text).toBe('The newer reading.')
  })

  test('the answer of a gesture that a later one overtook leaves the later one busy', async () => {
    const first = later<undefined>()
    const second = later<undefined>()
    const answers = [first, second]
    let asked = 0
    const played = world({
      livingSpecRequirements: () =>
        Promise.resolve([requirement({ id: 'LR2', state: 'proposed' })]),
      dropRequirement: () => {
        const answer = answers[asked]
        asked += 1
        return answer === undefined ? Promise.resolve() : answer.promise
      },
    })
    const following = followLivingSpec(
      played.link,
      'acme',
      (view) => played.views.push(view),
      () => NOW,
    )
    played.send(STATE)
    await flush()
    following.drop('LR2')
    following.drop('LR2')
    first.settle(undefined)
    await flush()
    expect(played.last().busy).toBe('LR2')
    second.settle(undefined)
    await flush()
    expect(played.last().busy).toBeUndefined()
  })

  test('a history is loading, then read in words', async () => {
    const detail = later<unknown>()
    const played = world({
      livingSpecRequirement: () => {
        // SAFETY: the follower reads only `history` of the detail.
        return detail.promise as never
      },
    })
    const following = followLivingSpec(
      played.link,
      'acme',
      (view) => played.views.push(view),
      () => NOW,
    )
    played.send(STATE)
    following.history('LR1')
    expect(played.last().histories.LR1).toBe('loading')
    detail.settle({ history: [change()] })
    await flush()
    const read = played.last().histories.LR1
    expect(Array.isArray(read) ? read[0]?.at : null).toBe('yesterday')
  })

  test('the Project need of a model makes the data say so', async () => {
    const played = world({ needs: () => Promise.resolve([{ projectId: 'acme', needs: [need()] }]) })
    followLivingSpec(
      played.link,
      'acme',
      (view) => played.views.push(view),
      () => NOW,
    )
    played.send({ domains: [], runs: [run({ state: 'failed', sentence: 'No model.' })] })
    await flush()
    expect(played.last().data?.noModel).toBe(true)
  })

  test('a stream that ends says why, and retrying follows it again', () => {
    const played = world()
    const following = followLivingSpec(
      played.link,
      'acme',
      (view) => played.views.push(view),
      () => NOW,
    )
    played.end(new Error('The engine is gone.'))
    expect(played.last().error).toBe('The engine is gone.')
    expect(played.last().data).toBeNull()
    following.retry()
    expect(played.subscriptions()).toBe(2)
    expect(played.last().error).toBeUndefined()
  })

  test('nothing is heard once it is stopped', async () => {
    const played = world()
    const following = followLivingSpec(
      played.link,
      'acme',
      (view) => played.views.push(view),
      () => NOW,
    )
    following.stop()
    played.send(STATE)
    await flush()
    expect(played.views).toHaveLength(0)
  })
})
