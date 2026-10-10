/**
 * A Jira token is never shown: it crosses one call, from the window to main, and nothing the
 * window decodes from the engine carries it back, no `ProviderView` the screens are given has a
 * place for it, no story draws one, and the field that takes it is empty once it was given. This
 * file checks the first four; the last needs a rendered field and is played by the story
 * `JiraTokenMissing` of the ticket providers (type a token, Save, the field is empty and no text of
 * the dialog holds it).
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  JiraProviderConfig,
  JiraTokenRpcs,
  JiraTokenStatus,
  TicketProviderInfo,
  TicketsSettings,
  WindowRpcs,
} from '@hemera/ipc'
import { Schema } from 'effect'
import { describe, expect, test } from 'vite-plus/test'

import { providerViewsOf } from '../src/renderer/ticket-providers-model.ts'

const SECRET = 'jira-secret-0123456789'

const INFO = {
  id: 'jira',
  projectId: 'acme',
  kind: 'jira',
  host: 'acme.atlassian.net',
  repositories: [],
  jira: {
    site: 'https://acme.atlassian.net',
    deployment: 'cloud',
    email: 'dev@acme.example',
    projectKeys: ['SHOP'],
  },
  unreachableSince: null,
  createdAt: '2026-10-01T09:00:00.000Z',
}

/** The names a value is written with, as its JSON gives them. */
const namesIn = (value: TicketProviderInfo): string[] =>
  [...JSON.stringify(value).matchAll(/"([^"]+)":/g)].map((one) => one[1] ?? '')

describe('A Jira token the window never receives', () => {
  test('the window may ask the token calls and not the engine’s own', () => {
    const asked = [...WindowRpcs.requests.keys()]
    expect(asked).toContain('tickets.saveJiraToken')
    expect(asked.filter((one) => one.startsWith('jiraToken.'))).toEqual([])
  })

  test('the three token calls answer where the token stands and nothing else', () => {
    for (const rpc of JiraTokenRpcs.requests.values()) {
      const answer = Schema.decodeUnknownSync(rpc.successSchema)
      for (const status of ['missing', 'saved', 'invalid', 'storage-unavailable']) {
        expect(answer(status)).toBe(status)
      }
      expect(() => answer(SECRET)).toThrow()
    }
    expect(JiraTokenStatus.literals).toEqual(['missing', 'saved', 'invalid', 'storage-unavailable'])
  })

  test('the providers decoded by the window drop what an answer might add to them', () => {
    const leaky = {
      ...INFO,
      token: SECRET,
      ciphertext: SECRET,
      jira: { ...INFO.jira, token: SECRET, apiToken: SECRET },
    }
    const provider = Schema.decodeUnknownSync(TicketProviderInfo)(leaky)
    expect(JSON.stringify(provider)).not.toContain(SECRET)
    const config = Schema.decodeUnknownSync(JiraProviderConfig)(leaky.jira)
    expect(JSON.stringify(config)).not.toContain(SECRET)
    const settings = Schema.decodeUnknownSync(TicketsSettings)({
      projectId: 'acme',
      specMode: 'local',
      providers: [leaky],
      token: SECRET,
    })
    expect(JSON.stringify(settings)).not.toContain(SECRET)
  })

  test('no field of what the window decodes is named for a secret', () => {
    const provider = Schema.decodeUnknownSync(TicketProviderInfo)(INFO)
    expect(namesIn(provider).join(' ')).not.toMatch(/token|secret|password|ciphertext/i)
  })

  test('the lines the screens are given carry a status of the token and never its value', () => {
    const info = Schema.decodeUnknownSync(TicketProviderInfo)(INFO)
    for (const status of JiraTokenStatus.literals) {
      const views = providerViewsOf(
        { infos: [info], statuses: new Map(), tokens: new Map([['jira', status]]) },
        new Date(),
        'UTC',
      )
      expect(views?.[0]?.token).toBe(status)
      expect(JSON.stringify(views)).not.toContain(SECRET)
    }
  })

  test('no story fixture holds a token: each `token` is one of the four statuses', () => {
    const stories = readFileSync(
      join(
        import.meta.dirname,
        '..',
        '..',
        '..',
        'packages',
        'ui',
        'src',
        'blocks',
        'project-settings',
        'ticket-providers.stories.tsx',
      ),
      'utf8',
    )
    const given = [...stories.matchAll(/\btoken:\s*(['"`])([^'"`]*)\1/g)].map((one) => one[2])
    expect(given.length).toBeGreaterThan(0)
    for (const value of given) {
      expect(JiraTokenStatus.literals).toContain(value)
    }
  })
})
