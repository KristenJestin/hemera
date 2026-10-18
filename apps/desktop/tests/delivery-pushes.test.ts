/**
 * The pushes and pull requests of a mission (R6): the commits Hemera makes at push time with the
 * user's own Git identity, the push (never forced, in the user's environment), the pull request
 * found before it is created, from the repository's templates, and a Retry or a restart that never
 * does twice what is already true.
 *
 * On the engine as it starts, with the fake agent of #32 as every agent: Acme's `api` and `web` in
 * temporary folders, each with a bare repository on the same disk as its remote. Each remote is
 * named `https://git.acme.test/acme/<name>.git`, a host that never resolves, and Git pushes it to the
 * bare one (`url.<bare>.pushInsteadOf`); the forge is forced to GitHub on that host, and `gh` is a
 * fake alone on a `PATH` of its own whose pull requests live in a file (`fake-forge.ts`). No real
 * forge, no network.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  ChosenAnswer,
  DEFAULT_BASE_BRANCH,
  type DeliveryAction,
  type DeliveryRulesDraft,
  defaultDeliveryRules,
} from '@hemera/core/domain'
import type { MissionPushes, Need, RepositoryPush } from '@hemera/ipc'
import { asc, desc, eq } from 'drizzle-orm'
import { Deferred, Effect, Predicate } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { saveDeliveryRules } from '../src/engine/delivery-rules.ts'
import { type PushMoment, Pushes } from '../src/engine/delivery/pushes.ts'
import { ForgePort } from '../src/engine/forges/port.ts'
import { pullRequestStatus } from '../src/engine/forges/pull-requests.ts'
import type { GitBytesSpawn } from '../src/engine/git.ts'
import { Memory } from '../src/engine/memory/index.ts'
import { getMission, moveIn, moveMission } from '../src/engine/missions.ts'
import { answerNeed, pendingNeedsOf, retryNeed } from '../src/engine/needs.ts'
import { createProject, getProject } from '../src/engine/projects.ts'
import { Database } from '../src/engine/storage/database.ts'
import {
  buildingLaunches,
  checkpointRepositories,
  effectfulActions,
  workspaceRepositories,
} from '../src/engine/storage/schema.ts'
import { mutate } from '../src/engine/transaction.ts'
import { builderAgents, builderOf, launched } from './builder-world.ts'
import { INVOICES, PACKAGE, call } from './building-world.ts'
import { type FakeForge, type FakeRule, fakeForge, ghReady, ghSignedOut } from './fake-forge.ts'
import { git, remote, repository } from './repositories.ts'
import { HELPER, sessionsEngine, until, within } from './sessions-world.ts'
import { removeFolders, temporaryFolder } from './storage.ts'

/** The forge's host: `.test` never resolves, so nothing a remote names is ever reached. */
const HOST = 'git.acme.test'

/** Every test runs a whole engine, Git and a Builder: far above its time alone (10 to 25 s). */
const SLOW = 180_000

/** A token of the shape the masking knows, joined at run time: a secret scanner never sees it. */
const TOKEN = ['ghp', '_', 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'].join('')

/**
 * The pull requests of the fake forge, kept in a file beside it: `pr list` and `pr view` read them,
 * `pr create` adds one (its body read from the standard input). A pull request's head is the
 * branch's commit on the bare repository, read from its refs. A file `kill-after-create` makes the
 * next create print more than Hemera reads once it has created, so it is cut unanswered, as a CLI
 * cut after the forge answered (a kill would do the same on Linux, but is no signal on Windows),
 * the same on every system; holding
 * `and-lists-fail`, every list fails after it, as a forge that cannot be read, until the file
 * `lists-fail` is removed.
 */
const FORGE_PROGRAM = String.raw`
const { existsSync, readFileSync, unlinkSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')
const config = JSON.parse(readFileSync(join(__dirname, 'forge.json'), 'utf8'))
const kept = join(__dirname, 'prs.json')
const read = () => (existsSync(kept) ? JSON.parse(readFileSync(kept, 'utf8')) : [])
const valueOf = (args, flag) => {
  const at = args.indexOf(flag)
  return at < 0 ? undefined : args[at + 1]
}
const headOf = (bare, branch) => {
  const loose = join(bare, 'refs', 'heads', ...branch.split('/'))
  if (existsSync(loose)) return readFileSync(loose, 'utf8').trim()
  const packed = join(bare, 'packed-refs')
  if (!existsSync(packed)) return ''
  const line = readFileSync(packed, 'utf8').split('\n').find((one) => one.endsWith(' refs/heads/' + branch))
  return line === undefined ? '' : line.split(' ')[0]
}
const STATES = { OPEN: 'OPEN', MERGED: 'MERGED', CLOSED: 'CLOSED' }
module.exports = (cli, args) => {
  const repo = (valueOf(args, '--repo') ?? '').split('/').slice(1).join('/')
  const bare = config.bares[repo]
  const prs = read()
  if (args[1] === 'list') {
    if (existsSync(join(__dirname, 'lists-fail'))) {
      return { stderr: 'error connecting to ' + config.host, code: 1 }
    }
    const found = prs.filter(
      (one) =>
        one.repo === repo &&
        one.head === valueOf(args, '--head') &&
        one.base === valueOf(args, '--base') &&
        one.state === STATES.OPEN,
    )
    return {
      stdout: JSON.stringify(
        found.map((one) => ({
          number: one.number,
          url: one.url,
          state: one.state,
          headRefOid: headOf(bare, one.head),
        })),
      ),
    }
  }
  if (args[1] === 'create') {
    const body = readFileSync(0, 'utf8')
    const number = prs.length + 1
    const created = {
      repo,
      number,
      url: 'https://' + config.host + '/' + repo + '/pull/' + String(number),
      head: valueOf(args, '--head'),
      base: valueOf(args, '--base'),
      title: valueOf(args, '--title'),
      reviewers: valueOf(args, '--reviewer') ?? null,
      body,
      state: STATES.OPEN,
    }
    writeFileSync(kept, JSON.stringify([...prs, created]))
    const kill = join(__dirname, 'kill-after-create')
    if (existsSync(kill)) {
      if (readFileSync(kill, 'utf8') === 'and-lists-fail') {
        writeFileSync(join(__dirname, 'lists-fail'), '')
      }
      unlinkSync(kill)
      return { flood: true }
    }
    return { stdout: created.url + '\n' }
  }
  if (args[1] === 'view') {
    const one = prs.find((pr) => pr.repo === repo && pr.number === Number(args[2]))
    if (one === undefined) return { stderr: 'no pull requests found', code: 1 }
    return {
      stdout: JSON.stringify({
        number: one.number,
        url: one.url,
        state: one.state,
        headRefOid: headOf(bare, one.head),
        reviewDecision: one.approved ? 'APPROVED' : 'REVIEW_REQUIRED',
        latestReviews: one.approved ? [{ author: { login: 'grace' }, state: 'APPROVED' }] : [],
      }),
    }
  }
  return { stderr: 'fake forge: ' + args.join(' '), code: 1 }
}
`

interface ForgeWorld {
  readonly fake: FakeForge
  readonly folder: string
  /** The pull requests the fake forge holds. */
  readonly pullRequests: () => ReadonlyArray<{
    readonly repo: string
    readonly number: number
    readonly head: string
    readonly base: string
    readonly title: string
    readonly body: string
    readonly reviewers: string | null
  }>
  /** How many times `gh` was asked to create one. */
  readonly creates: () => number
  /** `gh` answered by these rules first, then the fake forge. */
  readonly answer: (first: ReadonlyArray<FakeRule>) => void
}

let data: string
let work: string
let forge: ForgeWorld

const forgeWorld = (): ForgeWorld => {
  const folder = temporaryFolder('delivery-forge')
  const program = join(folder, 'forge.cjs')
  writeFileSync(program, FORGE_PROGRAM)
  writeFileSync(
    join(folder, 'forge.json'),
    JSON.stringify({
      host: HOST,
      bares: { 'acme/api': bareOf('api'), 'acme/web': bareOf('web') },
    }),
  )
  const rules = (first: ReadonlyArray<FakeRule>): ReadonlyArray<FakeRule> => [
    ...first,
    ...ghReady(HOST),
    { cli: 'gh', when: ['pr'], program },
  ]
  const fake = fakeForge(rules([]), ['gh'])
  const kept = join(folder, 'prs.json')
  return {
    fake,
    folder,
    pullRequests: () => (existsSync(kept) ? JSON.parse(readFileSync(kept, 'utf8')) : []),
    creates: () =>
      fake.calls().filter((one) => one.args[0] === 'pr' && one.args[1] === 'create').length,
    answer: (first) => fake.answer(rules(first)),
  }
}

const bareOf = (name: string) => join(work, 'remotes', `${name}.git`)

beforeEach(() => {
  data = temporaryFolder('delivery-pushes')
  work = temporaryFolder('delivery-pushes-work')
  forge = forgeWorld()
})
afterEach(removeFolders)

/** Every `git` call the pushes made, by its arguments: across every engine of a test. */
type GitCalls = Array<ReadonlyArray<string>>

const recording =
  (calls: GitCalls) =>
  (real: GitBytesSpawn): GitBytesSpawn =>
  (folder, args, kind, options) => {
    calls.push(args)
    return real(folder, args, kind, options)
  }

/**
 * What the machine's system configuration says of line endings, as `GIT_CONFIG_*` variables. Git
 * for Windows sets `core.autocrlf` there: the Workspace was checked out with it, and a Git that
 * read no system configuration at all would see every file changed.
 */
const systemLineEndings = (): Readonly<Record<string, string>> => {
  const set = ['core.autocrlf', 'core.eol'].flatMap((key) => {
    try {
      return [[key, git(work, 'config', '--system', '--get', key)] as const]
    } catch {
      return []
    }
  })
  return Object.fromEntries([
    ['GIT_CONFIG_COUNT', String(set.length)],
    ...set.flatMap(([key, value], at) => [
      [`GIT_CONFIG_KEY_${at}`, key],
      [`GIT_CONFIG_VALUE_${at}`, value],
    ]),
  ])
}

/**
 * The pushes' Git reading the user's global configuration from `global`, and of the system one
 * only its line endings: no identity the machine holds reaches it.
 */
const withoutUserConfig = (global: string) => {
  const endings = systemLineEndings()
  return (real: GitBytesSpawn): GitBytesSpawn =>
    (folder, args, kind, options) =>
      real(folder, args, kind, {
        ...options,
        env: { ...options?.env, ...endings, GIT_CONFIG_GLOBAL: global, GIT_CONFIG_NOSYSTEM: '1' },
      })
}

const engine = (
  options: {
    readonly hold?: (at: PushMoment, repository: string) => Effect.Effect<void>
    readonly git?: (real: GitBytesSpawn) => GitBytesSpawn
  } = {},
) =>
  sessionsEngine(data, builderAgents, {
    roles: [HELPER],
    tools: { home: work },
    building: { outside: { compareEveryMillis: 3_600_000, baseEveryMillis: 3_600_000 } },
    forge: { env: forge.fake.env },
    delivery: { hold: options.hold, git: options.git },
  })

/** A hold that stops the sequence at one moment of one repository, for good, and says it did. */
const stopAt = (moment: PushMoment, name = 'api') => {
  const reached = Effect.runSync(Deferred.make<void>())
  return {
    reached: Deferred.await(reached),
    hold: (at: PushMoment, held: string) =>
      at === moment && held === name
        ? Effect.andThen(Deferred.succeed(reached, undefined), Effect.never)
        : Effect.void,
  }
}

/** Every action of a stack auto, or every one on a click. */
const PUSH_STACK = (mode: 'auto' | 'click'): ReadonlyArray<DeliveryAction> => [
  { id: 'commit', kind: 'commit-by-hemera', mode: 'auto' },
  { id: 'push', kind: 'push', mode },
  { id: 'pull-request', kind: 'pull-request', mode },
]

/** The Project's rules: the push and the pull request automatic unless told, with templates. */
const rulesWith = (
  change: (draft: DeliveryRulesDraft) => DeliveryRulesDraft = (draft) => draft,
): DeliveryRulesDraft => {
  const draft = defaultDeliveryRules()
  return change({
    ...draft,
    preparation: {
      ...draft.preparation,
      presets: { ...draft.preparation.presets, application: PUSH_STACK('auto') },
    },
  })
}

/** Templates and reviewers for `api`, the rest of the preparation its preset's. */
const withApiTemplates =
  (reviewers: ReadonlyArray<string> = ['grace', 'acme/core']) =>
  (draft: DeliveryRulesDraft): DeliveryRulesDraft => ({
    ...draft,
    preparation: {
      ...draft.preparation,
      repositories: [
        {
          repositoryId: '',
          commitTemplate: '{key}: {title} ({branch})',
          pullRequestTitle: '[{key}] {title}',
          pullRequestBody: 'Summary: {summary}\nSlug: {slug}\n{images}',
          reviewers,
          requireApproval: false,
          steps: { off: [], changed: [], added: [] },
        },
      ],
    },
  })

/**
 * Acme with `api` and `web`, each on its bare remote under the forge's name, the user's identity in
 * their configuration and `*.log` ignored.
 */
const acmeOnForge = (identity: boolean) => (at: string) =>
  Effect.gen(function* () {
    const main = join(at, 'acme')
    const folders = ['api', 'web'].map((name) => {
      const folder = repository(join(main, name), DEFAULT_BASE_BRANCH)
      writeFileSync(join(folder, 'README.md'), `Acme ${name}\n`)
      writeFileSync(join(folder, '.gitignore'), '*.log\n')
      // What the plan's tasks and proofs read (#141's world).
      if (name === 'api') {
        writeFileSync(join(folder, 'invoices.ts'), INVOICES)
        writeFileSync(join(folder, 'package.json'), PACKAGE)
      }
      git(folder, 'add', '.')
      git(folder, 'commit', '-q', '-m', 'readme')
      const bare = remote(folder, bareOf(name))
      const named = `https://${HOST}/acme/${name}.git`
      git(folder, 'remote', 'set-url', 'origin', named)
      git(folder, 'config', `url.${bare.replaceAll('\\', '/')}.pushInsteadOf`, named)
      if (identity) {
        git(folder, 'config', 'user.name', 'Ada Lovelace')
        git(folder, 'config', 'user.email', 'ada@example.com')
      }
      return folder
    })
    const project = yield* createProject({
      name: 'acme',
      mainCheckout: main,
      repositories: ['api', 'web'],
    })
    return { project, main, api: folders[0] ?? '', web: folders[1] ?? '' }
  })

/**
 * The Project's forge forced to GitHub on the fake's host for every repository, and the rules
 * given saved (unless null: the defaults, a click before the push and the pull request).
 */
const onForge = (rules: DeliveryRulesDraft | null) => (projectId: string) =>
  Effect.gen(function* () {
    const project = yield* getProject(projectId)
    const port = yield* ForgePort
    for (const one of project.repositories) {
      yield* port.setForced(project.id, one.id, 'github', HOST)
    }
    if (rules !== null) {
      const api = project.repositories.find((one) => one.path === 'api')?.id ?? ''
      const named: DeliveryRulesDraft = {
        ...rules,
        preparation: {
          ...rules.preparation,
          repositories: rules.preparation.repositories.map((one) => ({
            ...one,
            repositoryId: one.repositoryId === '' ? api : one.repositoryId,
          })),
        },
      }
      yield* saveDeliveryRules(project.id, named, 0)
    }
  }).pipe(Effect.orDie)

/** Acme's mission launched over `api` and `web`, Building, and its Workspace's folders. */
const launchedOnForge = (rules: DeliveryRulesDraft | null = rulesWith(), identity = true) =>
  Effect.gen(function* () {
    const { mission, project } = yield* launched(
      work,
      onForge(rules),
      'It touches api and web, nothing else.',
      undefined,
      acmeOnForge(identity),
    )
    const database = yield* Database
    const [launch] = yield* database
      .select({ workspaceId: buildingLaunches.workspaceId })
      .from(buildingLaunches)
      .where(eq(buildingLaunches.missionId, mission.id))
      .orderBy(desc(buildingLaunches.startedAt))
    const rows = yield* database
      .select()
      .from(workspaceRepositories)
      .where(eq(workspaceRepositories.workspaceId, launch?.workspaceId ?? ''))
      .orderBy(asc(workspaceRepositories.position))
    const folderOf = (path: string) => {
      const found = rows.find((row) => row.path === path)?.worktree
      if (found === undefined) throw new Error(`no ${path} in the Workspace`)
      return found
    }
    const { grantId } = yield* builderOf(mission.id)
    const api = folderOf('api')
    return {
      missionId: mission.id,
      projectId: project.id,
      grantId,
      api,
      web: folderOf('web'),
      branch: git(api, 'rev-parse', '--abbrev-ref', 'HEAD'),
    }
  })

/** The mission moved as a Building's end (B9) moves it into Review, or as the user's gestures do. */
const moved = (missionId: string, move: 'endBuilding' | 'fix') =>
  Effect.gen(function* () {
    if (move === 'fix') return yield* moveMission(missionId, move, 'user')
    const mission = yield* getMission(missionId)
    yield* mutate('ending the Building', (transaction) =>
      Effect.map(
        moveIn(
          transaction,
          { id: missionId, stage: mission.stage, round: mission.round },
          move,
          'hemera',
        ),
        (event) => ({ result: undefined, events: [event] }),
      ),
    )
    return yield* getMission(missionId)
  })

const pushesOf = (missionId: string) => Pushes.use((pushes) => pushes.pushes(missionId))

const repositoryOf = (pushes: MissionPushes, name: string): RepositoryPush | null =>
  pushes.repositories.find((one) => one.repository === name) ?? null

/** Waits until a repository of the mission stands in a state. */
const untilState = (missionId: string, name: string, state: RepositoryPush['state']) =>
  until(
    Effect.map(pushesOf(missionId), (pushes) => repositoryOf(pushes, name)?.state === state),
    60_000,
  )

/** The mission's needs still pending, of one kind. */
type NeedKind = 'Environment' | 'Decision' | 'Error' | 'Permission'

const pendingOf = (missionId: string, kind: NeedKind) =>
  Effect.map(pendingNeedsOf([missionId]), (all) =>
    (all.get(missionId) ?? []).filter((need) => Predicate.isTagged(need.fields, kind)),
  )

/** Waits for the first pending need of a kind on the mission. */
const needOf = (missionId: string, kind: NeedKind) =>
  Effect.gen(function* () {
    yield* until(
      Effect.map(pendingOf(missionId, kind), (found) => found.length > 0),
      60_000,
    )
    const [found] = yield* pendingOf(missionId, kind)
    if (found === undefined) return yield* Effect.die(new Error(`no ${kind} need`))
    return found
  })

const chosen = (need: Need, option: string) =>
  answerNeed({ id: need.id, key: `answer-${need.id}`, answer: ChosenAnswer.make({ option }) })

/** What the remote's branch points at, or null. */
const remoteHead = (name: string, branch: string): string | null => {
  const printed = git(work, 'ls-remote', bareOf(name), `refs/heads/${branch}`)
  return printed === '' ? null : (printed.split('\t')[0] ?? null)
}

/** The commits of the branch since its base, newest first: subject, author, email. */
const commitsSinceBase = (folder: string) =>
  git(folder, 'log', '--format=%s|%an|%ae', `${DEFAULT_BASE_BRANCH}..HEAD`)
    .split('\n')
    .filter((line) => line !== '')

const pushCalls = (calls: GitCalls) => calls.filter((args) => args.includes('push'))

const journalOf = (missionId: string) =>
  Effect.gen(function* () {
    const memory = yield* Memory
    yield* memory.catchUp
    return (yield* memory.journal(missionId, null)).lines
      .filter((line) => line.kind === 'delivery')
      .map((line) => line.text)
  })

describe('Commits at push time', () => {
  test(
    'Hemera commits at push: one commit with the rendered message, the user’s identity read from Git, untracked non-ignored files included, ignored files not',
    async () => {
      const { run } = engine()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const mission = yield* launchedOnForge(rulesWith(withApiTemplates()))
            writeFileSync(join(mission.api, 'notes.ts'), 'export const notes = 1\n')
            writeFileSync(join(mission.api, 'README.md'), 'Acme api, changed\n')
            writeFileSync(join(mission.api, 'debug.log'), 'ignored\n')
            yield* moved(mission.missionId, 'endBuilding')
            yield* untilState(mission.missionId, 'api', 'done')
            const head = git(mission.api, 'rev-parse', 'HEAD')
            return {
              mission,
              commits: commitsSinceBase(mission.api),
              files: git(mission.api, 'show', '--name-only', '--format=', 'HEAD').split('\n'),
              status: git(mission.api, 'status', '--porcelain'),
              head,
              tree: git(mission.api, 'rev-parse', 'HEAD^{tree}'),
            }
          }),
        ),
      )
      const key = seen.commits[0]?.split(':')[0] ?? ''
      expect(seen.commits).toEqual([
        `${key}: Invoices exports (${seen.mission.branch})|Ada Lovelace|ada@example.com`,
      ])
      expect([...seen.files].sort()).toEqual(['README.md', 'notes.ts'])
      // The ignored file stays where it was, uncommitted and ignored.
      expect(seen.status).toBe('')
      expect(existsSync(join(seen.mission.api, 'debug.log'))).toBe(true)
      expect(remoteHead('api', seen.mission.branch)).toBe(seen.head)
    },
    SLOW,
  )

  test(
    'commits already on the branch are kept and only what remains is committed, once',
    async () => {
      const { run } = engine()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const mission = yield* launchedOnForge()
            writeFileSync(join(mission.api, 'first.ts'), 'export const first = 1\n')
            git(mission.api, 'add', 'first.ts')
            git(mission.api, 'commit', '-q', '-m', 'first, by the user')
            writeFileSync(join(mission.api, 'second.ts'), 'export const second = 2\n')
            yield* moved(mission.missionId, 'endBuilding')
            yield* untilState(mission.missionId, 'api', 'done')
            return {
              subjects: commitsSinceBase(mission.api).map((line) => line.split('|')[0]),
              last: git(mission.api, 'show', '--name-only', '--format=', 'HEAD'),
            }
          }),
        ),
      )
      expect(seen.subjects).toHaveLength(2)
      expect(seen.subjects[1]).toBe('first, by the user')
      expect(seen.last).toBe('second.ts')
    },
    SLOW,
  )

  test(
    'the pushed tree equals the recorded checkpoint’s tree',
    async () => {
      const { run } = engine()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const mission = yield* launchedOnForge()
            writeFileSync(join(mission.api, 'notes.ts'), 'export const notes = 1\n')
            yield* moved(mission.missionId, 'endBuilding')
            yield* untilState(mission.missionId, 'api', 'done')
            const database = yield* Database
            const [action] = yield* database
              .select()
              .from(effectfulActions)
              .where(eq(effectfulActions.kind, 'delivery.commit'))
            const recorded: { readonly checkpointId?: string } = JSON.parse(action?.details ?? '{}')
            const [checkpoint] = yield* database
              .select({ tree: checkpointRepositories.tree })
              .from(checkpointRepositories)
              .where(eq(checkpointRepositories.checkpointId, recorded.checkpointId ?? ''))
            return {
              recorded: checkpoint?.tree,
              pushed: git(bareOf('api'), 'rev-parse', `refs/heads/${mission.branch}^{tree}`),
              head: git(mission.api, 'rev-parse', 'HEAD^{tree}'),
            }
          }),
        ),
      )
      expect(seen.recorded).toBe(seen.head)
      expect(seen.pushed).toBe(seen.head)
    },
    SLOW,
  )
})

describe('The Workspace changing while it is committed', () => {
  /**
   * The pushes' Git with a file of the user's written into the worktree around each `git add` of
   * the commit: just before it (in the commit, not in its checkpoint) and, `twice`, just after it
   * as well (in the next checkpoint, not in the commit).
   */
  const landing =
    (twice: boolean) =>
    (real: GitBytesSpawn): GitBytesSpawn => {
      let landed = 0
      const land = (folder: string) =>
        Effect.sync(() => {
          landed += 1
          writeFileSync(join(folder, `late-${String(landed)}.ts`), 'export const late = 1\n')
        })
      return (folder, args, kind, options) => {
        const committing = args[0] === 'add' && options?.env?.['GIT_INDEX_FILE'] === undefined
        if (!committing || (!twice && landed > 0)) return real(folder, args, kind, options)
        return land(folder).pipe(
          Effect.andThen(real(folder, args, kind, options)),
          Effect.tap(() => (twice ? land(folder) : Effect.void)),
        )
      }
    }

  test.each([
    ['once', false, 'done'],
    ['at each attempt', true, 'failed'],
  ] as const)(
    'a change landing %s between the checkpoint and the commit: committed again from a new checkpoint, then the push stops',
    async (_case, twice, state) => {
      const { run } = engine({ git: landing(twice) })
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const mission = yield* launchedOnForge()
            writeFileSync(join(mission.api, 'notes.ts'), 'export const notes = 1\n')
            yield* moved(mission.missionId, 'endBuilding')
            yield* untilState(mission.missionId, 'api', state)
            const database = yield* Database
            const commits = yield* database
              .select({ state: effectfulActions.state })
              .from(effectfulActions)
              .where(eq(effectfulActions.kind, 'delivery.commit'))
              .orderBy(asc(effectfulActions.startedAt))
            return {
              push: repositoryOf(yield* pushesOf(mission.missionId), 'api'),
              commits: commits.map((one) => one.state),
              head: git(mission.api, 'rev-parse', 'HEAD'),
              branch: mission.branch,
            }
          }),
        ),
      )
      if (state === 'done') {
        // The commit took the late file with the rest; the next attempt found nothing left.
        expect(seen.commits).toEqual(['done'])
        expect(remoteHead('api', seen.branch)).toBe(seen.head)
        return
      }
      expect(seen.commits).toEqual(['done', 'done'])
      expect(seen.push?.state).toBe('failed')
      expect(seen.push?.message).toBe('The Workspace changed while it was being committed.')
      expect(remoteHead('api', seen.branch)).toBeNull()
    },
    SLOW,
  )
})

describe('The push', () => {
  test(
    'the bare remote has the branch at the commit; a second push after a round adds a commit, no force, same pull request',
    async () => {
      const calls: GitCalls = []
      const { run } = engine({ git: recording(calls) })
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const mission = yield* launchedOnForge()
            writeFileSync(join(mission.api, 'notes.ts'), 'export const notes = 1\n')
            yield* moved(mission.missionId, 'endBuilding')
            yield* untilState(mission.missionId, 'api', 'done')
            const first = git(mission.api, 'rev-parse', 'HEAD')
            const firstPush = repositoryOf(yield* pushesOf(mission.missionId), 'api')
            // A round: Fix, a change, and back into Review.
            yield* moved(mission.missionId, 'fix')
            writeFileSync(join(mission.api, 'notes.ts'), 'export const notes = 2\n')
            yield* moved(mission.missionId, 'endBuilding')
            yield* until(
              Effect.map(
                pushesOf(mission.missionId),
                (pushes) =>
                  repositoryOf(pushes, 'api')?.state === 'done' &&
                  repositoryOf(pushes, 'api')?.commit !== first,
              ),
              60_000,
            )
            const second = git(mission.api, 'rev-parse', 'HEAD')
            return {
              branch: mission.branch,
              first,
              second,
              parent: git(mission.api, 'rev-parse', 'HEAD^'),
              firstPush,
              secondPush: repositoryOf(yield* pushesOf(mission.missionId), 'api'),
              upstream: git(mission.api, 'config', '--list')
                .split('\n')
                .filter((line) => line.startsWith('branch.')),
            }
          }),
        ),
      )
      expect(remoteHead('api', seen.branch)).toBe(seen.second)
      expect(seen.parent).toBe(seen.first)
      expect(seen.firstPush?.pullRequest?.number).toBe(1)
      expect(seen.secondPush?.pullRequest?.number).toBe(1)
      expect(seen.secondPush?.pullRequest?.head).toBe(seen.second)
      expect(forge.creates()).toBe(1)
      // Never forced, and no upstream written into the repository's configuration.
      const pushes = pushCalls(calls)
      expect(pushes.length).toBeGreaterThanOrEqual(2)
      for (const args of pushes) {
        expect(args.some((arg) => arg.startsWith('-f') || arg.startsWith('--force'))).toBe(false)
        expect(args.some((arg) => arg.startsWith('+'))).toBe(false)
        expect(args.some((arg) => arg === '-u' || arg === '--set-upstream')).toBe(false)
        expect(args.includes('--no-verify')).toBe(false)
      }
      expect(seen.upstream).toEqual([])
    },
    SLOW,
  )

  test(
    'a rejected push (the remote has a newer commit) fails with Git’s message and an error need with Retry, which pushes once the remote allows it',
    async () => {
      const { run } = engine()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const mission = yield* launchedOnForge()
            // Someone else pushed the mission's branch first.
            const clone = join(work, 'theirs')
            git(work, 'clone', '-q', bareOf('api'), clone)
            git(clone, 'checkout', '-q', '-b', mission.branch)
            writeFileSync(join(clone, 'theirs.ts'), 'export const theirs = 1\n')
            git(clone, 'add', 'theirs.ts')
            git(clone, 'commit', '-q', '-m', 'theirs')
            git(clone, 'push', '-q', 'origin', mission.branch)
            writeFileSync(join(mission.api, 'notes.ts'), 'export const notes = 1\n')
            yield* moved(mission.missionId, 'endBuilding')
            yield* untilState(mission.missionId, 'api', 'failed')
            const failed = repositoryOf(yield* pushesOf(mission.missionId), 'api')
            const need = yield* needOf(mission.missionId, 'Error')
            // The remote's branch is given back: Retry pushes.
            git(clone, 'push', '-q', 'origin', '--delete', mission.branch)
            yield* chosen(need, 'Retry')
            yield* untilState(mission.missionId, 'api', 'done')
            return {
              failed,
              need,
              head: git(mission.api, 'rev-parse', 'HEAD'),
              branch: mission.branch,
              journal: yield* journalOf(mission.missionId),
            }
          }),
        ),
      )
      expect(seen.failed?.message).toMatch(/rejected/)
      expect(seen.failed?.step).toBe('push')
      const fields = seen.need.fields
      if (!Predicate.isTagged(fields, 'Error')) throw new Error('not an error need')
      expect(fields.proposals).toEqual(['Retry'])
      expect(fields.attempts.map((one) => one.output).join('\n')).toMatch(/rejected/)
      expect(remoteHead('api', seen.branch)).toBe(seen.head)
      expect(seen.journal.some((line) => /rejected/.test(line))).toBe(true)
    },
    SLOW,
  )

  test(
    'a remote that refuses the push with a secret in its message: the need and the Journal hold it masked',
    async () => {
      const hook = join(bareOf('api'), 'hooks', 'pre-receive')
      const { run } = engine()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const mission = yield* launchedOnForge()
            mkdirSync(join(bareOf('api'), 'hooks'), { recursive: true })
            writeFileSync(
              hook,
              `#!/bin/sh\necho "protected branch: ask for ${TOKEN}" >&2\nexit 1\n`,
            )
            chmodSync(hook, 0o755)
            writeFileSync(join(mission.api, 'notes.ts'), 'export const notes = 1\n')
            yield* moved(mission.missionId, 'endBuilding')
            yield* untilState(mission.missionId, 'api', 'failed')
            return {
              failed: repositoryOf(yield* pushesOf(mission.missionId), 'api'),
              need: yield* needOf(mission.missionId, 'Error'),
              journal: yield* journalOf(mission.missionId),
            }
          }),
        ),
      )
      expect(seen.failed?.message).toMatch(/protected branch/)
      for (const text of [
        seen.failed?.message ?? '',
        JSON.stringify(seen.need.fields),
        seen.journal.join('\n'),
      ]) {
        expect(text).not.toContain(TOKEN)
      }
      expect(seen.journal.some((line) => /protected branch/.test(line))).toBe(true)
    },
    SLOW,
  )

  test(
    'git push from an agent session is still refused, while Hemera’s push runs',
    async () => {
      const { run } = engine()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const mission = yield* launchedOnForge()
            const refused = yield* call(mission.grantId, 'commands_run', {
              line: 'git push',
              repository: 'api',
            })
            writeFileSync(join(mission.api, 'notes.ts'), 'export const notes = 1\n')
            yield* moved(mission.missionId, 'endBuilding')
            yield* untilState(mission.missionId, 'api', 'done')
            return { refused, head: git(mission.api, 'rev-parse', 'HEAD'), branch: mission.branch }
          }),
        ),
      )
      expect(seen.refused).toBe('refused: no agent of a mission may run git push')
      expect(remoteHead('api', seen.branch)).toBe(seen.head)
    },
    SLOW,
  )

  test(
    'an upstream an agent pointed at another path does not change where Hemera pushes',
    async () => {
      const elsewhere = join(work, 'remotes', 'elsewhere.git')
      const { run } = engine()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const mission = yield* launchedOnForge()
            mkdirSync(elsewhere, { recursive: true })
            git(elsewhere, 'init', '-q', '--bare')
            // What `git push -u` or an agent writes: the branch's upstream, at another path.
            git(mission.api, 'config', `branch.${mission.branch}.remote`, elsewhere)
            git(mission.api, 'config', `branch.${mission.branch}.merge`, 'refs/heads/other')
            writeFileSync(join(mission.api, 'notes.ts'), 'export const notes = 1\n')
            yield* moved(mission.missionId, 'endBuilding')
            yield* untilState(mission.missionId, 'api', 'done')
            return { head: git(mission.api, 'rev-parse', 'HEAD'), branch: mission.branch }
          }),
        ),
      )
      expect(remoteHead('api', seen.branch)).toBe(seen.head)
      expect(git(work, 'ls-remote', elsewhere)).toBe('')
    },
    SLOW,
  )

  test.each([
    {
      how: 'pointed at main by git symbolic-ref',
      move: (api: string) => git(api, 'symbolic-ref', 'HEAD', `refs/heads/${DEFAULT_BASE_BRANCH}`),
      back: (api: string, branch: string) =>
        git(api, 'symbolic-ref', 'HEAD', `refs/heads/${branch}`),
      said: /names main, not the mission’s branch/,
    },
    {
      how: 'renamed by git branch -m',
      move: (api: string, branch: string) => git(api, 'branch', '-m', branch, 'renamed'),
      back: (api: string, branch: string) => git(api, 'branch', '-m', 'renamed', branch),
      said: /names renamed, not the mission’s branch/,
    },
    {
      how: 'detached by git update-ref --no-deref',
      move: (api: string) => git(api, 'update-ref', '--no-deref', 'HEAD', 'HEAD'),
      back: (api: string, branch: string) =>
        git(api, 'symbolic-ref', 'HEAD', `refs/heads/${branch}`),
      said: /is detached, not on the mission’s branch/,
    },
  ])(
    'a HEAD an agent $how: nothing is committed or pushed, the error need says why; back on the branch, Retry pushes it',
    async ({ move, back, said }) => {
      const { run } = engine()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const mission = yield* launchedOnForge()
            writeFileSync(join(mission.api, 'notes.ts'), 'export const notes = 1\n')
            const base = `refs/heads/${DEFAULT_BASE_BRANCH}`
            const before = {
              main: git(mission.api, 'rev-parse', base),
              remoteMain: remoteHead('api', DEFAULT_BASE_BRANCH),
            }
            // None of these is refused to an agent (the gate refuses checkout, switch and reset).
            move(mission.api, mission.branch)
            yield* moved(mission.missionId, 'endBuilding')
            yield* untilState(mission.missionId, 'api', 'failed')
            const need = yield* needOf(mission.missionId, 'Error')
            const database = yield* Database
            const commits = yield* database
              .select({ state: effectfulActions.state })
              .from(effectfulActions)
              .where(eq(effectfulActions.kind, 'delivery.commit'))
            const during = {
              main: git(mission.api, 'rev-parse', base),
              remoteMain: remoteHead('api', DEFAULT_BASE_BRANCH),
              remoteBranch: remoteHead('api', mission.branch),
              remoteRenamed: remoteHead('api', 'renamed'),
              commits: commits.length,
            }
            back(mission.api, mission.branch)
            yield* chosen(need, 'Retry')
            yield* untilState(mission.missionId, 'api', 'done')
            return {
              before,
              during,
              need,
              main: git(mission.api, 'rev-parse', base),
              head: git(mission.api, 'rev-parse', `refs/heads/${mission.branch}`),
              branch: mission.branch,
            }
          }),
        ),
      )
      expect(seen.during).toEqual({
        ...seen.before,
        remoteBranch: null,
        remoteRenamed: null,
        commits: 0,
      })
      const fields = seen.need.fields
      if (!Predicate.isTagged(fields, 'Error')) throw new Error('not an error need')
      expect(fields.failed).toMatch(said)
      expect(fields.failed).toContain(seen.branch)
      expect(fields.proposals).toEqual(['Retry'])
      expect(seen.main).toBe(seen.before.main)
      expect(remoteHead('api', DEFAULT_BASE_BRANCH)).toBe(seen.before.remoteMain)
      expect(remoteHead('api', seen.branch)).toBe(seen.head)
    },
    SLOW,
  )

  test(
    'one repository failing does not stop the other',
    async () => {
      const { run } = engine()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const mission = yield* launchedOnForge()
            const hook = join(bareOf('web'), 'hooks', 'pre-receive')
            mkdirSync(join(bareOf('web'), 'hooks'), { recursive: true })
            writeFileSync(hook, '#!/bin/sh\necho "web is frozen" >&2\nexit 1\n')
            chmodSync(hook, 0o755)
            writeFileSync(join(mission.api, 'notes.ts'), 'export const notes = 1\n')
            writeFileSync(join(mission.web, 'page.ts'), 'export const page = 1\n')
            yield* moved(mission.missionId, 'endBuilding')
            yield* untilState(mission.missionId, 'web', 'failed')
            yield* untilState(mission.missionId, 'api', 'done')
            return {
              pushes: yield* pushesOf(mission.missionId),
              api: git(mission.api, 'rev-parse', 'HEAD'),
              branch: mission.branch,
            }
          }),
        ),
      )
      expect(repositoryOf(seen.pushes, 'web')?.message).toMatch(/web is frozen/)
      expect(remoteHead('api', seen.branch)).toBe(seen.api)
      expect(remoteHead('web', seen.branch)).toBeNull()
      expect(repositoryOf(seen.pushes, 'api')?.pullRequest?.number).toBe(1)
    },
    SLOW,
  )
})

describe('A step on a click', () => {
  test(
    'a click step creates one decision need; until it is answered nothing is pushed; Push pushes',
    async () => {
      const { run } = engine()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const mission = yield* launchedOnForge(null)
            writeFileSync(join(mission.api, 'notes.ts'), 'export const notes = 1\n')
            writeFileSync(join(mission.web, 'page.ts'), 'export const page = 1\n')
            yield* moved(mission.missionId, 'endBuilding')
            const need = yield* needOf(mission.missionId, 'Decision')
            const waiting = yield* pushesOf(mission.missionId)
            const decisions = (yield* pendingOf(mission.missionId, 'Decision')).length
            const before = {
              api: remoteHead('api', mission.branch),
              commits: commitsSinceBase(mission.api).length,
            }
            yield* chosen(need, 'Push')
            yield* untilState(mission.missionId, 'api', 'done')
            yield* untilState(mission.missionId, 'web', 'done')
            return {
              need,
              waiting,
              decisions,
              before,
              head: git(mission.api, 'rev-parse', 'HEAD'),
              branch: mission.branch,
            }
          }),
        ),
      )
      expect(seen.decisions).toBe(1)
      const fields = seen.need.fields
      if (!Predicate.isTagged(fields, 'Decision')) throw new Error('not a decision')
      expect(fields.question).toBe('Push and open the pull requests for api, web?')
      expect(fields.options).toEqual(['Push', 'Not now'])
      expect(fields.recommended?.option).toBe('Push')
      expect(seen.waiting.repositories.map((one) => one.state)).toEqual([
        'waiting-for-click',
        'waiting-for-click',
      ])
      expect(seen.before).toEqual({ api: null, commits: 0 })
      expect(remoteHead('api', seen.branch)).toBe(seen.head)
    },
    SLOW,
  )

  test(
    'answered “not now”, the step is not run; the next return to Review asks again',
    async () => {
      const { run } = engine()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const mission = yield* launchedOnForge(null)
            writeFileSync(join(mission.api, 'notes.ts'), 'export const notes = 1\n')
            yield* moved(mission.missionId, 'endBuilding')
            const first = yield* needOf(mission.missionId, 'Decision')
            yield* chosen(first, 'Not now')
            yield* untilState(mission.missionId, 'api', 'declined')
            const declined = remoteHead('api', mission.branch)
            yield* moved(mission.missionId, 'fix')
            yield* moved(mission.missionId, 'endBuilding')
            const second = yield* needOf(mission.missionId, 'Decision')
            return { first, second, declined, api: mission.api }
          }),
        ),
      )
      expect(seen.declined).toBeNull()
      expect(seen.second.id).not.toBe(seen.first.id)
      expect(commitsSinceBase(seen.api)).toEqual([])
    },
    SLOW,
  )

  test(
    'with the drafts reviewed, the need shows each repository’s rendered title, body and reviewers',
    async () => {
      const { run } = engine()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const reviewed = rulesWith((draft) =>
              withApiTemplates(['grace'])({
                ...draft,
                preparation: {
                  ...draft.preparation,
                  reviewDrafts: true,
                  presets: { ...draft.preparation.presets, application: PUSH_STACK('click') },
                },
              }),
            )
            const mission = yield* launchedOnForge(reviewed)
            writeFileSync(join(mission.api, 'notes.ts'), 'export const notes = 1\n')
            yield* moved(mission.missionId, 'endBuilding')
            const need = yield* needOf(mission.missionId, 'Decision')
            return { need, key: (yield* getMission(mission.missionId)).key }
          }),
        ),
      )
      const fields = seen.need.fields
      if (!Predicate.isTagged(fields, 'Decision')) throw new Error('not a decision')
      expect(fields.question).toContain(`[${seen.key}] Invoices exports`)
      expect(fields.question).toContain('Reviewers: grace')
      expect(fields.question).toContain('Summary:')
    },
    SLOW,
  )
})

describe('The pull request', () => {
  test(
    'opened from the templates: base, head, title, body and reviewers; the description is written once',
    async () => {
      const { run } = engine()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const mission = yield* launchedOnForge(rulesWith(withApiTemplates()))
            writeFileSync(join(mission.api, 'notes.ts'), 'export const notes = 1\n')
            yield* moved(mission.missionId, 'endBuilding')
            yield* untilState(mission.missionId, 'api', 'done')
            yield* moved(mission.missionId, 'fix')
            writeFileSync(join(mission.api, 'notes.ts'), 'export const notes = 2\n')
            yield* moved(mission.missionId, 'endBuilding')
            const head = () => git(mission.api, 'rev-parse', 'HEAD')
            yield* until(
              Effect.map(
                pushesOf(mission.missionId),
                (pushes) => repositoryOf(pushes, 'api')?.pullRequest?.head === head(),
              ),
              60_000,
            )
            return {
              key: (yield* getMission(mission.missionId)).key,
              branch: mission.branch,
              push: repositoryOf(yield* pushesOf(mission.missionId), 'api'),
              journal: yield* journalOf(mission.missionId),
            }
          }),
        ),
      )
      const opened = forge.pullRequests().filter((one) => one.repo === 'acme/api')
      expect(opened).toHaveLength(1)
      expect(opened[0]?.base).toBe(DEFAULT_BASE_BRANCH)
      expect(opened[0]?.head).toBe(seen.branch)
      expect(opened[0]?.title).toBe(`[${seen.key}] Invoices exports`)
      expect(opened[0]?.body).toContain('Slug: ')
      expect(opened[0]?.reviewers).toBe('grace,acme/core')
      // Only gh's own edits would change the description: none was asked.
      expect(forge.fake.calls().some((one) => one.args[1] === 'edit')).toBe(false)
      expect(seen.push?.pullRequest?.url).toBe(`https://${HOST}/acme/api/pull/1`)
      expect(seen.journal.some((line) => line.includes(`https://${HOST}/acme/api/pull/1`))).toBe(
        true,
      )
    },
    SLOW,
  )

  test(
    'gh signed out while pushing: the push goes on, the pull request waits for gh',
    async () => {
      const { run } = engine()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const mission = yield* launchedOnForge()
            forge.answer(ghSignedOut(HOST))
            writeFileSync(join(mission.api, 'notes.ts'), 'export const notes = 1\n')
            yield* moved(mission.missionId, 'endBuilding')
            yield* untilState(mission.missionId, 'api', 'waiting-for-cli')
            const waiting = repositoryOf(yield* pushesOf(mission.missionId), 'api')
            const pushed = remoteHead('api', mission.branch)
            // Signed in again: Check again lets the pull request go.
            forge.answer([])
            yield* ForgePort.use((port) => port.checkAgain(mission.projectId, null))
            yield* untilState(mission.missionId, 'api', 'done')
            return { waiting, pushed, head: git(mission.api, 'rev-parse', 'HEAD') }
          }),
        ),
      )
      expect(seen.pushed).toBe(seen.head)
      expect(seen.waiting?.waitingFor).toBe('gh')
      expect(seen.waiting?.step).toBe('pull-request')
      expect(forge.creates()).toBe(1)
    },
    SLOW,
  )

  test(
    'pullRequest.status reads the state, the head, the review decision and the approvals',
    async () => {
      const { run } = engine()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const mission = yield* launchedOnForge()
            writeFileSync(join(mission.api, 'notes.ts'), 'export const notes = 1\n')
            yield* moved(mission.missionId, 'endBuilding')
            yield* untilState(mission.missionId, 'api', 'done')
            const kept = join(forge.folder, 'prs.json')
            writeFileSync(
              kept,
              JSON.stringify(
                forge.pullRequests().map((one) => Object.assign({}, one, { approved: true })),
              ),
            )
            const repositoryId = (yield* pushesOf(mission.missionId)).repositories.find(
              (one) => one.repository === 'api',
            )?.repositoryId
            const status = yield* pullRequestStatus(repositoryId ?? '', 1)
            return { status, head: git(mission.api, 'rev-parse', 'HEAD') }
          }),
        ),
      )
      expect(seen.status).toEqual({
        forge: 'github',
        host: HOST,
        number: 1,
        url: `https://${HOST}/acme/api/pull/1`,
        state: 'open',
        head: seen.head,
        reviewDecision: 'APPROVED',
        approvals: [{ login: 'grace' }],
      })
    },
    SLOW,
  )
})

describe('Retry and restart', () => {
  /** A whole push of `api` with the sequence stopped at `moment`, then an engine started again. */
  const stoppedThenRestarted = async (moment: PushMoment) => {
    const calls: GitCalls = []
    const stop = stopAt(moment)
    const { run } = engine({ hold: stop.hold, git: recording(calls) })
    const mission = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const launchedOne = yield* launchedOnForge()
          writeFileSync(join(launchedOne.api, 'notes.ts'), 'export const notes = 1\n')
          yield* moved(launchedOne.missionId, 'endBuilding')
          yield* stop.reached
          return launchedOne
        }),
      ),
    )
    const before = { pushes: pushCalls(calls).length, creates: forge.creates() }
    const { run: again } = engine({ git: recording(calls) })
    const after = await again(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          yield* untilState(mission.missionId, 'api', 'done')
          const database = yield* Database
          const actions = yield* database.select().from(effectfulActions)
          return {
            pushes: yield* pushesOf(mission.missionId),
            actions: actions
              .filter((one) => one.kind.startsWith('delivery.'))
              .map((one) => ({ kind: one.kind, state: one.state })),
          }
        }),
      ),
    )
    return { mission, before, after, calls }
  }

  test(
    'Retry after a crash between push and pull request: the push is not redone, the pull request is created once',
    async () => {
      const { mission, before, after, calls } = await stoppedThenRestarted('pushed')
      expect(before).toEqual({ pushes: 1, creates: 0 })
      expect(pushCalls(calls)).toHaveLength(1)
      expect(forge.creates()).toBe(1)
      expect(repositoryOf(after.pushes, 'api')?.pullRequest?.number).toBe(1)
      expect(remoteHead('api', mission.branch)).toBe(git(mission.api, 'rev-parse', 'HEAD'))
    },
    SLOW,
  )

  test.each([
    ['committing', { commits: 1, pushes: 1, creates: 1 }],
    ['committed', { commits: 1, pushes: 1, creates: 1 }],
    ['pushing', { commits: 1, pushes: 1, creates: 1 }],
    ['pushed', { commits: 1, pushes: 1, creates: 1 }],
    ['creating', { commits: 1, pushes: 1, creates: 1 }],
    ['opened', { commits: 1, pushes: 1, creates: 1 }],
  ] as const)(
    'a restart after %s resumes and does nothing twice',
    async (moment, expected) => {
      const { mission, after, calls } = await stoppedThenRestarted(moment)
      expect({
        commits: commitsSinceBase(mission.api).length,
        pushes: pushCalls(calls).length,
        creates: forge.creates(),
      }).toEqual(expected)
      expect(remoteHead('api', mission.branch)).toBe(git(mission.api, 'rev-parse', 'HEAD'))
      expect(repositoryOf(after.pushes, 'api')?.state).toBe('done')
      // Each intent left without an outcome was checked and recorded as found.
      expect(
        after.actions.filter((one) => one.state === 'started' || one.state === 'indeterminate'),
      ).toEqual([])
    },
    SLOW,
  )

  test.each(['commit', 'push'] as const)(
    'a restart after git %s ran, its outcome unwritten: found done, not done again',
    async (word) => {
      const calls: GitCalls = []
      const reached = Effect.runSync(Deferred.make<void>())
      // The engine stops as Git returns, before the outcome is written.
      const cutAfter =
        (real: GitBytesSpawn): GitBytesSpawn =>
        (folder, args, kind, options) => {
          calls.push(args)
          const ran = real(folder, args, kind, options)
          return args[0] === word
            ? ran.pipe(
                Effect.andThen(Deferred.succeed(reached, undefined)),
                Effect.andThen(Effect.never),
              )
            : ran
        }
      const { run } = engine({ git: cutAfter })
      const mission = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const launchedOne = yield* launchedOnForge()
            writeFileSync(join(launchedOne.api, 'notes.ts'), 'export const notes = 1\n')
            yield* moved(launchedOne.missionId, 'endBuilding')
            yield* Deferred.await(reached)
            return launchedOne
          }),
        ),
      )
      const { run: again } = engine({ git: recording(calls) })
      const actions = await again(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            yield* untilState(mission.missionId, 'api', 'done')
            const database = yield* Database
            return yield* database
              .select({ kind: effectfulActions.kind, state: effectfulActions.state })
              .from(effectfulActions)
              .where(eq(effectfulActions.kind, `delivery.${word}`))
          }),
        ),
      )
      expect(actions).toEqual([{ kind: `delivery.${word}`, state: 'done' }])
      expect(calls.filter((args) => args[0] === word)).toHaveLength(1)
      expect(commitsSinceBase(mission.api)).toHaveLength(1)
      expect(remoteHead('api', mission.branch)).toBe(git(mission.api, 'rev-parse', 'HEAD'))
      expect(forge.creates()).toBe(1)
    },
    SLOW,
  )

  test(
    'a create whose outcome is unknown is checked by a find before any new create; unread, it stays indeterminate',
    async () => {
      const { run } = engine()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const mission = yield* launchedOnForge()
            // The create reaches the forge, then its CLI is cut before it answers, and the forge
            // cannot be read any more.
            writeFileSync(join(forge.folder, 'kill-after-create'), 'and-lists-fail')
            writeFileSync(join(mission.api, 'notes.ts'), 'export const notes = 1\n')
            yield* moved(mission.missionId, 'endBuilding')
            yield* untilState(mission.missionId, 'api', 'indeterminate')
            const cut = repositoryOf(yield* pushesOf(mission.missionId), 'api')
            // Still unread: Retry finds nothing out, and creates nothing.
            yield* Pushes.use((pushes) => pushes.retry(mission.missionId, 'api'))
            yield* untilState(mission.missionId, 'api', 'indeterminate')
            const unread = repositoryOf(yield* pushesOf(mission.missionId), 'api')
            const createsUnread = forge.creates()
            rmSync(join(forge.folder, 'lists-fail'))
            yield* Pushes.use((pushes) => pushes.retry(mission.missionId, 'api'))
            yield* untilState(mission.missionId, 'api', 'done')
            return {
              cut,
              unread,
              createsUnread,
              done: repositoryOf(yield* pushesOf(mission.missionId), 'api'),
              // Each Retry withdrew the need it answered: none is left once it is done.
              errors: (yield* pendingOf(mission.missionId, 'Error')).length,
            }
          }),
        ),
      )
      expect(seen.cut?.step).toBe('pull-request')
      expect(seen.cut?.message).toMatch(/error connecting/)
      expect(seen.unread?.message).toMatch(/error connecting/)
      expect(seen.createsUnread).toBe(1)
      expect(forge.creates()).toBe(1)
      expect(seen.done?.pullRequest?.number).toBe(1)
      expect(seen.errors).toBe(0)
    },
    SLOW,
  )
})

describe('What stops a push', () => {
  test(
    'a missing user.email gives the environment need with the command; once set, Retry pushes',
    async () => {
      // The user's global configuration, as Git reads it for the pushes: a name, no email.
      const global = join(work, 'user.gitconfig')
      writeFileSync(global, '[user]\n\tname = Ada Lovelace\n')
      const { run } = engine({ git: withoutUserConfig(global) })
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const mission = yield* launchedOnForge(rulesWith(), false)
            writeFileSync(join(mission.api, 'notes.ts'), 'export const notes = 1\n')
            yield* moved(mission.missionId, 'endBuilding')
            const need = yield* needOf(mission.missionId, 'Environment')
            const before = remoteHead('api', mission.branch)
            writeFileSync(global, '[user]\n\tname = Ada Lovelace\n\temail = ada@example.com\n')
            yield* retryNeed(need.id)
            yield* untilState(mission.missionId, 'api', 'done')
            return { need, before, head: git(mission.api, 'rev-parse', 'HEAD'), mission }
          }),
        ),
      )
      const fields = seen.need.fields
      if (!Predicate.isTagged(fields, 'Environment')) throw new Error('not an environment need')
      expect(fields.action).toBe('git config --global user.email "you@example.com"')
      expect(seen.before).toBeNull()
      expect(remoteHead('api', seen.mission.branch)).toBe(seen.head)
      expect(commitsSinceBase(seen.mission.api)[0]).toMatch(/\|Ada Lovelace\|ada@example\.com$/)
    },
    SLOW,
  )

  test.each([
    ['an untracked', 'Keep them out', false],
    ['an untracked', 'Push them anyway', true],
    ['a staged', 'Keep them out', false],
    ['a staged', 'Push them anyway', true],
  ] as const)(
    '%s .env stops the push with the decision need; “%s”',
    async (how, option, committed) => {
      const { run } = engine()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const mission = yield* launchedOnForge()
            writeFileSync(join(mission.api, '.env'), 'API_KEY=1\n')
            writeFileSync(join(mission.api, 'notes.ts'), 'export const notes = 1\n')
            // An agent's `git add -A`: the gate refuses no add.
            if (how === 'a staged') git(mission.api, 'add', '-A')
            yield* moved(mission.missionId, 'endBuilding')
            const need = yield* needOf(mission.missionId, 'Decision')
            const before = remoteHead('api', mission.branch)
            yield* chosen(need, option)
            yield* untilState(mission.missionId, 'api', 'done')
            const database = yield* Database
            const commits = yield* database
              .select({ state: effectfulActions.state })
              .from(effectfulActions)
              .where(eq(effectfulActions.kind, 'delivery.commit'))
            return {
              need,
              before,
              commits: commits.map((one) => one.state),
              files: git(mission.api, 'show', '--name-only', '--format=', 'HEAD').split('\n'),
              status: git(mission.api, 'status', '--porcelain'),
              ignore: readFileSync(join(mission.api, '.gitignore'), 'utf8'),
            }
          }),
        ),
      )
      const fields = seen.need.fields
      if (!Predicate.isTagged(fields, 'Decision')) throw new Error('not a decision')
      expect(fields.question).toContain('.env')
      expect(fields.options).toEqual(['Push them anyway', 'Keep them out'])
      expect(seen.before).toBeNull()
      expect(seen.files.includes('.env')).toBe(committed)
      expect(seen.files.includes('notes.ts')).toBe(true)
      expect(seen.status).toBe(committed ? '' : '?? .env')
      // The checkout's own line endings (CRLF under Git for Windows): nothing was appended.
      expect(seen.ignore.replaceAll('\r\n', '\n')).toBe('*.log\n')
      // One commit, whose tree was the one expected: no attempt went wrong on the way.
      expect(seen.commits).toEqual(['done'])
    },
    SLOW,
  )

  test.each([
    ['Keep them out', false],
    ['Push them anyway', true],
  ] as const)(
    'a .env an agent committed on the branch stops the push with the decision need; “%s”',
    async (option, pushed) => {
      const { run } = engine()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const mission = yield* launchedOnForge()
            writeFileSync(join(mission.api, '.env'), 'API_KEY=1\n')
            writeFileSync(join(mission.api, 'notes.ts'), 'export const notes = 1\n')
            git(mission.api, 'add', '-A')
            git(mission.api, 'commit', '-q', '-m', 'notes')
            yield* moved(mission.missionId, 'endBuilding')
            const need = yield* needOf(mission.missionId, 'Decision')
            const before = remoteHead('api', mission.branch)
            yield* chosen(need, option)
            yield* untilState(mission.missionId, 'api', pushed ? 'done' : 'failed')
            const failed = pushed ? null : yield* needOf(mission.missionId, 'Error')
            return {
              need,
              failed,
              before,
              head: git(mission.api, 'rev-parse', 'HEAD'),
              branch: mission.branch,
              files: git(mission.api, 'show', '--name-only', '--format=', 'HEAD').split('\n'),
            }
          }),
        ),
      )
      const fields = seen.need.fields
      if (!Predicate.isTagged(fields, 'Decision')) throw new Error('not a decision')
      expect(fields.question).toMatch(/already committed on the branch: \.env/)
      expect(fields.options).toEqual(['Push them anyway', 'Keep them out'])
      expect(seen.before).toBeNull()
      // The agent's commit is kept as it is: Hemera rewrites no history.
      expect(seen.files).toContain('.env')
      expect(remoteHead('api', seen.branch)).toBe(pushed ? seen.head : null)
      if (pushed) return
      const failed = seen.failed?.fields
      if (!Predicate.isTagged(failed, 'Error')) throw new Error('not an error need')
      expect(failed.failed).toMatch(/\.env is already committed on the branch/)
      expect(failed.failed).toMatch(/rewrites no history/)
    },
    SLOW,
  )

  test.each([
    {
      how: 'committed then deleted by a later commit',
      make: (mission: { api: string; branch: string }) => {
        writeFileSync(join(mission.api, '.env'), 'API_KEY=1\n')
        git(mission.api, 'add', '-A')
        git(mission.api, 'commit', '-q', '-m', 'env')
        git(mission.api, 'rm', '-q', '.env')
        writeFileSync(join(mission.api, 'notes.ts'), 'export const notes = 1\n')
        git(mission.api, 'add', '-A')
        git(mission.api, 'commit', '-q', '-m', 'notes')
      },
    },
    {
      how: 'carried by an ancestor of a commit an agent set the branch to (git update-ref)',
      make: (mission: { api: string; branch: string }) => {
        // Commits made elsewhere, fetched, and the branch moved onto them: no commit on HEAD.
        const elsewhere = join(work, 'elsewhere')
        git(work, 'clone', '-q', mission.api, elsewhere)
        writeFileSync(join(elsewhere, '.env'), 'API_KEY=1\n')
        git(elsewhere, 'add', '-A')
        git(elsewhere, 'commit', '-q', '-m', 'env')
        git(elsewhere, 'rm', '-q', '.env')
        writeFileSync(join(elsewhere, 'notes.ts'), 'export const notes = 1\n')
        git(elsewhere, 'add', '-A')
        git(elsewhere, 'commit', '-q', '-m', 'notes')
        git(mission.api, 'fetch', '-q', elsewhere, 'HEAD')
        git(mission.api, 'update-ref', `refs/heads/${mission.branch}`, 'FETCH_HEAD')
        writeFileSync(join(mission.api, 'notes.ts'), 'export const notes = 1\n')
      },
    },
  ])(
    'a .env $how stops the first push with the decision need; “Keep them out” pushes nothing',
    async ({ make }) => {
      const { run } = engine()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const mission = yield* launchedOnForge()
            make(mission)
            yield* moved(mission.missionId, 'endBuilding')
            const need = yield* needOf(mission.missionId, 'Decision')
            yield* chosen(need, 'Keep them out')
            yield* untilState(mission.missionId, 'api', 'failed')
            const failed = yield* needOf(mission.missionId, 'Error')
            return {
              need,
              failed,
              branch: mission.branch,
              tip: git(mission.api, 'ls-tree', '-r', '--name-only', 'HEAD').split('\n'),
            }
          }),
        ),
      )
      // The branch's tip no longer holds it: only its history does.
      expect(seen.tip).not.toContain('.env')
      const fields = seen.need.fields
      if (!Predicate.isTagged(fields, 'Decision')) throw new Error('not a decision')
      expect(fields.question).toMatch(/already committed on the branch: \.env/)
      expect(remoteHead('api', seen.branch)).toBeNull()
      const failed = seen.failed.fields
      if (!Predicate.isTagged(failed, 'Error')) throw new Error('not an error need')
      expect(failed.failed).toMatch(/\.env is already committed on the branch/)
    },
    SLOW,
  )

  test(
    'a second push after a round screens only the commits it publishes: a .env pushed in round 1 is not asked again',
    async () => {
      const { run } = engine()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const mission = yield* launchedOnForge()
            writeFileSync(join(mission.api, '.env'), 'API_KEY=1\n')
            writeFileSync(join(mission.api, 'notes.ts'), 'export const notes = 1\n')
            git(mission.api, 'add', '-A')
            git(mission.api, 'commit', '-q', '-m', 'notes')
            yield* moved(mission.missionId, 'endBuilding')
            yield* chosen(yield* needOf(mission.missionId, 'Decision'), 'Push them anyway')
            yield* untilState(mission.missionId, 'api', 'done')
            const first = git(mission.api, 'rev-parse', 'HEAD')
            // A round: Fix, a change, and back into Review.
            yield* moved(mission.missionId, 'fix')
            writeFileSync(join(mission.api, 'notes.ts'), 'export const notes = 2\n')
            yield* moved(mission.missionId, 'endBuilding')
            yield* until(
              Effect.map(
                pushesOf(mission.missionId),
                (pushes) =>
                  repositoryOf(pushes, 'api')?.state === 'done' &&
                  repositoryOf(pushes, 'api')?.commit !== first,
              ),
              60_000,
            )
            return {
              first,
              branch: mission.branch,
              head: git(mission.api, 'rev-parse', 'HEAD'),
              parent: git(mission.api, 'rev-parse', 'HEAD^'),
              asked: yield* pendingOf(mission.missionId, 'Decision'),
            }
          }),
        ),
      )
      expect(seen.parent).toBe(seen.first)
      expect(remoteHead('api', seen.branch)).toBe(seen.head)
      expect(seen.asked).toEqual([])
    },
    SLOW,
  )

  test(
    'the preparation section is copied once, at the first push, with its version in the Journal',
    async () => {
      const { run } = engine()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const mission = yield* launchedOnForge()
            const before = yield* pushesOf(mission.missionId)
            writeFileSync(join(mission.api, 'notes.ts'), 'export const notes = 1\n')
            yield* moved(mission.missionId, 'endBuilding')
            yield* untilState(mission.missionId, 'api', 'done')
            yield* moved(mission.missionId, 'fix')
            writeFileSync(join(mission.api, 'notes.ts'), 'export const notes = 2\n')
            yield* moved(mission.missionId, 'endBuilding')
            const second = () => git(mission.api, 'rev-parse', 'HEAD')
            yield* until(
              Effect.map(
                pushesOf(mission.missionId),
                (pushes) => repositoryOf(pushes, 'api')?.commit === second(),
              ),
              60_000,
            )
            return {
              before,
              after: yield* pushesOf(mission.missionId),
              journal: yield* journalOf(mission.missionId),
            }
          }),
        ),
      )
      expect(seen.before.rulesVersion).toBeNull()
      expect(seen.after.rulesVersion).toBe(1)
      expect(
        seen.journal.filter((line) => line.startsWith('Hemera copied the preparation')),
      ).toEqual(['Hemera copied the preparation of the delivery rules, at version 1.'])
    },
    SLOW,
  )
})
