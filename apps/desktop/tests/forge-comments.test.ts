/**
 * The comments of a pull request read from its forge (R8): inline comments with their path, lines,
 * side, the commit they were made on and their thread's resolved state, general comments and
 * review summaries, through the forge port's registered reads only: `gh api` on GitHub (REST for
 * the comments and reviews, GraphQL for the threads), `bkt pr comments --json` on Bitbucket Cloud
 * and Data Center. Hemera never writes a comment, a reply, a reaction or a resolution: no shape
 * for one exists, and every call the reads make is a read.
 *
 * The CLIs are fakes alone on a `PATH` of their own (`fake-forge.ts`); no test reaches a forge.
 */

import { mkdirSync, realpathSync } from 'node:fs'
import { join } from 'node:path'

import { Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { THREADS_QUERY, readComments } from '../src/engine/forges/comments.ts'
import { ForgePort } from '../src/engine/forges/port.ts'
import { COMMAND_SHAPES, parseCommand, shapeOf } from '../src/engine/forges/shapes.ts'
import type { EngineServices } from '../src/engine/profile.ts'
import { createProject } from '../src/engine/projects.ts'
import { commandsEngine } from './commands-engine.ts'
import {
  type FakeForge,
  type FakeRule,
  BKT_CLOUD,
  bktReady,
  fakeForge,
  ghReady,
} from './fake-forge.ts'
import { git } from './repositories.ts'
import { removeFolders, temporaryFolder } from './storage.ts'

let data: string
let work: string
beforeEach(() => {
  data = realpathSync.native(temporaryFolder('forge-comments'))
  work = realpathSync.native(temporaryFolder('forge-comments-work'))
})
afterEach(removeFolders)

const REMOTES = {
  shop: 'git@github.com:acme/shop.git',
  api: 'https://bitbucket.org/acme-team/api.git',
  dc: 'ssh://git@bitbucket.acme.test:7999/shop/web.git',
}

/** The engine over these fakes, with Atlas made of the three repositories, `dc` on Data Center. */
const withForge = <A, E>(
  fake: FakeForge,
  program: (repository: (path: string) => string) => Effect.Effect<A, E, EngineServices>,
) => {
  const main = join(work, 'atlas')
  for (const [path, url] of Object.entries(REMOTES)) {
    const folder = join(main, path)
    mkdirSync(folder, { recursive: true })
    git(folder, 'init', '-q', '-b', 'main')
    git(folder, 'commit', '-q', '--allow-empty', '-m', 'base')
    git(folder, 'remote', 'add', 'origin', url)
  }
  return commandsEngine(data, { forge: { env: fake.env } })(({ profile }) =>
    profile.use(
      Effect.gen(function* () {
        const project = yield* createProject({
          name: 'Atlas',
          mainCheckout: main,
          repositories: Object.keys(REMOTES),
        })
        const repository = (path: string) => {
          const found = project.repositories.find((one) => one.path === path)
          if (found === undefined) throw new Error(`no repository ${path}`)
          return found.id
        }
        yield* ForgePort.use((port) =>
          port.setForced(
            project.id,
            repository('dc'),
            'bitbucket-datacenter',
            'bitbucket.acme.test',
          ),
        )
        return yield* program(repository)
      }),
    ),
  )
}

/** What `gh api --paginate --slurp` prints: the pages, each the list of one page. */
const pages = (...lists: ReadonlyArray<ReadonlyArray<object>>) => JSON.stringify(lists)

const GITHUB: ReadonlyArray<FakeRule> = [
  {
    cli: 'gh',
    when: ['repos/acme/shop/pulls/7/comments'],
    stdout: pages(
      [
        {
          id: 101,
          user: { login: 'grace' },
          body: 'Rename this function.',
          created_at: '2026-10-20T09:00:00Z',
          updated_at: '2026-10-20T09:00:00Z',
          path: 'src/export.ts',
          line: 14,
          start_line: 12,
          original_line: 12,
          original_start_line: 10,
          side: 'RIGHT',
          commit_id: 'c2c2c2c',
          original_commit_id: 'c1c1c1c',
          html_url: 'https://github.com/acme/shop/pull/7#discussion_r101',
        },
      ],
      [
        {
          id: 102,
          user: { login: 'octo' },
          body: 'Done in the next push.',
          created_at: '2026-10-20T09:05:00Z',
          updated_at: '2026-10-20T09:06:00Z',
          path: 'src/export.ts',
          line: null,
          original_line: 3,
          side: 'LEFT',
          commit_id: 'c2c2c2c',
          original_commit_id: 'c1c1c1c',
          in_reply_to_id: 101,
          html_url: 'https://github.com/acme/shop/pull/7#discussion_r102',
        },
      ],
    ),
  },
  {
    cli: 'gh',
    when: ['repos/acme/shop/issues/7/comments'],
    stdout: pages([
      {
        id: 201,
        user: { login: 'grace' },
        body: 'The export needs a CSV header.',
        created_at: '2026-10-20T10:00:00Z',
        updated_at: '2026-10-20T10:00:00Z',
        html_url: 'https://github.com/acme/shop/pull/7#issuecomment-201',
      },
    ]),
  },
  {
    cli: 'gh',
    when: ['repos/acme/shop/pulls/7/reviews'],
    stdout: pages([
      {
        id: 301,
        user: { login: 'grace' },
        body: 'Two things to change.',
        state: 'CHANGES_REQUESTED',
        submitted_at: '2026-10-20T09:01:00Z',
        html_url: 'https://github.com/acme/shop/pull/7#pullrequestreview-301',
      },
      // The review that only holds inline comments says nothing of its own.
      {
        id: 302,
        user: { login: 'grace' },
        body: '',
        state: 'COMMENTED',
        submitted_at: '2026-10-20T09:00:00Z',
        html_url: 'https://github.com/acme/shop/pull/7#pullrequestreview-302',
      },
    ]),
  },
  {
    cli: 'gh',
    when: ['graphql'],
    stdout: JSON.stringify({
      data: {
        repository: {
          pullRequest: {
            reviewThreads: {
              nodes: [
                {
                  isResolved: true,
                  comments: { nodes: [{ databaseId: 101 }, { databaseId: 102 }] },
                },
              ],
            },
          },
        },
      },
    }),
  },
]

const BITBUCKET: ReadonlyArray<FakeRule> = [
  {
    cli: 'bkt',
    when: ['pr', 'comments', '--workspace'],
    stdout: JSON.stringify({
      workspace: 'acme-team',
      repo: 'api',
      comments: [
        {
          id: 11,
          content: { raw: 'A typo here.' },
          user: { display_name: 'Grace Hopper', nickname: 'grace' },
          created_on: '2026-10-20T11:00:00.000000+00:00',
          updated_on: '2026-10-20T11:00:00.000000+00:00',
          deleted: false,
          resolution: { user: { nickname: 'grace' }, created_on: '2026-10-20T12:00:00Z' },
          inline: { path: 'src/b.ts', from: null, to: 5 },
          links: {
            html: { href: 'https://bitbucket.org/acme-team/api/pull-requests/4#comment-11' },
          },
        },
        {
          id: 12,
          content: { raw: 'Fixed.' },
          user: { display_name: 'Octo Cat', nickname: 'octo' },
          created_on: '2026-10-20T11:30:00.000000+00:00',
          updated_on: '2026-10-20T11:30:00.000000+00:00',
          deleted: false,
          resolution: null,
          parent: { id: 11 },
          inline: { path: 'src/b.ts', from: null, to: 5 },
        },
        {
          id: 13,
          content: { raw: '' },
          user: { display_name: 'Grace Hopper', nickname: 'grace' },
          created_on: '2026-10-20T11:40:00.000000+00:00',
          updated_on: '2026-10-20T11:45:00.000000+00:00',
          deleted: true,
          resolution: null,
        },
      ],
    }),
  },
  {
    cli: 'bkt',
    when: ['pr', 'comments', '--project'],
    stdout: JSON.stringify({
      project: 'SHOP',
      repo: 'web',
      comments: [
        {
          id: 21,
          version: 2,
          text: 'Why a second loop?',
          createdDate: 1_760_958_000_000,
          severity: 'NORMAL',
          state: 'OPEN',
          author: { name: 'grace', displayName: 'Grace Hopper' },
          threadResolved: false,
          anchor: { path: 'src/c.ts', line: 3, lineType: 'REMOVED', fileType: 'FROM' },
        },
        {
          id: 22,
          version: 0,
          text: 'A general word.',
          createdDate: 1_760_958_600_000,
          severity: 'NORMAL',
          state: 'OPEN',
          author: { name: 'octo', displayName: 'Octo Cat' },
          threadResolved: true,
        },
      ],
    }),
  },
]

const ALL_READY: ReadonlyArray<FakeRule> = [
  ...GITHUB,
  ...BITBUCKET,
  ...ghReady(),
  ...bktReady([BKT_CLOUD, { base: 'https://bitbucket.acme.test', kind: 'dc' }]),
]

describe('The comments of a pull request come from the forge with their place, thread and state', () => {
  test('GitHub: inline comments with path, lines, side, commit and resolved thread; general comments; review summaries', async () => {
    const fake = fakeForge(ALL_READY)
    const { slug, comments } = await withForge(fake, (repository) =>
      readComments(repository('shop'), 7),
    )
    expect(slug).toBe('acme/shop')
    expect(comments).toEqual([
      {
        id: '101',
        kind: 'inline',
        thread: '101',
        author: 'grace',
        body: 'Rename this function.',
        createdAt: '2026-10-20T09:00:00Z',
        updatedAt: '2026-10-20T09:00:00Z',
        revision: '2026-10-20T09:00:00Z',
        url: 'https://github.com/acme/shop/pull/7#discussion_r101',
        review: null,
        anchor: {
          path: 'src/export.ts',
          side: 'new',
          lines: { start: 10, end: 12 },
          commit: 'c1c1c1c',
        },
        resolved: true,
        removed: false,
      },
      {
        id: '102',
        kind: 'inline',
        thread: '101',
        author: 'octo',
        body: 'Done in the next push.',
        createdAt: '2026-10-20T09:05:00Z',
        updatedAt: '2026-10-20T09:06:00Z',
        revision: '2026-10-20T09:06:00Z',
        url: 'https://github.com/acme/shop/pull/7#discussion_r102',
        review: null,
        anchor: {
          path: 'src/export.ts',
          side: 'old',
          lines: { start: 3, end: 3 },
          commit: 'c1c1c1c',
        },
        resolved: true,
        removed: false,
      },
      {
        id: 'issue-201',
        kind: 'general',
        thread: null,
        author: 'grace',
        body: 'The export needs a CSV header.',
        createdAt: '2026-10-20T10:00:00Z',
        updatedAt: '2026-10-20T10:00:00Z',
        revision: '2026-10-20T10:00:00Z',
        url: 'https://github.com/acme/shop/pull/7#issuecomment-201',
        review: null,
        anchor: null,
        resolved: false,
        removed: false,
      },
      {
        id: 'review-301',
        kind: 'review',
        thread: null,
        author: 'grace',
        body: 'Two things to change.',
        createdAt: '2026-10-20T09:01:00Z',
        updatedAt: '2026-10-20T09:01:00Z',
        revision: '2026-10-20T09:01:00Z',
        url: 'https://github.com/acme/shop/pull/7#pullrequestreview-301',
        review: 'changes-requested',
        anchor: null,
        resolved: false,
        removed: false,
      },
    ])
  })

  test('Bitbucket Cloud: inline comments with their line, thread and resolution; a deleted one says so', async () => {
    const fake = fakeForge(ALL_READY)
    const { slug, comments } = await withForge(fake, (repository) =>
      readComments(repository('api'), 4),
    )
    expect(slug).toBe('acme-team/api')
    expect(comments).toEqual([
      expect.objectContaining({
        id: '11',
        kind: 'inline',
        thread: '11',
        author: 'grace',
        body: 'A typo here.',
        url: 'https://bitbucket.org/acme-team/api/pull-requests/4#comment-11',
        anchor: { path: 'src/b.ts', side: 'new', lines: { start: 5, end: 5 }, commit: null },
        resolved: true,
        removed: false,
      }),
      expect.objectContaining({ id: '12', thread: '11', author: 'octo', resolved: true }),
      expect.objectContaining({ id: '13', kind: 'general', removed: true }),
    ])
  })

  test('Bitbucket Data Center: an anchor on the old side, a general comment, the thread resolved, the version', async () => {
    const fake = fakeForge(ALL_READY)
    const { slug, comments } = await withForge(fake, (repository) =>
      readComments(repository('dc'), 9),
    )
    expect(slug).toBe('shop/web')
    expect(comments).toEqual([
      expect.objectContaining({
        id: '21',
        kind: 'inline',
        thread: '21',
        author: 'grace',
        body: 'Why a second loop?',
        createdAt: new Date(1_760_958_000_000).toISOString(),
        revision: '2',
        anchor: { path: 'src/c.ts', side: 'old', lines: { start: 3, end: 3 }, commit: null },
        resolved: false,
      }),
      expect.objectContaining({ id: '22', kind: 'general', author: 'octo', resolved: true }),
    ])
  })
})

describe('No call to the forge CLI for comments is a write', () => {
  test('every call the reads make matches a read shape, with the place of its repository', async () => {
    const fake = fakeForge(ALL_READY)
    await withForge(fake, (repository) =>
      Effect.all([
        readComments(repository('shop'), 7),
        readComments(repository('api'), 4),
        readComments(repository('dc'), 9),
      ]),
    )
    const reads = fake
      .calls()
      .filter((call) => call.args.some((arg) => /comments|reviews|graphql/.test(arg)))
    expect(reads.length).toBe(6)
    for (const call of reads) expect(shapeOf(call.cli, call.args)?.class).toBe('read')
  })

  test('no shape writes a comment, a reply, a reaction, a review or a resolution; the GraphQL read takes its one query only', () => {
    const writes = COMMAND_SHAPES.filter((one) => one.class === 'network-write')
    expect(writes.map((one) => one.operation)).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/comment|review|reaction|resolve|reply/)]),
    )
    for (const one of COMMAND_SHAPES.filter((shape) =>
      /comment|review|thread/.test(shape.operation),
    ))
      expect(one.class).toBe('read')
    expect(THREADS_QUERY.trimStart().startsWith('query')).toBe(true)
    expect(THREADS_QUERY).not.toMatch(/mutation/i)
    const graphql = (query: string) => [
      'api',
      '--hostname',
      'github.com',
      'graphql',
      '-f',
      `query=${query}`,
      '-F',
      'owner=acme',
      '-F',
      'name=shop',
      '-F',
      'number=7',
    ]
    expect(parseCommand('gh', graphql(THREADS_QUERY))?.shape.class).toBe('read')
    expect(
      parseCommand(
        'gh',
        graphql('mutation { resolveReviewThread(input: {threadId: "T"}) { thread { id } } }'),
      ),
    ).toBeNull()
    // A REST call that would post: another method, a body, a field.
    expect(
      parseCommand('gh', [
        'api',
        '--hostname',
        'github.com',
        'repos/acme/shop/issues/7/comments',
        '--method',
        'POST',
        '-f',
        'body=hello',
      ]),
    ).toBeNull()
    expect(
      parseCommand('bkt', [
        'pr',
        'comments',
        'resolve',
        '7',
        '--context',
        'oss',
        '--workspace',
        'acme-team',
        '--repo',
        'api',
      ]),
    ).toBeNull()
  })
})
