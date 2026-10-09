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
