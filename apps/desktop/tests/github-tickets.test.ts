/**
 * GitHub issues through `gh`: the CLI found or missing, its login checked, every call an argument
 * array with no shell, the user's own configuration, its standard input closed and a 30-second
 * limit; an issue read with its paged comments, a pull request refused, a search over the
 * provider's repositories, the grouped `changedSince`, and the provider's messages masked.
 *
 * `gh` is a fake script per test (`fake-gh.ts`) that records its calls and answers fixtures; no
 * test runs a real `gh` or reaches GitHub.
 */

import { existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { delimiter, join } from 'node:path'

import {
  GithubIssue,
  ProviderLimited,
  ProviderNotAuthenticated,
  ProviderUnreachable,
  TicketNotFound,
  type TicketReference,
  TicketUnreadable,
  parseTicketReference,
} from '@hemera/core/domain'
import { Effect, Option, Predicate } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { secretsRegistry } from '../src/engine/secrets.ts'
import { GhCli, type GhSettings, findOnPath } from '../src/engine/tickets/gh.ts'
import { githubProvider } from '../src/engine/tickets/github.ts'
import { commandsEngine } from './commands-engine.ts'
import { type GhRule, fakeGh, included } from './fake-gh.ts'
import { removeFolders, temporaryFolder } from './storage.ts'

let data: string
beforeEach(() => {
  data = realpathSync.native(temporaryFolder('github-tickets'))
})
afterEach(removeFolders)

const ACME = { host: 'github.com', repositories: ['acme/shop', 'acme/api'] }

const reference = (text: string): TicketReference => {
  const parsed = parseTicketReference(text)
  if (parsed === null) throw new Error(`${text} is not a reference`)
  return parsed
}

/** Runs a program on a GitHub provider over this `gh`. */
const withProvider = <A, E>(
  gh: GhSettings,
  program: (provider: Effect.Success<ReturnType<typeof githubProvider>>) => Effect.Effect<A, E>,
  config = ACME,
  secrets = secretsRegistry(),
) =>
  commandsEngine(data, { gh, secrets })(({ profile }) =>
    profile.use(Effect.flatMap(githubProvider(config), program)),
  )

const VERSION: GhRule = {
  when: ['--version'],
  stdout: 'gh version 2.81.0 (2026-09-30)\nhttps://github.com/cli/cli/releases/tag/v2.81.0\n',
}

const issuePage = (comments: ReadonlyArray<object>, page: { next: string | null }) =>
  included(
    JSON.stringify({
      data: {
        repository: {
          issueOrPullRequest: {
            __typename: 'Issue',
            number: 41,
            title: 'Export notes as Markdown',
            body: 'Reported by the support team.\n\n## Why\nExports are slow.\n\n## Requirements\n- WHEN a note holds an accent THEN the file keeps it\n',
            state: 'CLOSED',
            stateReason: 'NOT_PLANNED',
            url: 'https://github.com/acme/shop/issues/41',
            updatedAt: '2026-10-01T10:00:00Z',
            author: { login: 'ada' },
            labels: { nodes: [{ name: 'export' }, { name: 'notes' }] },
            comments: {
              pageInfo: { hasNextPage: page.next !== null, endCursor: page.next },
              nodes: comments,
            },
          },
        },
      },
    }),
  )

const comment = (id: string, body: string, edited: string | null = null) => ({
  id,
  author: id === 'IC_3' ? null : { login: 'grace' },
  body,
  createdAt: '2026-10-01T09:00:00Z',
  lastEditedAt: edited,
})

describe('gh found, logged in or not: three statuses with their sentences and commands', () => {
  test('gh missing from the PATH is missing_cli, with the install hint', async () => {
    const empty = temporaryFolder('no-gh')
    const status = await withProvider(
      { path: empty, env: { PATH: empty } },
      (provider) => provider.status,
    )
    expect(status.state).toBe('missing_cli')
    expect(status.sentence).toContain('GitHub CLI (gh) was not found on the PATH')
    expect(status.sentence).toContain('https://cli.github.com')
  })

  test('the suites’ engine finds no gh unless a fake is given, even with one on the PATH', async () => {
    const folder = temporaryFolder('gh-on-path')
    writeFileSync(join(folder, 'gh'), '')
    writeFileSync(join(folder, 'gh.exe'), '')
    const before = process.env['PATH']
    process.env['PATH'] = [folder, before ?? ''].join(delimiter)
    try {
      const found = await commandsEngine(data)(({ profile }) =>
        profile.use(GhCli.use((gh) => gh.program)),
      )
      expect(Option.isNone(found)).toBe(true)
    } finally {
      process.env['PATH'] = before
    }
  })

  test('not logged in to the host is not_authenticated, with gh auth login for that host', async () => {
    const gh = fakeGh([
      VERSION,
      {
        when: ['auth', 'status', 'git.acme.test'],
        stderr: 'You are not logged into any GitHub hosts. To log in, run: gh auth login\n',
        code: 1,
      },
    ])
    const status = await withProvider(gh.settings, (provider) => provider.status, {
      host: 'git.acme.test',
      repositories: [],
    })
    expect(status).toEqual({
      state: 'not_authenticated',
      sentence: 'GitHub CLI is not logged in to git.acme.test.',
      fix: 'gh auth login --hostname git.acme.test',
    })
    expect(gh.calls().map((call) => call.args)).toEqual([
      ['--version'],
      ['auth', 'status', '--hostname', 'git.acme.test'],
    ])
  })

  test('logged in is ready, and says the gh version', async () => {
    const gh = fakeGh([VERSION, { when: ['auth', 'status'], stdout: '✓ Logged in\n' }])
    const status = await withProvider(gh.settings, (provider) => provider.status)
    expect(status).toEqual({
      state: 'ready',
      sentence: 'GitHub CLI 2.81.0 is logged in to github.com.',
      fix: null,
    })
  })
})

describe('gh is found on the user’s PATH, gh.exe on Windows', () => {
  test('the first folder of the PATH that holds it, a folder with the wrong name skipped', () => {
    const empty = temporaryFolder('path-empty')
    const linux = temporaryFolder('path-linux')
    const windows = temporaryFolder('path-windows')
    writeFileSync(join(linux, 'gh'), '')
    writeFileSync(join(windows, 'gh.exe'), '')
    mkdirSync(join(empty, 'gh'))
    expect(findOnPath('gh', [empty, linux, windows].join(delimiter), 'linux')).toBe(
      join(linux, 'gh'),
    )
    expect(findOnPath('gh', [empty, linux, windows].join(';'), 'win32')).toBe(
      join(windows, 'gh.exe'),
    )
    expect(findOnPath('gh', empty, 'linux')).toBeNull()
  })
})

describe('gh runs as a program: argument array, no shell, the user’s configuration, a limit', () => {
  test('arguments reach gh as they are, with stdin closed and the user’s own gh configuration', async () => {
    const userConfig = temporaryFolder('user-gh-config')
    const gh = fakeGh([{ when: ['search/issues'], stdout: included('{"items":[]}') }], {
      env: { GH_CONFIG_DIR: userConfig },
    })
    const marker = join(data, 'shell-ran')
    const text = `$(node -e "require('fs').writeFileSync('${marker}','')") ; --repo evil/x`
    const hits = await withProvider(gh.settings, (provider) => provider.search(text))
    expect(hits).toEqual([])
    const [call] = gh.calls()
    expect(call?.args).toEqual([
      'api',
      '--method',
      'GET',
      'search/issues',
      '--hostname',
      'github.com',
      '--include',
      '-f',
      `q=${text} is:issue repo:acme/shop repo:acme/api`,
      '-f',
      'sort=updated',
      '-f',
      'order=desc',
      '-F',
      'per_page=20',
    ])
    expect(existsSync(marker)).toBe(false)
    expect(call?.stdin).toBe('')
    expect(call?.env).toEqual({
      GH_CONFIG_DIR: userConfig,
      GH_HOST: 'github.com',
      GH_PROMPT_DISABLED: '1',
      GH_NO_UPDATE_NOTIFIER: '1',
      NO_COLOR: '1',
      GH_TOKEN: null,
      GITHUB_TOKEN: null,
    })
  })

  test('a hung gh is killed at the limit and reported unreachable', async () => {
    const gh = fakeGh([{ when: ['graphql'], hang: true }], { limitMillis: 400 })
    const failed = await withProvider(gh.settings, (provider) =>
      Effect.flip(provider.read(reference('acme/shop#41'))),
    )
    expect(failed).toBeInstanceOf(ProviderUnreachable)
    expect(failed.message).toContain('did not answer within')
    const [call] = gh.calls()
    // The read answers once the process has ended, never while it is still there.
    expect(() => process.kill(call?.pid ?? 0, 0)).toThrow()
  })
})

describe('read: an issue mapped from GitHub’s GraphQL answer', () => {
  test('a fixture issue with comments on two pages is read whole, in order', async () => {
    const gh = fakeGh([
      {
        when: ['graphql', 'after=CURSOR-1'],
        stdout: issuePage([comment('IC_3', 'Third, from a deleted account')], { next: null }),
      },
      {
        when: ['graphql'],
        stdout: issuePage(
          [comment('IC_1', 'First  \r\n', '2026-10-01T09:30:00Z'), comment('IC_2', 'Second')],
          { next: 'CURSOR-1' },
        ),
      },
    ])
    const version = await withProvider(gh.settings, (provider) =>
      provider.read(reference('https://github.com/Acme/Shop/issues/41')),
    )
    expect(version).toMatchObject({
      provider: 'github',
      reference: 'github:github.com/acme/shop#41',
      key: 'acme/shop#41',
      url: 'https://github.com/acme/shop/issues/41',
      title: 'Export notes as Markdown',
      status: { state: 'closed', wording: 'closed · not planned' },
      author: 'ada',
      labels: ['export', 'notes'],
      updatedAt: '2026-10-01T10:00:00Z',
    })
    expect(version.comments.map((one) => [one.id, one.author, one.editedAt])).toEqual([
      ['IC_1', 'grace', '2026-10-01T09:30:00Z'],
      ['IC_2', 'grace', null],
      ['IC_3', null, null],
    ])
    expect(version.fingerprint).toMatch(/^[0-9a-f]{64}$/)
    expect(version.comments[0]?.fingerprint).toMatch(/^[0-9a-f]{64}$/)
    expect(version.comments[0]?.fingerprint).not.toBe(version.comments[1]?.fingerprint)
    expect(version.sections.map((one) => one.section)).toEqual(['why', 'requirements'])
    expect(version.sections[1]?.scenarios).toEqual([
      { when: 'a note holds an accent', then: 'the file keeps it' },
    ])
    expect(version.unrecognised.map((one) => one.text)).toEqual([
      'Reported by the support team.\n\n',
    ])
    const [first, second] = gh.calls()
    expect(first?.args.slice(0, 5)).toEqual([
      'api',
      'graphql',
      '--hostname',
      'github.com',
      '--include',
    ])
    expect(first?.args).toContain('owner=acme')
    expect(first?.args).toContain('name=shop')
    expect(first?.args).toContain('number=41')
    expect(first?.args.some((arg) => arg.startsWith('after='))).toBe(false)
    expect(second?.args).toContain('after=CURSOR-1')
  })

  test('the GitHub status words: open, closed · completed, closed · not planned', async () => {
    const answer = (state: string, stateReason: string | null) =>
      included(
        JSON.stringify({
          data: {
            repository: {
              issueOrPullRequest: {
                __typename: 'Issue',
                number: 41,
                title: 't',
                body: '',
                state,
                stateReason,
                url: 'https://github.com/acme/shop/issues/41',
                updatedAt: '2026-10-01T10:00:00Z',
                author: null,
                labels: null,
                comments: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] },
              },
            },
          },
        }),
      )
    const gh = fakeGh([])
    const statuses = await withProvider(gh.settings, (provider) =>
      Effect.forEach(
        [
          ['OPEN', 'REOPENED'],
          ['CLOSED', 'COMPLETED'],
          ['CLOSED', 'NOT_PLANNED'],
          ['CLOSED', null],
        ] as const,
        ([state, why]) =>
          Effect.suspend(() => {
            gh.answer([{ when: ['graphql'], stdout: answer(state, why) }])
            return Effect.map(provider.read(reference('acme/shop#41')), (one) => one.status.wording)
          }),
      ),
    )
    expect(statuses).toEqual(['open', 'closed · completed', 'closed · not planned', 'closed'])
  })

  test('a pull request number given as an issue is refused in a sentence', async () => {
    const gh = fakeGh([
      {
        when: ['graphql'],
        stdout: included(
          JSON.stringify({
            data: { repository: { issueOrPullRequest: { __typename: 'PullRequest' } } },
          }),
        ),
      },
    ])
    const failed = await withProvider(gh.settings, (provider) =>
      Effect.flip(provider.read(reference('acme/shop#41'))),
    )
    expect(failed).toBeInstanceOf(TicketUnreadable)
    expect(failed.message).toBe('acme/shop#41 is a pull request, not an issue.')
  })

  test('not found, not logged in and rate limited are their own errors', async () => {
    const gh = fakeGh([])
    const [missing, signedOut, limited] = await withProvider(gh.settings, (provider) =>
      Effect.forEach(
        [
          {
            when: ['graphql'],
            stdout: included(
              JSON.stringify({
                data: { repository: null },
                errors: [
                  {
                    type: 'NOT_FOUND',
                    message: "Could not resolve to a Repository with the name 'acme/shop'.",
                  },
                ],
              }),
            ),
            stderr: "gh: Could not resolve to a Repository with the name 'acme/shop'.\n",
            code: 1,
          },
          {
            when: ['graphql'],
            stderr: 'To get started with GitHub CLI, please run:  gh auth login\n',
            code: 4,
          },
          {
            when: ['graphql'],
            stdout: included(
              JSON.stringify({
                errors: [{ type: 'RATE_LIMITED', message: 'API rate limit exceeded for user.' }],
              }),
              'HTTP/2.0 200 OK',
              { 'X-Ratelimit-Remaining': '0', 'X-Ratelimit-Reset': '1791367200' },
            ),
            code: 1,
          },
        ] satisfies ReadonlyArray<GhRule>,
        (rule) =>
          Effect.suspend(() => {
            gh.answer([rule])
            return Effect.flip(provider.read(reference('acme/shop#41')))
          }),
      ),
    )
    expect(missing).toBeInstanceOf(TicketNotFound)
    expect(missing?.message).toContain(
      "Could not resolve to a Repository with the name 'acme/shop'.",
    )
    expect(signedOut).toBeInstanceOf(ProviderNotAuthenticated)
    expect(
      signedOut !== undefined && Predicate.isTagged(signedOut, 'ProviderNotAuthenticated')
        ? signedOut.fix
        : null,
    ).toBe('gh auth login --hostname github.com')
    expect(
      limited !== undefined && Predicate.isTagged(limited, 'ProviderLimited')
        ? limited.resetAt
        : null,
    ).toBe(new Date(1_791_367_200_000).toISOString())
  })

  test('an error message holding a known secret value is masked', async () => {
    const secrets = secretsRegistry()
    secrets.register('project-variables:acme', ['acme-deploy-value-7731'])
    const gh = fakeGh([
      {
        when: ['graphql'],
        stderr: 'error connecting to api.github.com: proxy acme-deploy-value-7731 refused\n',
        code: 1,
      },
    ])
    const failed = await withProvider(
      gh.settings,
      (provider) => Effect.flip(provider.read(reference('acme/shop#41'))),
      ACME,
      secrets,
    )
    expect(failed).toBeInstanceOf(ProviderUnreachable)
    expect(failed.message).not.toContain('acme-deploy-value-7731')
    expect(failed.message).toContain('•••')
  })
})

describe('search: the provider’s repositories, up to 20 hits', () => {
  test('hits carry their key, canonical reference, status and update date', async () => {
    const gh = fakeGh([
      {
        when: ['search/issues'],
        stdout: included(
          JSON.stringify({
            total_count: 2,
            incomplete_results: false,
            items: [
              {
                number: 41,
                title: 'Export notes as Markdown',
                html_url: 'https://github.com/acme/shop/issues/41',
                state: 'open',
                updated_at: '2026-10-01T10:00:00Z',
                repository_url: 'https://api.github.com/repos/Acme/Shop',
              },
              {
                number: 7,
                title: 'Export fails on empty notes',
                html_url: 'https://github.com/acme/api/issues/7',
                state: 'closed',
                updated_at: '2026-09-30T08:00:00Z',
                repository_url: 'https://api.github.com/repos/acme/api',
              },
            ],
          }),
        ),
      },
    ])
    const hits = await withProvider(gh.settings, (provider) => provider.search('export'))
    expect(hits).toEqual([
      {
        provider: 'github',
        reference: GithubIssue.make({
          host: 'github.com',
          owner: 'acme',
          repo: 'shop',
          number: 41,
        }),
        canonical: 'github:github.com/acme/shop#41',
        key: 'acme/shop#41',
        title: 'Export notes as Markdown',
        url: 'https://github.com/acme/shop/issues/41',
        status: { state: 'open', wording: 'open' },
        updatedAt: '2026-10-01T10:00:00Z',
      },
      {
        provider: 'github',
        reference: GithubIssue.make({ host: 'github.com', owner: 'acme', repo: 'api', number: 7 }),
        canonical: 'github:github.com/acme/api#7',
        key: 'acme/api#7',
        title: 'Export fails on empty notes',
        url: 'https://github.com/acme/api/issues/7',
        status: { state: 'closed', wording: 'closed' },
        updatedAt: '2026-09-30T08:00:00Z',
      },
    ])
  })

  test('a search rate limit is ProviderLimited with its reset, not unreachable', async () => {
    const reset = Math.floor(Date.now() / 1000) + 600
    const gh = fakeGh([
      {
        when: ['search/issues'],
        stdout: included(
          JSON.stringify({
            message: 'API rate limit exceeded for user ID 1.',
            documentation_url: 'https://docs.github.com/rest',
          }),
          'HTTP/2.0 403 Forbidden',
          { 'X-Ratelimit-Remaining': '0', 'X-Ratelimit-Reset': String(reset) },
        ),
        stderr: 'gh: API rate limit exceeded for user ID 1. (HTTP 403)\n',
        code: 1,
      },
      {
        when: ['search', 'issues'],
        stderr:
          'HTTP 403: API rate limit exceeded for user ID 1. (https://api.github.com/search/issues)\n',
        code: 1,
      },
    ])
    const failed = await withProvider(gh.settings, (provider) =>
      Effect.flip(provider.search('export')),
    )
    expect(failed).toBeInstanceOf(ProviderLimited)
    expect(failed).toMatchObject({ resetAt: new Date(reset * 1000).toISOString() })
  })

  test('a provider that watches no repository searches nothing', async () => {
    const gh = fakeGh([])
    const hits = await withProvider(gh.settings, (provider) => provider.search('export'), {
      host: 'github.com',
      repositories: [],
    })
    expect(hits).toEqual([])
    expect(gh.calls()).toEqual([])
  })
})

describe('changedSince: one grouped query per host, at most 50 issues each', () => {
  const known = (count: number) =>
    Array.from({ length: count }, (_, index) => ({
      reference: GithubIssue.make({
        host: 'github.com',
        owner: 'acme',
        repo: 'shop',
        number: index + 1,
      }),
      updatedAt: index === 0 ? '2026-10-01T10:00:00Z' : '2026-09-01T10:00:00Z',
    }))

  test('50 refs are one request, 51 are two; a moved date is Moved, a lost issue Missing', async () => {
    const gh = fakeGh([
      { when: ['graphql'], aliasesUpdatedAt: '2026-10-01T10:00:00Z', missing: ['i1'] },
    ])
    const [fifty, fiftyOne] = await withProvider(gh.settings, (provider) =>
      Effect.gen(function* () {
        const first = yield* provider.changedSince(known(50))
        const calls = gh.calls().length
        const second = yield* provider.changedSince(known(51))
        return [
          { changes: first, calls },
          { changes: second, calls: gh.calls().length - calls },
        ]
      }),
    )
    expect(fifty.calls).toBe(1)
    expect(fiftyOne.calls).toBe(2)
    // #1 did not move; #2 is missing; every other one moved.
    expect(fifty.changes.filter((one) => Predicate.isTagged(one, 'Moved'))).toHaveLength(48)
    expect(
      fifty.changes.filter((one) => Predicate.isTagged(one, 'Missing')).map((one) => one.reference),
    ).toEqual(['github:github.com/acme/shop#2'])
    // The second request holds #51 alone, as its alias i0: it moved.
    expect(fiftyOne.changes.filter((one) => Predicate.isTagged(one, 'Moved'))).toHaveLength(49)
    const [query] = gh.calls()
    expect(query?.args.filter((arg) => /^n\d+=/.test(arg))).toHaveLength(50)
    expect(query?.args.find((arg) => arg.startsWith('query='))).toContain('updatedAt')
  })
})
