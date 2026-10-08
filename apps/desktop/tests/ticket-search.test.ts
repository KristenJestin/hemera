/**
 * The field's remote search over a Project's real providers (#95): every provider runs at once,
 * each one's failure is an element of the merged stream and never its end, an interrupted search
 * ends every provider's `gh`, two searches at once each get their own answers, and a reference is
 * read, only by the providers it can belong to.
 *
 * Two GitHub providers (github.com and an Enterprise host) share one fake `gh`, whose rules answer
 * by host; no test reaches GitHub.
 */

import { mkdirSync, realpathSync } from 'node:fs'
import { join } from 'node:path'

import { type StartResult, SearchNotice } from '@hemera/ipc'
import { Effect, Fiber, Predicate, Stream } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { createProject } from '../src/engine/projects.ts'
import { createStart, searchStart } from '../src/engine/start/field.ts'
import { addGithub } from '../src/engine/tickets/store.ts'
import { commandsEngine, until } from './commands-engine.ts'
import { type FakeGh, type GhRule, fakeGh, included } from './fake-gh.ts'
import { repository } from './repositories.ts'
import { removeFolders, temporaryFolder } from './storage.ts'

let data: string
let work: string
beforeEach(() => {
  data = realpathSync.native(temporaryFolder('ticket-search'))
  work = realpathSync.native(temporaryFolder('ticket-search-work'))
})
afterEach(removeFolders)

const ENTERPRISE = 'git.acme.test'

/** Acme, with a github.com provider on `acme/shop` and an Enterprise one on `acme/api`. */
const acme = Effect.gen(function* () {
  const main = join(work, 'acme')
  mkdirSync(main, { recursive: true })
  repository(join(main, 'api'))
  const project = yield* createProject({ name: 'Acme', mainCheckout: main, repositories: ['api'] })
  yield* addGithub(project.id, { host: 'github.com', repositories: ['acme/shop'] })
  yield* addGithub(project.id, { host: ENTERPRISE, repositories: ['acme/api'] })
  return project
})

/** A `gh api search/issues --include` answer: GitHub's REST search, issues of one repository. */
const hits = (host: string, repo: string, titles: ReadonlyArray<string>) =>
  included(
    JSON.stringify({
      total_count: titles.length,
      incomplete_results: false,
      items: titles.map((title, index) => ({
        number: index + 1,
        title,
        html_url: `https://${host}/${repo}/issues/${String(index + 1)}`,
        state: 'open',
        updated_at: '2026-10-01T10:00:00Z',
        repository_url: `https://api.${host}/repos/${repo}`,
      })),
    }),
  )

const search = (projectId: string, text: string) =>
  Stream.runCollect(searchStart(projectId, text)).pipe(Effect.map((all) => [...all]))

const titlesOf = (results: ReadonlyArray<StartResult>) =>
  results.flatMap((result) => (Predicate.isTagged(result, 'TicketFound') ? [result.hit.title] : []))

const noticesOf = (results: ReadonlyArray<StartResult>) =>
  results.flatMap((result) => (Predicate.isTagged(result, 'SearchNotice') ? [result.sentence] : []))

const engine = (gh: FakeGh) => commandsEngine(data, { gh: gh.settings })

describe('Every provider of the Project answers; a failure is a notice, not the end', () => {
  test('a provider failing while another answers: the other’s hits stay, the failure is said once', async () => {
    const gh = fakeGh([
      {
        host: 'github.com',
        when: ['search', 'issues', 'acme/shop'],
        stdout: hits('github.com', 'acme/shop', ['Export notes', 'Export fails']),
      },
      {
        host: ENTERPRISE,
        when: ['search', 'issues'],
        stderr: `error connecting to ${ENTERPRISE}\n`,
        code: 1,
      },
    ])
    const results = await engine(gh)(({ profile }) =>
      profile.use(Effect.flatMap(acme, (project) => search(project.id, 'export'))),
    )
    expect(titlesOf(results).toSorted()).toEqual(['Export fails', 'Export notes'])
    expect(noticesOf(results)).toEqual([
      `GitHub (${ENTERPRISE}) is unreachable: error connecting to ${ENTERPRISE}`,
    ])
    // Both providers were asked, each for its own repositories.
    expect(
      gh
        .calls()
        .map((call) => [call.env['GH_HOST'], call.args.find((arg) => arg.startsWith('q='))])
        .toSorted(),
    ).toEqual([
      [ENTERPRISE, 'q=export is:issue repo:acme/api'],
      ['github.com', 'q=export is:issue repo:acme/shop'],
    ])
  })

  test('providers run at once: one answers while the other hangs, and interrupting the search ends the hung gh', async () => {
    const gh = fakeGh([
      { host: 'github.com', when: ['search', 'issues'], hang: true },
      {
        host: ENTERPRISE,
        when: ['search', 'issues'],
        stdout: hits(ENTERPRISE, 'acme/api', ['Export the API']),
      },
    ])
    const [seen, hung] = await engine(gh)(({ profile }) =>
      Effect.gen(function* () {
        const project = yield* profile.use(acme)
        const results: StartResult[] = []
        const running = yield* profile.follow(searchStart(project.id, 'export')).pipe(
          Stream.runForEach((result) => Effect.sync(() => results.push(result))),
          Effect.forkChild,
        )
        // The Enterprise hit arrives while github.com's gh is still running.
        const arrived = yield* until(
          Effect.sync(() => [...results]),
          (all) => titlesOf(all).length === 1,
        )
        const calls = yield* until(
          Effect.sync(() => gh.calls()),
          (all) => all.some((call) => call.env['GH_HOST'] === 'github.com'),
        )
        yield* Fiber.interrupt(running)
        return [arrived, calls.find((call) => call.env['GH_HOST'] === 'github.com')] as const
      }),
    )
    expect(titlesOf(seen)).toEqual(['Export the API'])
    // The interruption returned once the hung gh had ended.
    expect(hung).toBeDefined()
    expect(() => process.kill(hung?.pid ?? 0, 0)).toThrow()
  })

  test('two searches at once each get their own answers', async () => {
    const answer = (text: string, title: string): GhRule => ({
      host: 'github.com',
      when: ['search', 'issues', text],
      stdout: hits('github.com', 'acme/shop', [title]),
    })
    const gh = fakeGh([
      answer('export', 'Export notes'),
      answer('login', 'Fix the login form'),
      { host: ENTERPRISE, when: ['search', 'issues'], stdout: hits(ENTERPRISE, 'acme/api', []) },
    ])
    const [exports, logins] = await engine(gh)(({ profile }) =>
      profile.use(
        Effect.flatMap(acme, (project) =>
          Effect.all([search(project.id, 'export'), search(project.id, 'login')], {
            concurrency: 2,
          }),
        ),
      ),
    )
    expect(titlesOf(exports)).toEqual(['Export notes'])
    expect(titlesOf(logins)).toEqual(['Fix the login form'])
    expect(gh.calls()).toHaveLength(4)
  })
})

describe('A reference is read, only by the providers it can belong to', () => {
  const issue = (host: string, repo: string, title: string) =>
    included(
      JSON.stringify({
        data: {
          repository: {
            issueOrPullRequest: {
              __typename: 'Issue',
              number: 7,
              title,
              body: '',
              state: 'OPEN',
              stateReason: null,
              url: `https://${host}/${repo}/issues/7`,
              updatedAt: '2026-10-01T10:00:00Z',
              author: { login: 'ada' },
              labels: { nodes: [] },
              comments: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] },
            },
          },
        },
      }),
    )

  test('an Enterprise URL is read by the Enterprise provider alone, a short form by the host that lists it', async () => {
    const gh = fakeGh([
      {
        host: ENTERPRISE,
        when: ['graphql'],
        stdout: issue(ENTERPRISE, 'acme/api', 'Export the API'),
      },
      {
        host: 'github.com',
        when: ['graphql'],
        stdout: issue('github.com', 'acme/web', 'Web export'),
      },
    ])
    const [byUrl, byShort, elsewhere] = await engine(gh)(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const project = yield* acme
          const url = yield* search(project.id, `https://${ENTERPRISE}/acme/api/issues/7`)
          const urlCalls = gh.calls().length
          const short = yield* search(project.id, 'acme/api#7')
          const other = yield* search(project.id, 'acme/web#7')
          return [{ url, urlCalls }, short, other] as const
        }),
      ),
    )
    expect(titlesOf(byUrl.url)).toEqual(['Export the API'])
    expect(byUrl.urlCalls).toBe(1)
    // acme/api is listed by the Enterprise provider: its short form is that host's.
    expect(titlesOf(byShort)).toEqual(['Export the API'])
    // acme/web is listed by none: it is github.com's.
    expect(titlesOf(elsewhere)).toEqual(['Web export'])
    expect(gh.calls().map((call) => call.env['GH_HOST'])).toEqual([
      ENTERPRISE,
      ENTERPRISE,
      'github.com',
    ])
  })

  test('a reference no provider of the Project reads says so, and creates from the text', async () => {
    const gh = fakeGh([])
    const [results, created] = await engine(gh)(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const project = yield* acme
          return [
            yield* search(project.id, 'SHOP-7'),
            yield* createStart({ projectId: project.id, text: 'SHOP-7', idempotencyKey: 'one' }),
          ] as const
        }),
      ),
    )
    expect(results).toContainEqual(
      SearchNotice.make({ sentence: 'No ticket provider of this Project reads SHOP-7.' }),
    )
    expect(created.ticketLink).toBeNull()
    expect(gh.calls()).toEqual([])
  })
})
