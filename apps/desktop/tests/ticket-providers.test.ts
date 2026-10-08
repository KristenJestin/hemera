/**
 * A Project's ticket providers and its Spec mode (#95): a GitHub provider added from the user's
 * choice (the repositories whose remote points to its host are proposed, nothing is recorded by
 * itself), checked and kept in lower case, once per host; the Spec mode `local` by default; the
 * settings followed as they change; and a provider removed while a creation from its ticket was
 * reading it leaves the mission linked to no provider rather than failing.
 */

import { mkdirSync, realpathSync } from 'node:fs'
import { join } from 'node:path'

import { GithubIssue } from '@hemera/core/domain'
import { InvalidProviderConfig, type TicketsSettings } from '@hemera/ipc'
import { Effect, Exit, Fiber, Stream } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { readEvents } from '../src/engine/journal.ts'
import { createMission } from '../src/engine/missions.ts'
import { createProject } from '../src/engine/projects.ts'
import { missionTicket, readForCreation } from '../src/engine/tickets/link.ts'
import {
  addGithub,
  proposeGithub,
  providersOf,
  removeProvider,
  setSpecMode,
  specModeOf,
  ticketsChanges,
  updateProvider,
} from '../src/engine/tickets/store.ts'
import { commandsEngine, until } from './commands-engine.ts'
import { fakeGh, included } from './fake-gh.ts'
import { git, repository } from './repositories.ts'
import { removeFolders, temporaryFolder } from './storage.ts'

let data: string
let work: string
beforeEach(() => {
  data = realpathSync.native(temporaryFolder('ticket-providers'))
  work = realpathSync.native(temporaryFolder('ticket-providers-work'))
})
afterEach(removeFolders)

/** Acme: `api` on github.com, `web` on an Enterprise host, `shared` with no remote. */
const acme = Effect.gen(function* () {
  const main = join(work, 'acme')
  mkdirSync(main, { recursive: true })
  git(repository(join(main, 'api')), 'remote', 'add', 'origin', 'https://github.com/Acme/API.git')
  git(repository(join(main, 'web')), 'remote', 'add', 'origin', 'git@git.acme.test:acme/web.git')
  repository(join(main, 'shared'))
  return yield* createProject({
    name: 'Acme',
    mainCheckout: main,
    repositories: ['api', 'web', 'shared'],
  })
})

const engine = () => commandsEngine(data, { gh: fakeGh([]).settings })

describe('A GitHub provider is added from the user’s choice', () => {
  test('the repositories whose remote points to the host are proposed, and nothing is recorded', async () => {
    const [github, enterprise, recorded] = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const project = yield* acme
          return [
            yield* proposeGithub(project.id, 'github.com'),
            yield* proposeGithub(project.id, 'git.acme.test'),
            yield* providersOf(project.id),
          ] as const
        }),
      ),
    )
    expect(github).toEqual(['acme/api'])
    expect(enterprise).toEqual(['acme/web'])
    expect(recorded).toEqual([])
  })

  test('a provider is kept in lower case, in the order added; a wrong host or repository is refused in words', async () => {
    const [listed, badHost, badRepo, updated] = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const project = yield* acme
          yield* addGithub(project.id, {
            host: 'GitHub.com',
            repositories: ['Acme/API', 'acme/api'],
          })
          const enterprise = yield* addGithub(project.id, {
            host: 'git.acme.test',
            repositories: [],
          })
          return [
            yield* providersOf(project.id),
            yield* Effect.flip(addGithub(project.id, { host: 'not a host', repositories: [] })),
            yield* Effect.flip(
              addGithub(project.id, { host: 'ghe.acme.test', repositories: ['web'] }),
            ),
            yield* updateProvider(enterprise.id, {
              host: 'git.acme.test',
              repositories: ['acme/web'],
            }),
          ] as const
        }),
      ),
    )
    expect(listed.map((one) => [one.kind, one.host, one.repositories])).toEqual([
      ['github', 'github.com', ['acme/api']],
      ['github', 'git.acme.test', []],
    ])
    expect(badHost).toBeInstanceOf(InvalidProviderConfig)
    expect(badHost.message).toBe('This provider cannot be saved: not a host is not a host name.')
    expect(badRepo.message).toBe('This provider cannot be saved: web is not an owner/repo name.')
    expect(updated.repositories).toEqual(['acme/web'])
  })

  test('two adds of one host at once give one provider and one refusal', async () => {
    const [outcomes, listed] = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const project = yield* acme
          const asked = addGithub(project.id, { host: 'github.com', repositories: ['acme/api'] })
          const both = yield* Effect.all([Effect.exit(asked), Effect.exit(asked)], {
            concurrency: 2,
          })
          return [both, yield* providersOf(project.id)] as const
        }),
      ),
    )
    expect(outcomes.filter((one) => Exit.isSuccess(one))).toHaveLength(1)
    expect(listed).toHaveLength(1)
  })
})

describe('The Spec mode', () => {
  test('local by default; linked once set, with its event', async () => {
    const [before, after, events] = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const project = yield* acme
          const first = yield* specModeOf(project.id)
          yield* setSpecMode(project.id, 'linked')
          const page = yield* readEvents({ entity: { kind: 'project', id: project.id } })
          return [first, yield* specModeOf(project.id), page.events.map((one) => one.type)] as const
        }),
      ),
    )
    expect(before).toBe('local')
    expect(after).toBe('linked')
    expect(events).toContain('tickets.spec_mode_set')
  })
})

describe('The settings are followed as they change', () => {
  test('the providers and the mode now, then again after a provider is added', async () => {
    const seen = await engine()(({ profile }) =>
      Effect.gen(function* () {
        const project = yield* profile.use(acme)
        const received: TicketsSettings[] = []
        const following = yield* profile.follow(ticketsChanges(project.id)).pipe(
          Stream.take(2),
          Stream.runForEach((one) => Effect.sync(() => received.push(one))),
          Effect.forkChild,
        )
        yield* until(
          Effect.sync(() => received.length),
          (count) => count === 1,
        )
        yield* profile.use(addGithub(project.id, { host: 'github.com', repositories: [] }))
        yield* Fiber.join(following)
        return received
      }),
    )
    expect(seen.map((one) => [one.specMode, one.providers.length])).toEqual([
      ['local', 0],
      ['local', 1],
    ])
  })
})

describe('A provider removed while a creation was reading its ticket', () => {
  test('the mission is created, linked to no provider', async () => {
    const gh = fakeGh([
      {
        when: ['graphql'],
        stdout: included(
          JSON.stringify({
            data: {
              repository: {
                issueOrPullRequest: {
                  __typename: 'Issue',
                  number: 41,
                  title: 'Export notes',
                  body: '',
                  state: 'OPEN',
                  stateReason: null,
                  url: 'https://github.com/acme/api/issues/41',
                  updatedAt: '2026-10-01T10:00:00Z',
                  author: null,
                  labels: null,
                  comments: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] },
                },
              },
            },
          }),
        ),
      },
    ])
    const linked = await commandsEngine(data, { gh: gh.settings })(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const project = yield* acme
          const provider = yield* addGithub(project.id, {
            host: 'github.com',
            repositories: ['acme/api'],
          })
          const reference = GithubIssue.make({
            host: 'github.com',
            owner: 'acme',
            repo: 'api',
            number: 41,
          })
          const link = yield* readForCreation(project.id, reference)
          yield* removeProvider(provider.id)
          const mission = yield* createMission(
            { projectId: project.id, idea: { sentence: null, ticket: 'acme/api#41' } },
            { reference, ticket: link },
          )
          return yield* missionTicket(mission.id)
        }),
      ),
    )
    expect(linked?.providerId).toBeNull()
    expect(linked?.base?.title).toBe('Export notes')
  })
})
