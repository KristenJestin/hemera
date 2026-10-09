/**
 * The providers' one write (#98): a remote Spec as a ticket's whole description. GitHub through
 * the user's `gh` (`gh api --method PATCH`, the body on the standard input, never in an argument),
 * Jira Cloud through REST v3 (ADF) and Data Center through REST v2 (wiki markup). Each reads the
 * ticket again first and sends nothing when it moved since the fingerprint expected, never sends a
 * text longer than the tracker takes, and answers the ticket read back.
 *
 * `gh` is the fake script of `fake-gh.ts`, Jira the local fake of `fake-jira.ts`: no test reaches
 * a real tracker or signs in anywhere.
 */

import { mkdirSync, realpathSync } from 'node:fs'
import { join } from 'node:path'

import {
  REMOTE_SPEC_LIMITS,
  SPEC_SECTIONS,
  type SpecText,
  TicketForbidden,
  TicketMoved,
  type TicketReference,
  TicketTooLong,
  parseTicketReference,
  readSections,
  renderRemoteSpec,
} from '@hemera/core/domain'
import { Effect, Exit, Option, Predicate } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { createProject } from '../src/engine/projects.ts'
import { secretsRegistry } from '../src/engine/secrets.ts'
import { githubProvider } from '../src/engine/tickets/github.ts'
import { descriptionFingerprint } from '../src/engine/tickets/provider.ts'
import { saveJiraToken } from '../src/engine/tickets/jira-tokens.ts'
import { providerOf } from '../src/engine/tickets/search.ts'
import { addJira } from '../src/engine/tickets/store.ts'
import { commandsEngine } from './commands-engine.ts'
import { type GhRule, fakeGh, included } from './fake-gh.ts'
import { type FakeIssue, type FakeJira, type JiraRule, adf, fakeJira } from './fake-jira.ts'
import { repository } from './repositories.ts'
import { removeFolders, temporaryFolder } from './storage.ts'

let data: string
let work: string
const servers: FakeJira[] = []
beforeEach(() => {
  data = realpathSync.native(temporaryFolder('remote-spec-providers'))
  work = realpathSync.native(temporaryFolder('remote-spec-providers-work'))
})
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()))
  removeFolders()
})

const reference = (text: string): TicketReference => {
  const parsed = parseTicketReference(text)
  if (parsed === null) throw new Error(`${text} is not a reference`)
  return parsed
}

/** A Spec of Acme's, its sections written, one requirement with a scenario. */
const SPEC: SpecText = {
  key: 'ACME-12',
  title: 'Export the invoices as CSV',
  type: 'feature',
  language: 'en',
  version: 4,
  sections: SPEC_SECTIONS.map((name) => ({ name, body: `The ${name}.`, version: 1 })),
  requirements: [
    {
      id: 'R1',
      domain: 'invoices',
      delta: 'added',
      livingRef: null,
      livingVersion: null,
      text: 'Invoices export as CSV.',
      version: 1,
      removed: false,
      scenarios: [
        {
          id: 'R1.S1',
          when: 'the user exports the invoices',
          then: 'a CSV file is saved',
          version: 1,
          proof: null,
          proofVersion: 0,
        },
      ],
    },
  ],
  tasks: [],
  tasksVersion: 0,
  recommendation: null,
}

/** What a write failed with, or null when it did not fail. */
const failed = <A, E>(exit: Exit.Exit<A, E>): E | null =>
  Option.getOrNull(Exit.findErrorOption(exit))

// --- GitHub ---------------------------------------------------------------------------------------

const ISSUE_BODY = '## Why\nExports are slow.\n'

const issue = (body: string, updatedAt: string) =>
  included(
    JSON.stringify({
      data: {
        repository: {
          issueOrPullRequest: {
            __typename: 'Issue',
            number: 41,
            title: 'Export notes as Markdown',
            body,
            state: 'OPEN',
            stateReason: null,
            url: 'https://github.com/acme/shop/issues/41',
            updatedAt,
            author: { login: 'ada' },
            labels: { nodes: [] },
            comments: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] },
          },
        },
      },
    }),
  )

/**
 * A program on a GitHub provider over a fake `gh`: the issue answers its first body twice (the
 * test's own read, then the write's read again), then the rules given.
 */
const withGithub = <A, E>(
  rules: ReadonlyArray<GhRule>,
  program: (
    provider: Effect.Success<ReturnType<typeof githubProvider>>,
    expected: { fingerprint: string },
  ) => Effect.Effect<A, E>,
) => {
  const gh = fakeGh([
    { when: ['graphql'], stdout: issue(ISSUE_BODY, '2026-10-01T10:00:00Z'), times: 2 },
    ...rules,
  ])
  const run = commandsEngine(data, { gh: gh.settings, secrets: secretsRegistry() })(({ profile }) =>
    profile.use(
      Effect.gen(function* () {
        const provider = yield* githubProvider({ host: 'github.com', repositories: ['acme/shop'] })
        const known = yield* provider.read(reference('acme/shop#41'))
        return yield* Effect.exit(
          program(provider, { fingerprint: descriptionFingerprint(known.description) }),
        )
      }),
    ),
  )
  return { gh, run }
}

describe('GitHub: the body goes on the standard input of gh api, never in an argument', () => {
  test('it reads the issue again, sends the Spec as the JSON body on stdin, and answers it read back', async () => {
    const text = renderRemoteSpec(SPEC, 'markdown')
    const { gh, run } = withGithub(
      [
        { when: ['PATCH'], stdout: included('{"number":41}') },
        { when: ['graphql'], stdout: issue(text, '2026-10-01T10:05:00Z') },
      ],
      (provider, expected) => provider.write(reference('acme/shop#41'), text, expected),
    )
    const exit = await run
    const calls = gh.calls()
    const patch = calls.find((call) => call.args.includes('PATCH'))
    expect(patch?.args).toEqual([
      'api',
      '--method',
      'PATCH',
      'repos/acme/shop/issues/41',
      '--hostname',
      'github.com',
      '--include',
      '--input',
      '-',
    ])
    expect(JSON.parse(patch?.stdin ?? '{}')).toEqual({ body: text })
    expect(calls.some((call) => call.args.some((arg) => arg.includes('The why.')))).toBe(false)
    // Read, read again before the write, write, read back.
    expect(calls.map((call) => (call.args.includes('PATCH') ? 'write' : 'read'))).toEqual([
      'read',
      'read',
      'write',
      'read',
    ])
    expect(Exit.isSuccess(exit) && exit.value.description).toBe(text)
    expect(
      Exit.isSuccess(exit) &&
        readSections(exit.value.description).sections.find((one) => one.section === 'requirements')
          ?.scenarios,
    ).toEqual([{ when: 'the user exports the invoices', then: 'a CSV file is saved' }])
  })

  test('an issue that moved since the fingerprint expected: TicketMoved, and no PATCH at all', async () => {
    const { gh, run } = withGithub([], (provider, expected) =>
      provider.write(reference('acme/shop#41'), renderRemoteSpec(SPEC, 'markdown'), {
        fingerprint: `${expected.fingerprint}-old`,
      }),
    )
    const exit = await run
    expect(gh.calls().some((call) => call.args.includes('PATCH'))).toBe(false)
    const failure = failed(exit)
    expect(failure).toBeInstanceOf(TicketMoved)
  })

  test('a refused write (read access only) is TicketForbidden, with GitHub’s message', async () => {
    const { run } = withGithub(
      [
        {
          when: ['PATCH'],
          stdout: included(
            '{"message":"Must have admin rights to Repository."}',
            'HTTP/2.0 403 Forbidden',
          ),
          code: 1,
        },
      ],
      (provider, expected) =>
        provider.write(reference('acme/shop#41'), renderRemoteSpec(SPEC, 'markdown'), expected),
    )
    const exit = await run
    const failure = failed(exit)
    expect(failure).toBeInstanceOf(TicketForbidden)
    expect(failure?.message).toContain('admin rights')
  })

  test('GitHub refusing the body as too long (422): the sentence of a Spec too long, never “could not be read”', async () => {
    const { run } = withGithub(
      [
        {
          when: ['PATCH'],
          stdout: included(
            JSON.stringify({
              message: 'Validation Failed',
              errors: [
                {
                  resource: 'Issue',
                  code: 'custom',
                  field: 'body',
                  message: 'body is too long (maximum is 65536 characters)',
                },
              ],
            }),
            'HTTP/2.0 422 Unprocessable Entity',
          ),
          code: 1,
        },
      ],
      (provider, expected) =>
        provider.write(reference('acme/shop#41'), renderRemoteSpec(SPEC, 'markdown'), expected),
    )
    expect(failed(await run)?.message).toBe(
      "The Spec is too long for acme/shop#41's description (65536 characters at most): it stays in Hemera.",
    )
  })

  test('a text over 65,536 characters is TicketTooLong: nothing is read or sent', async () => {
    const long = 'x'.repeat(REMOTE_SPEC_LIMITS.github + 1)
    const { gh, run } = withGithub([], (provider, expected) =>
      provider.write(reference('acme/shop#41'), long, expected),
    )
    const exit = await run
    const failure = failed(exit)
    expect(failure).toBeInstanceOf(TicketTooLong)
    expect(failure?.message).toBe(
      "The Spec is too long for acme/shop#41's description (65536 characters at most): it stays in Hemera.",
    )
    // The one read is the test's own, before the write.
    expect(gh.calls()).toHaveLength(1)
  })
})

// --- Jira -----------------------------------------------------------------------------------------

const TOKEN = 'jira-test-token-4471c0de'
const EMAIL = 'ada@acme.test'
const seal = (token: string) => `sealed:${token}`
const open = (ciphertext: string) => Effect.succeed(ciphertext.slice('sealed:'.length))

const SHOP_7 = (deployment: 'cloud' | 'datacenter'): FakeIssue => ({
  key: 'SHOP-7',
  summary: 'Export notes as Markdown',
  description:
    deployment === 'cloud' ? adf('## Why', 'Exports are slow.') : 'h2. Why\nExports are slow.',
  status: { name: 'In review', category: 'indeterminate' },
  labels: [],
  reporter: 'Ada',
  updated: '2026-10-01T12:00:00.000+0200',
  comments: [],
})

const withJira = async <A, E>(
  deployment: 'cloud' | 'datacenter',
  program: (
    provider: Effect.Success<ReturnType<typeof providerOf>>,
    expected: { fingerprint: string },
  ) => Effect.Effect<A, E>,
  rules: ReadonlyArray<JiraRule> = [],
) => {
  const server = await fakeJira({
    deployment,
    email: EMAIL,
    token: TOKEN,
    issues: [SHOP_7(deployment)],
    rules,
  })
  servers.push(server)
  const exit = await commandsEngine(data, { jira: { open }, secrets: secretsRegistry() })(
    ({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const main = join(work, 'acme')
          mkdirSync(main, { recursive: true })
          repository(join(main, 'api'))
          const project = yield* createProject({
            name: 'Acme',
            mainCheckout: main,
            repositories: ['api'],
          })
          const info = yield* addJira(project.id, {
            site: server.site,
            deployment,
            email: deployment === 'cloud' ? EMAIL : null,
            projectKeys: ['SHOP'],
          })
          yield* saveJiraToken(info.id, seal(TOKEN), TOKEN)
          const provider = yield* providerOf(info)
          const known = yield* provider.read(reference('SHOP-7'))
          return yield* Effect.exit(
            program(provider, { fingerprint: descriptionFingerprint(known.description) }),
          )
        }),
      ),
  )
  return { server, exit }
}

describe('Jira: the description replaced, ADF on Cloud and wiki markup on Data Center', () => {
  test.each([
    ['cloud', 'adf', '/rest/api/3/issue/SHOP-7'],
    ['datacenter', 'wiki', '/rest/api/2/issue/SHOP-7'],
  ] as const)(
    '%s: PUT of the description only, then read back with every scenario',
    async (deployment, target, path) => {
      const text = renderRemoteSpec(SPEC, target)
      const { server, exit } = await withJira(deployment, (provider, expected) =>
        provider.write(reference('SHOP-7'), text, expected),
      )
      const puts = server.requests().filter((one) => one.method === 'PUT')
      expect(puts.map((one) => one.path)).toEqual([path])
      const sent = JSON.parse(puts[0]?.body ?? '{}')
      expect(Object.keys(sent.fields)).toEqual(['description'])
      expect(sent.fields.description).toEqual(target === 'adf' ? JSON.parse(text) : text)
      expect(Exit.isSuccess(exit)).toBe(true)
      const back = Exit.isSuccess(exit) ? exit.value : null
      expect(
        readSections(back?.description ?? '').sections.find((one) => one.section === 'requirements')
          ?.scenarios,
      ).toEqual([{ when: 'the user exports the invoices', then: 'a CSV file is saved' }])
      expect(back?.title).toBe('Export notes as Markdown')
    },
  )

  test('an issue that moved: TicketMoved, and no PUT at all', async () => {
    const { server, exit } = await withJira('cloud', (provider) =>
      provider.write(reference('SHOP-7'), renderRemoteSpec(SPEC, 'adf'), {
        fingerprint: 'another',
      }),
    )
    expect(server.requests().some((one) => one.method === 'PUT')).toBe(false)
    const failure = failed(exit)
    expect(failure !== null && Predicate.isTagged(failure, 'TicketMoved')).toBe(true)
  })

  test('Jira refusing the description as too long (400): the sentence of a Spec too long, never “could not be read”', async () => {
    const { exit } = await withJira(
      'cloud',
      (provider, expected) =>
        provider.write(reference('SHOP-7'), renderRemoteSpec(SPEC, 'adf'), expected),
      [
        {
          method: 'PUT',
          path: /\/issue\/SHOP-7$/,
          status: 400,
          body: JSON.stringify({
            errorMessages: [],
            errors: { description: 'The entered text is too long. It exceeds the allowed limit.' },
          }),
        },
      ],
    )
    expect(failed(exit)?.message).toBe(
      "The Spec is too long for SHOP-7's description (32767 characters at most): it stays in Hemera.",
    )
  })

  test('Jira refusing the description for another reason (400): a refusal in Jira’s words', async () => {
    const { exit } = await withJira(
      'cloud',
      (provider, expected) =>
        provider.write(reference('SHOP-7'), renderRemoteSpec(SPEC, 'adf'), expected),
      [
        {
          method: 'PUT',
          path: /\/issue\/SHOP-7$/,
          status: 400,
          body: JSON.stringify({
            errorMessages: [],
            errors: { description: 'Field cannot be set. It is not on the appropriate screen.' },
          }),
        },
      ],
    )
    const failure = failed(exit)
    expect(failure?.message).toBe(
      'SHOP-7 refused the Spec as its description: Field cannot be set. It is not on the appropriate screen.',
    )
    expect(failure?.message).not.toContain('could not be read')
  })

  test('a description over 32,767 characters is TicketTooLong: nothing is sent', async () => {
    const long: SpecText = {
      ...SPEC,
      sections: SPEC_SECTIONS.map((name) => ({
        name,
        body: name === 'why' ? 'x'.repeat(REMOTE_SPEC_LIMITS.jira) : '',
        version: 1,
      })),
    }
    const { server, exit } = await withJira('cloud', (provider, expected) =>
      provider.write(reference('SHOP-7'), renderRemoteSpec(long, 'adf'), expected),
    )
    expect(server.requests().some((one) => one.method === 'PUT')).toBe(false)
    const failure = failed(exit)
    expect(failure?.message).toBe(
      "The Spec is too long for SHOP-7's description (32767 characters at most): it stays in Hemera.",
    )
  })
})
