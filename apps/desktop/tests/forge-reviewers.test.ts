/**
 * Who can review a Project's pull requests, as the Reviewers dialog of the delivery rules asks the
 * forge for it when it opens (#502): the people with access to the repository and its teams, read
 * with `gh api`, once per asking; the trouble of a command line that cannot be asked, with its
 * fixing command, and nothing run; a forge's refusal in its own words; and a forge Hemera cannot
 * list on, said so.
 *
 * The CLIs are the fakes of `fake-forge.ts`, first and alone on a `PATH` of their own: no test runs
 * a real `gh` or `bkt`, and none reaches a forge.
 */

import { mkdirSync, realpathSync } from 'node:fs'
import { join } from 'node:path'

import { Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { listReviewers } from '../src/engine/forges/reviewers.ts'
import type { EngineServices } from '../src/engine/profile.ts'
import { createProject } from '../src/engine/projects.ts'
import { commandsEngine } from './commands-engine.ts'
import { type FakeForge, type FakeRule, fakeForge, ghReady, ghSignedOut } from './fake-forge.ts'
import { git } from './repositories.ts'
import { removeFolders, temporaryFolder } from './storage.ts'

let data: string
let work: string
beforeEach(() => {
  data = realpathSync.native(temporaryFolder('forge-reviewers'))
  work = realpathSync.native(temporaryFolder('forge-reviewers-work'))
})
afterEach(removeFolders)

/** Acme's main checkout, a repository per remote URL, each named by its key. */
const checkout = (remotes: Readonly<Record<string, string>>) => {
  const main = join(work, 'acme')
  for (const [path, url] of Object.entries(remotes)) {
    const folder = join(main, path)
    mkdirSync(folder, { recursive: true })
    git(folder, 'init', '-q', '-b', 'main')
    git(folder, 'commit', '-q', '--allow-empty', '-m', 'base')
    git(folder, 'remote', 'add', 'origin', url)
  }
  return main
}

const ON_GITHUB = { api: 'git@github.com:acme/api.git', web: 'git@github.com:acme/web.git' }

/** The engine over these fakes, with Acme made of the repositories given. */
const withAcme = <A, E>(
  fake: FakeForge,
  program: (projectId: string) => Effect.Effect<A, E, EngineServices>,
  remotes: Readonly<Record<string, string>> = ON_GITHUB,
) => {
  const main = checkout(remotes)
  return commandsEngine(data, { forge: { env: fake.env } })(({ profile }) =>
    profile.use(
      Effect.gen(function* () {
        const project = yield* createProject({
          name: 'Acme',
          mainCheckout: main,
          repositories: Object.keys(remotes),
        })
        return yield* program(project.id)
      }),
    ),
  )
}

/** api's collaborators and teams, as the GitHub API answers them. */
const LISTED: ReadonlyArray<FakeRule> = [
  {
    cli: 'gh',
    when: ['api', 'repos/acme/api/collaborators'],
    stdout: JSON.stringify([
      { login: 'mokafor', type: 'User' },
      { login: 'tlindqvist', type: 'User' },
    ]),
  },
  {
    cli: 'gh',
    when: ['api', 'repos/acme/api/teams'],
    stdout: JSON.stringify([{ slug: 'platform', name: 'Platform' }]),
  },
]

const asked = (fake: FakeForge, word: string) =>
  fake.calls().filter((call) => call.args.some((arg) => arg.includes(word))).length

describe('Adding a reviewer, listed', () => {
  test('the forge is read once per asking: the teams, then the people with access', async () => {
    const fake = fakeForge([...LISTED, ...ghReady()])
    const answer = await withAcme(fake, (projectId) => listReviewers(projectId))
    expect(answer).toEqual({
      kind: 'listed',
      reviewers: [
        { handle: 'acme/platform', name: 'Platform' },
        { handle: 'mokafor', name: null },
        { handle: 'tlindqvist', name: null },
      ],
    })
    expect(asked(fake, '/collaborators')).toBe(1)
    expect(asked(fake, '/teams')).toBe(1)
    // The first repository on a forge answers for the Project: web is never asked.
    expect(asked(fake, 'repos/acme/web')).toBe(0)
  })

  test('two askings read the forge twice: nothing is kept between dialog openings', async () => {
    const fake = fakeForge([...LISTED, ...ghReady()])
    await withAcme(fake, (projectId) =>
      Effect.gen(function* () {
        yield* listReviewers(projectId)
        yield* listReviewers(projectId)
      }),
    )
    expect(asked(fake, '/collaborators')).toBe(2)
  })

  test('a command line that cannot be asked says its trouble and its command, and nothing is run', async () => {
    const fake = fakeForge(ghSignedOut())
    const answer = await withAcme(fake, (projectId) => listReviewers(projectId))
    expect(answer).toEqual({
      kind: 'cannot',
      sentence:
        'gh is signed out of github.com: Hemera cannot list who reviews. A handle typed below is added as it is.',
      fix: 'gh auth login --hostname github.com',
    })
    expect(asked(fake, '/collaborators')).toBe(0)
  })

  test('a forge that refuses the list says it in its own words', async () => {
    const fake = fakeForge([
      {
        cli: 'gh',
        when: ['api', '/collaborators'],
        stderr: 'gh: Must have push access to view repository collaborators. (HTTP 403)\n',
        code: 1,
      },
      ...ghReady(),
    ])
    const answer = await withAcme(fake, (projectId) => listReviewers(projectId))
    expect(answer).toMatchObject({ kind: 'cannot', fix: null })
    expect(answer.kind === 'cannot' ? answer.sentence : '').toContain(
      'Must have push access to view repository collaborators',
    )
  })

  test('a repository without teams lists its people', async () => {
    const fake = fakeForge([
      { cli: 'gh', when: ['api', '/teams'], stderr: 'gh: Not Found (HTTP 404)\n', code: 1 },
      ...LISTED,
      ...ghReady(),
    ])
    const answer = await withAcme(fake, (projectId) => listReviewers(projectId))
    expect(answer).toEqual({
      kind: 'listed',
      reviewers: [
        { handle: 'mokafor', name: null },
        { handle: 'tlindqvist', name: null },
      ],
    })
  })

  test('on Bitbucket, Hemera cannot list who reviews, and runs nothing for it', async () => {
    const fake = fakeForge([])
    const answer = await withAcme(fake, (projectId) => listReviewers(projectId), {
      api: 'https://bitbucket.org/acme-team/api.git',
    })
    expect(answer).toEqual({
      kind: 'cannot',
      sentence:
        'Hemera cannot list who reviews on Bitbucket Cloud. A handle typed below is added as it is.',
      fix: null,
    })
    expect(fake.calls().filter((call) => call.args.includes('api'))).toEqual([])
  })

  test('a Project with no repository on a forge says so', async () => {
    const fake = fakeForge([])
    const answer = await withAcme(fake, (projectId) => listReviewers(projectId), {
      api: 'https://git.acme.test/acme/api.git',
    })
    expect(answer).toEqual({
      kind: 'cannot',
      sentence:
        'No repository of this Project is on a forge Hemera reads. A handle typed below is added as it is.',
      fix: null,
    })
  })
})
