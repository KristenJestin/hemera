/**
 * What the ticket providers show of the engine's records, and what their forms write back: a
 * provider's line and the words of its trouble, the sentence of the section's glyph, the words of
 * a refused removal, and each form's draft turned into the engine's configuration.
 */

import type { ProviderStatus } from '@hemera/core/domain'
import { type JiraTokenStatus, ProviderInUse, type TicketProviderInfo } from '@hemera/ipc'
import { providerProblem } from '@hemera/ui'
import { describe, expect, test } from 'vite-plus/test'

import {
  type JiraAddDraft,
  type GithubAddDraft,
  checkProvider,
  githubEdited,
  proposalsArrived,
  readProvider,
  submitJira,
  githubConfigOf,
  githubRefusal,
  jiraConfigOf,
  jiraRefusal,
  projectKeysOf,
  providerStore,
  providerViewsOf,
  removalWords,
  scopeOf,
  sinceWords,
} from '../src/renderer/ticket-providers-model.ts'

const GITHUB: TicketProviderInfo = {
  id: 'github',
  projectId: 'acme',
  kind: 'github',
  host: 'github.com',
  repositories: ['acme/api', 'acme/web'],
  jira: null,
  unreachableSince: null,
  createdAt: '2026-10-01T09:00:00.000Z',
}

const JIRA: TicketProviderInfo = {
  id: 'jira',
  projectId: 'acme',
  kind: 'jira',
  host: 'acme.atlassian.net',
  repositories: [],
  jira: {
    site: 'https://acme.atlassian.net',
    deployment: 'cloud',
    email: 'dev@acme.example',
    projectKeys: ['SHOP', 'OPS'],
  },
  unreachableSince: null,
  createdAt: '2026-10-01T09:00:00.000Z',
}

const READY: ProviderStatus = { state: 'ready', sentence: 'Ready.', fix: null }

const FOR = (providers: ReadonlyArray<TicketProviderInfo>) => ({
  infos: providers,
  statuses: new Map(providers.map((one) => [one.id, READY])),
  tokens: new Map<string, JiraTokenStatus>(
    providers.flatMap((one) => (one.kind === 'jira' ? [[one.id, 'saved'] as const] : [])),
  ),
})

describe('The scope words of a provider', () => {
  test('GitHub covers its repositories, in the order they were chosen', () => {
    expect(scopeOf(GITHUB)).toBe('acme/api, acme/web')
  })

  test('Jira covers its project keys', () => {
    expect(scopeOf(JIRA)).toBe('SHOP, OPS')
  })

  test('a provider that covers nothing says so', () => {
    expect(scopeOf({ ...GITHUB, repositories: [] })).toBe('No repository chosen')
    expect(scopeOf({ ...JIRA, jira: { ...JIRA.jira!, projectKeys: [] } })).toBe('No project key')
  })
})

describe('Since when a provider is unreachable', () => {
  const now = new Date('2026-10-09T12:00:00.000Z')

  test('today, by the time of day', () => {
    expect(sinceWords('2026-10-09T08:12:00.000Z', now, 'UTC')).toBe('since 08:12')
  })

  test('another day, by the day and the time', () => {
    expect(sinceWords('2026-10-07T08:12:00.000Z', now, 'UTC')).toBe('since 7 Oct, 08:12')
  })

  test('a date that cannot be read says nothing', () => {
    expect(sinceWords('whenever', now, 'UTC')).toBeNull()
  })
})

describe('The lines of the providers', () => {
  test('a provider whose status is not read yet is on its way', () => {
    const state = { ...FOR([GITHUB]), statuses: new Map<string, ProviderStatus>() }
    expect(providerViewsOf(state, new Date(), 'UTC')?.[0]?.status).toBeNull()
  })

  test('a list not read yet is null', () => {
    expect(providerViewsOf({ ...FOR([]), infos: null }, new Date(), 'UTC')).toBeNull()
  })

  test('a Jira provider carries where its token stands, GitHub none', () => {
    const [github, jira] = providerViewsOf(FOR([GITHUB, JIRA]), new Date(), 'UTC') ?? []
    expect(github?.token).toBeUndefined()
    expect(jira?.token).toBe('saved')
  })

  test('an unreachable provider says since when, on its line', () => {
    const state = FOR([{ ...JIRA, unreachableSince: '2026-10-09T08:12:00.000Z' }])
    const [jira] = providerViewsOf(state, new Date('2026-10-09T12:00:00.000Z'), 'UTC') ?? []
    expect(jira?.unreachableSince).toBe('since 08:12')
  })

  test('the status keeps its sentence and its fix, nothing of the engine besides', () => {
    const missing: ProviderStatus = {
      state: 'missing_cli',
      sentence: 'gh is not installed.',
      fix: 'winget install --id GitHub.cli',
      limitedUntil: '2026-10-09T13:00:00.000Z',
    }
    const state = { ...FOR([GITHUB]), statuses: new Map([['github', missing]]) }
    const [github] = providerViewsOf(state, new Date(), 'UTC') ?? []
    expect(github?.status).toEqual({
      state: 'missing_cli',
      sentence: 'gh is not installed.',
      fix: 'winget install --id GitHub.cli',
    })
  })
})

describe('The sentence of the section’s glyph', () => {
  const problem = (state: ReturnType<typeof FOR>) => providerViewsOf(state, new Date(), 'UTC') ?? []

  test('nothing is said while every provider is ready', () => {
    expect(providerProblem(problem(FOR([GITHUB, JIRA])))).toBeUndefined()
  })

  test('the first provider that waits on the user is named', () => {
    const state = {
      ...FOR([GITHUB, JIRA]),
      statuses: new Map<string, ProviderStatus>([
        ['github', READY],
        ['jira', { state: 'unreachable', sentence: 'It does not answer.', fix: null }],
      ]),
    }
    expect(providerProblem(problem(state))).toBe('Jira · acme.atlassian.net needs you')
  })

  test('a token that is not saved is a trouble although the provider is ready', () => {
    const state = {
      ...FOR([JIRA]),
      tokens: new Map<string, JiraTokenStatus>([['jira', 'missing']]),
    }
    expect(providerProblem(problem(state))).toBe('Jira · acme.atlassian.net needs you')
  })
})

describe('The words of a refused removal', () => {
  test('the missions that still read from the provider are named', () => {
    const refusal = new ProviderInUse({ missionKeys: ['ACME-12', 'ACME-14'] })
    expect(removalWords(refusal)).toBe(
      'This provider reads the ticket of ACME-12, ACME-14: it cannot be removed while those missions are live.',
    )
  })

  test('one mission is said in the singular', () => {
    expect(removalWords(new ProviderInUse({ missionKeys: ['ACME-12'] }))).toContain(
      'while that mission is live',
    )
  })

  test('any other refusal is said as the provider could not be removed', () => {
    expect(removalWords(new Error('The engine is starting.'))).toBe(
      'The provider could not be removed: The engine is starting.',
    )
  })
})

describe('What the GitHub form writes', () => {
  test('the host is kept in lower case and the repositories as chosen', () => {
    expect(githubConfigOf({ host: ' GitHub.com ', repositories: ['acme/api'] })).toEqual({
      host: 'github.com',
      repositories: ['acme/api'],
    })
  })

  test('a host is asked for', () => {
    expect(githubRefusal({ host: ' ', repositories: ['acme/api'] })).toBe('Write the host.')
  })

  test('at least one repository is asked for', () => {
    expect(githubRefusal({ host: 'github.com', repositories: [] })).toBe(
      'Choose at least one repository.',
    )
  })

  test('a complete form is not refused', () => {
    expect(githubRefusal({ host: 'github.com', repositories: ['acme/api'] })).toBeUndefined()
  })
})

describe('What the Jira form writes', () => {
  const draft = {
    site: ' https://acme.atlassian.net ',
    deployment: 'cloud' as const,
    email: ' dev@acme.example ',
    projectKeys: 'shop, OPS  shop',
  }

  test('the project keys are split on commas and spaces, in capitals, each once', () => {
    expect(projectKeysOf('shop, OPS  shop,,')).toEqual(['SHOP', 'OPS'])
  })

  test('Cloud keeps the account email', () => {
    expect(jiraConfigOf(draft)).toEqual({
      site: 'https://acme.atlassian.net',
      deployment: 'cloud',
      email: 'dev@acme.example',
      projectKeys: ['SHOP', 'OPS'],
    })
  })

  test('Data Center has no account email', () => {
    expect(jiraConfigOf({ ...draft, deployment: 'datacenter' }).email).toBeNull()
  })

  test('the site, the email of Cloud and a project key are asked for, in that order', () => {
    expect(jiraRefusal({ ...draft, site: '' })).toBe('Write the address of the Jira site.')
    expect(jiraRefusal({ ...draft, email: '' })).toBe('Write the email of the Jira account.')
    expect(jiraRefusal({ ...draft, projectKeys: ' , ' })).toBe('Write at least one project key.')
    expect(jiraRefusal({ ...draft, deployment: 'datacenter', email: '' })).toBeUndefined()
    expect(jiraRefusal(draft)).toBeUndefined()
  })
})

describe('The store a dialog and its foot share', () => {
  test('a change reaches every listener, and the state read is the last one', () => {
    const store = providerStore<{ saving: boolean; refused: string | undefined }>({
      saving: false,
      refused: undefined,
    })
    const heard: boolean[] = []
    const stop = store.subscribe(() => heard.push(store.get().saving))
    store.set({ saving: true })
    stop()
    store.set({ saving: false })
    expect(heard).toEqual([true])
    expect(store.get().saving).toBe(false)
  })
})

/** A promise a test settles by hand. */
interface Settled<A> {
  promise: Promise<A>
  resolve: (value: A) => void
}

function pending<A>(): Settled<A> {
  let resolve: (value: A) => void = () => undefined
  const promise = new Promise<A>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const emptyState = () =>
  providerStore<{
    infos: ReadonlyArray<TicketProviderInfo> | null
    statuses: ReadonlyMap<string, ProviderStatus>
    tokens: ReadonlyMap<string, JiraTokenStatus>
  }>({ infos: [GITHUB, JIRA], statuses: new Map(), tokens: new Map() })

describe('Adding a Jira provider with a token', () => {
  const jiraDraft = () =>
    providerStore<JiraAddDraft>({
      jira: {
        site: 'https://acme.atlassian.net',
        deployment: 'cloud',
        email: 'a@b.c',
        projectKeys: 'SHOP',
      },
      chosen: false,
      added: null,
      filled: false,
      saving: false,
      tokenRefused: undefined,
      refused: undefined,
    })
  const linkOf = (answers: JiraTokenStatus[]) => {
    const saved: Array<[string, string]> = []
    const calls = { addJira: 0, saved }
    return {
      calls,
      link: {
        addJira: () => {
          calls.addJira += 1
          return Promise.resolve(JIRA)
        },
        saveJiraToken: (id: string, token: string) => {
          calls.saved.push([id, token])
          return Promise.resolve(answers.shift() ?? 'saved')
        },
        removeJiraToken: () => Promise.resolve('missing' as const),
        providerStatus: () => Promise.resolve(READY),
        jiraTokenStatus: () => Promise.resolve('saved' as const),
      },
    }
  }

  test('a token refused and saved again adds the provider once', async () => {
    const { calls, link } = linkOf(['invalid', 'saved'])
    const draft = jiraDraft()
    const store = emptyState()
    expect(await submitJira(link, store, draft, 'acme', 'wrong')).toBe(false)
    expect(draft.get().tokenRefused).toBe('Jira refused this token.')
    expect(draft.get().saving).toBe(false)
    expect(await submitJira(link, store, draft, 'acme', 'right')).toBe(true)
    expect(calls.addJira).toBe(1)
    expect(calls.saved).toEqual([
      ['jira', 'wrong'],
      ['jira', 'right'],
    ])
  })

  test('a token answered invalid keeps the dialog open and says so', async () => {
    const { link } = linkOf(['invalid'])
    const draft = jiraDraft()
    expect(await submitJira(link, emptyState(), draft, 'acme', 'wrong')).toBe(false)
    expect(draft.get().tokenRefused).toBe('Jira refused this token.')
  })

  test('the foot adds the provider without a token, and once if it was already added', async () => {
    const { calls, link } = linkOf(['invalid'])
    const draft = jiraDraft()
    const store = emptyState()
    await submitJira(link, store, draft, 'acme', 'wrong')
    expect(await submitJira(link, store, draft, 'acme', null)).toBe(true)
    expect(calls.addJira).toBe(1)
    const fresh = linkOf([])
    expect(await submitJira(fresh.link, emptyState(), jiraDraft(), 'acme', null)).toBe(true)
    expect(fresh.calls.saved).toEqual([])
  })
})

describe('Adding a GitHub provider whose repositories were ticked by hand', () => {
  const github = (more: Partial<GithubAddDraft> = {}): GithubAddDraft => ({
    github: { host: 'github.com', repositories: [] },
    proposed: [],
    preselected: false,
    touched: false,
    saving: false,
    refused: undefined,
    ...more,
  })

  test('the proposals arriving after a manual add keep it', () => {
    const edited = {
      ...github(),
      ...githubEdited(github(), { host: 'github.com', repositories: ['acme/mine'] }),
    }
    expect(edited.touched).toBe(true)
    const after = { ...edited, ...proposalsArrived(edited, ['acme/api', 'acme/web']) }
    expect(after.github.repositories).toEqual(['acme/mine'])
    expect(after.proposed).toEqual(['acme/api', 'acme/web'])
  })

  test('the first proposals are ticked when nothing was touched, a host edit is not a touch', () => {
    const typed = {
      ...github(),
      ...githubEdited(github(), { host: 'ghe.acme.example', repositories: [] }),
    }
    expect(typed.touched).toBe(false)
    const after = { ...typed, ...proposalsArrived(typed, ['acme/api']) }
    expect(after.github.repositories).toEqual(['acme/api'])
  })
})

describe('Reads that come back out of order', () => {
  test('an older status answer does not overwrite a fresh Check again', async () => {
    const store = emptyState()
    const old = pending<ProviderStatus>()
    const fresh: ProviderStatus = { state: 'ready', sentence: 'Fresh.', fix: null }
    const stale: ProviderStatus = { state: 'unreachable', sentence: 'Stale.', fix: null }
    const link = {
      providerStatus: () => old.promise,
      jiraTokenStatus: () => Promise.resolve('saved' as const),
      checkProviderAgain: () => Promise.resolve(fresh),
    }
    readProvider(link, store, GITHUB)
    await checkProvider(link, store, 'github')
    expect(store.get().statuses.get('github')).toEqual(fresh)
    old.resolve(stale)
    await old.promise
    await Promise.resolve()
    expect(store.get().statuses.get('github')).toEqual(fresh)
  })

  test('the latest of two reads wins, whichever answers last', async () => {
    const store = emptyState()
    const first = pending<ProviderStatus>()
    const second = pending<ProviderStatus>()
    const answers = [first.promise, second.promise]
    const link = {
      providerStatus: () => answers.shift() ?? first.promise,
      jiraTokenStatus: () => Promise.resolve('saved' as const),
    }
    readProvider(link, store, GITHUB)
    readProvider(link, store, GITHUB)
    second.resolve({ state: 'ready', sentence: 'Second.', fix: null })
    await second.promise
    first.resolve({ state: 'ready', sentence: 'First.', fix: null })
    await first.promise
    await Promise.resolve()
    expect(store.get().statuses.get('github')?.sentence).toBe('Second.')
  })
})
