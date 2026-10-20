/**
 * The images of a pull request's description (R7): the `{images}` of a repository's template
 * becomes Markdown images hosted by the forge through its own CLI (`gh … --attach`), or a list of
 * file names where the forge cannot host them, and each published copy is recorded next to its
 * evidence (CT-54). Only the images the user dropped in feedback or marked publishable are ever
 * sent; a public repository asks first; a partial failure is recorded and a Retry sends only what
 * is missing.
 *
 * On the engine as it starts, with the fake agent of #32 as every agent: Acme's `api` and `web` in
 * temporary folders, each with a bare repository as its remote, under a name that never resolves.
 * The forge is forced per test; `gh` and `bkt` are fakes alone on a `PATH` of their own whose pull
 * requests live in a file, and whose `--attach` uploads a file by rewriting its reference to an
 * asset URL, as gh does (`fake-forge.ts`). No real forge, no network.
 */

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'

import {
  ChosenAnswer,
  DEFAULT_BASE_BRANCH,
  type DeliveryAction,
  type DeliveryRulesDraft,
  defaultDeliveryRules,
} from '@hemera/core/domain'
import {
  AgentAuthor,
  FeedbackUser,
  type MissionPushes,
  type Need,
  type RepositoryPush,
} from '@hemera/ipc'
import { and, desc, eq } from 'drizzle-orm'
import { Deferred, Effect, Predicate } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { saveDeliveryRules } from '../src/engine/delivery-rules.ts'
import { type PushesHold, Pushes } from '../src/engine/delivery/pushes.ts'
import { ForgePort } from '../src/engine/forges/port.ts'
import { type EvidenceContent, putEvidence } from '../src/engine/memory/evidence.ts'
import { missionFolder, missionKeyOf } from '../src/engine/memory/files.ts'
import { getMission, moveIn, moveMission } from '../src/engine/missions.ts'
import { answerNeed, pendingNeedsOf } from '../src/engine/needs.ts'
import { createProject, getProject } from '../src/engine/projects.ts'
import { Review } from '../src/engine/review/feedback.ts'
import { Database } from '../src/engine/storage/database.ts'
import { buildingLaunches, workspaceRepositories } from '../src/engine/storage/schema.ts'
import { mutate } from '../src/engine/transaction.ts'
import { builderAgents, launched } from './builder-world.ts'
import { INVOICES, PACKAGE } from './building-world.ts'
import { type FakeRule, bktReady, fakeForge, ghReady } from './fake-forge.ts'
import { git, remote, repository } from './repositories.ts'
import { HELPER, sessionsEngine, until, within } from './sessions-world.ts'
import { removeFolders, temporaryFolder } from './storage.ts'

/** Every test runs a whole engine, Git and a Builder: far above its time alone (10 to 25 s). */
const SLOW = 180_000

/** The name each remote is written under: `.test` never resolves. */
const REMOTE_HOST = 'git.acme.test'

/** A token of the shape the masking knows, joined at run time: a secret scanner never sees it. */
const TOKEN = ['ghp', '_', 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'].join('')

/** A PNG's first bytes, told apart by its width: each its own evidence file. */
const png = (width: number) =>
  Buffer.from(
    `89504e470d0a1a0a0000000d49484452${width.toString(16).padStart(8, '0')}000001e00806000000`,
    'hex',
  )

/**
 * The fake forge: its pull requests in a file beside it. gh's `pr create` and `pr edit` take
 * `--attach <path>#<alt>`: each file is uploaded (unless `failing` names it, or it is not there),
 * its reference `](./<name>)` in the body rewritten to the asset's URL, and a file not referenced
 * appended as an image; any failed upload ends the call with code 1, the pull request created or
 * edited all the same. `gh api repos/<owner>/<repo>` answers the repository's visibility and the
 * account's push permission. bkt's `pr` commands keep the description it is given.
 */
const FORGE_PROGRAM = String.raw`
const { existsSync, readFileSync, writeFileSync } = require('node:fs')
const { basename, join } = require('node:path')
const config = () => JSON.parse(readFileSync(join(__dirname, 'forge.json'), 'utf8'))
const kept = join(__dirname, 'prs.json')
const read = () => (existsSync(kept) ? JSON.parse(readFileSync(kept, 'utf8')) : [])
const valueOf = (args, flag) => {
  const at = args.indexOf(flag)
  return at < 0 ? undefined : args[at + 1]
}
const valuesOf = (args, flag) => args.flatMap((arg, at) => (arg === flag ? [args[at + 1]] : []))
const headOf = (bare, branch) => {
  const loose = join(bare, 'refs', 'heads', ...branch.split('/'))
  return existsSync(loose) ? readFileSync(loose, 'utf8').trim() : ''
}
const attach = (body, args) => {
  const failed = []
  let text = body
  for (const value of valuesOf(args, '--attach')) {
    const cut = value.indexOf('#')
    const path = cut < 0 ? value : value.slice(0, cut)
    const alt = cut < 0 ? '' : value.slice(cut + 1)
    const name = basename(path)
    if (!existsSync(path) || config().failing.includes(name)) {
      failed.push(name)
      continue
    }
    const url = 'https://github.com/user-attachments/assets/' + name.replace(/\.[a-z]+$/, '')
    const reference = '](./' + name + ')'
    text = text.includes(reference)
      ? text.replaceAll(reference, '](' + url + ')')
      : text + '\n![' + alt + '](' + url + ')'
  }
  return { text, failed }
}
const uploadFailed = (failed) =>
  failed.map((name) => 'failed to upload ' + name + ': HTTP 502 (token ' + config().token + ')').join('\n')
module.exports = (cli, args) => {
  const { bares } = config()
  const prs = read()
  const save = (all) => writeFileSync(kept, JSON.stringify(all))
  if (cli === 'bkt') {
    const repo = (valueOf(args, '--project') ?? valueOf(args, '--workspace') ?? '').toLowerCase() + '/' + valueOf(args, '--repo')
    const shown = (one) => ({
      id: one.number,
      state: one.state,
      links: { html: { href: one.url } },
      source: { commit: { hash: headOf(bares[repo], one.head) } },
      participants: [],
    })
    if (args[1] === 'list') {
      const found = prs.filter((one) => one.repo === repo && one.head === valueOf(args, '--source') && one.state === 'OPEN')
      return { stdout: JSON.stringify(found.map(shown)) }
    }
    if (args[1] === 'create') {
      const number = prs.length + 1
      const created = { repo, number, url: 'https://${REMOTE_HOST}/' + repo + '/pull-requests/' + number, head: valueOf(args, '--source'), base: valueOf(args, '--target'), body: valueOf(args, '--description') ?? '', state: 'OPEN' }
      save([...prs, created])
      return { stdout: JSON.stringify(shown(created)) }
    }
    if (args[1] === 'view') {
      const one = prs.find((pr) => pr.repo === repo && pr.number === Number(args[2]))
      return one === undefined ? { stderr: 'not found', code: 1 } : { stdout: JSON.stringify(shown(one)) }
    }
    return { stderr: 'fake bkt: ' + args.join(' '), code: 1 }
  }
  if (args[0] === 'api') {
    const { visibility, push } = config()
    return { stdout: JSON.stringify({ full_name: args[3].slice('repos/'.length), visibility, private: visibility !== 'public', permissions: { admin: false, push, pull: true } }) }
  }
  const repo = (valueOf(args, '--repo') ?? '').split('/').slice(1).join('/')
  if (args[1] === 'list') {
    const found = prs.filter((one) => one.repo === repo && one.head === valueOf(args, '--head') && one.base === valueOf(args, '--base') && one.state === 'OPEN')
    return { stdout: JSON.stringify(found.map((one) => ({ number: one.number, url: one.url, state: one.state, headRefOid: headOf(bares[repo], one.head) }))) }
  }
  if (args[1] === 'create') {
    const number = prs.length + 1
    const url = 'https://github.com/' + repo + '/pull/' + String(number)
    const { text, failed } = attach(readFileSync(0, 'utf8'), args)
    save([...prs, { repo, number, url, head: valueOf(args, '--head'), base: valueOf(args, '--base'), body: text, state: 'OPEN' }])
    return failed.length === 0 ? { stdout: url + '\n' } : { stdout: url + '\n', stderr: uploadFailed(failed), code: 1 }
  }
  if (args[1] === 'edit') {
    const one = prs.find((pr) => pr.repo === repo && pr.number === Number(args[2]))
    if (one === undefined) return { stderr: 'no pull requests found', code: 1 }
    const given = args.includes('--body-file') ? readFileSync(0, 'utf8') : one.body
    const { text, failed } = attach(given, args)
    one.body = text
    save(prs)
    return failed.length === 0 ? { stdout: one.url + '\n' } : { stdout: one.url + '\n', stderr: uploadFailed(failed), code: 1 }
  }
  if (args[1] === 'view') {
    const one = prs.find((pr) => pr.repo === repo && pr.number === Number(args[2]))
    if (one === undefined) return { stderr: 'no pull requests found', code: 1 }
    return { stdout: JSON.stringify({ number: one.number, url: one.url, state: one.state, headRefOid: headOf(bares[repo], one.head), body: one.body, reviewDecision: 'REVIEW_REQUIRED', latestReviews: [] }) }
  }
  return { stderr: 'fake gh: ' + args.join(' '), code: 1 }
}
`

/** How the forge is set for a test. */
interface ForgeSetting {
  readonly forge: 'github' | 'bitbucket-datacenter'
  readonly host: string
  readonly version: string
  readonly visibility: 'public' | 'private'
  readonly push: boolean
  /** The files whose upload fails. */
  readonly failing: ReadonlyArray<string>
}

const GITHUB: ForgeSetting = {
  forge: 'github',
  host: 'github.com',
  version: '2.100.0',
  visibility: 'private',
  push: true,
  failing: [],
}

let data: string
let work: string
let folder: string
let setting: ForgeSetting

const bareOf = (name: string) => join(work, 'remotes', `${name}.git`)

const forgeRules = (program: string): ReadonlyArray<FakeRule> =>
  setting.forge === 'github'
    ? [
        ...ghReady(setting.host, setting.version),
        { cli: 'gh', when: ['repos/'], program },
        { cli: 'gh', when: ['pr'], program },
      ]
    : [
        ...bktReady([{ base: `https://${setting.host}`, kind: 'dc' }]).filter(
          (rule) => !rule.when.includes('pr'),
        ),
        { cli: 'bkt', when: ['pr'], program },
      ]

/** Sets the forge (its answers read at each call). */
const configure = (next: ForgeSetting) => {
  setting = next
  writeFileSync(
    join(folder, 'forge.json'),
    JSON.stringify({
      bares: { 'acme/api': bareOf('api'), 'acme/web': bareOf('web') },
      visibility: next.visibility,
      push: next.push,
      failing: next.failing,
      token: TOKEN,
    }),
  )
}

let fake: ReturnType<typeof fakeForge>

beforeEach(() => {
  data = temporaryFolder('delivery-images')
  work = temporaryFolder('delivery-images-work')
  folder = temporaryFolder('delivery-images-forge')
  writeFileSync(join(folder, 'forge.cjs'), FORGE_PROGRAM)
  configure(GITHUB)
  fake = fakeForge(forgeRules(join(folder, 'forge.cjs')))
})
afterEach(removeFolders)

/** Sets the forge, its CLI's rules with it. */
const forgeIs = (next: ForgeSetting) => {
  configure(next)
  fake.answer(forgeRules(join(folder, 'forge.cjs')))
}

const pullRequests = (): ReadonlyArray<{ readonly repo: string; readonly body: string }> => {
  const kept = join(folder, 'prs.json')
  const all: Array<{ repo: string; body: string }> = existsSync(kept)
    ? JSON.parse(readFileSync(kept, 'utf8'))
    : []
  // gh reads the body from the standard input, which ends with a newline.
  for (const one of all) one.body = one.body.trimEnd()
  return all
}

/** The calls of a CLI's `pr <verb>`. */
const prCalls = (verb: string) =>
  fake.calls().filter((one) => one.args[0] === 'pr' && one.args[1] === verb)

/** Each `--attach` value of a call, its path cut down to its file name. */
const attached = (args: ReadonlyArray<string>) =>
  args.flatMap((arg, at) => {
    if (arg !== '--attach') return []
    const value = args[at + 1] ?? ''
    const cut = value.indexOf('#')
    return [`${basename(value.slice(0, cut))}#${value.slice(cut + 1)}`]
  })

const engine = (hold?: PushesHold) =>
  sessionsEngine(data, builderAgents, {
    roles: [HELPER],
    tools: { home: work },
    building: { outside: { compareEveryMillis: 3_600_000, baseEveryMillis: 3_600_000 } },
    forge: { env: fake.env },
    delivery: { hold },
  })

/** The push and the pull request on a click: the feedback is given in Review, before Push. */
const STACK: ReadonlyArray<DeliveryAction> = [
  { id: 'commit', kind: 'commit-by-hemera', mode: 'auto' },
  { id: 'push', kind: 'push', mode: 'click' },
  { id: 'pull-request', kind: 'pull-request', mode: 'click' },
]

/** `api`'s preparation: the stack above and a body with `{images}`; `web` delivers nothing. */
const rules = (body: string, api: string): DeliveryRulesDraft => {
  const draft = defaultDeliveryRules()
  return {
    ...draft,
    preparation: {
      ...draft.preparation,
      presets: { ...draft.preparation.presets, application: STACK },
      repositories: [
        {
          repositoryId: api,
          commitTemplate: '{key}: {title}',
          pullRequestTitle: '[{key}] {title}',
          pullRequestBody: body,
          reviewers: [],
          requireApproval: false,
          steps: { off: [], changed: [], added: [] },
        },
      ],
    },
  }
}

const BODY = 'What changed.\n\n{images}\n\nThe end.'

/** Acme with `api` and `web`, each on its bare remote under the name that never resolves. */
const acme = (at: string) =>
  Effect.gen(function* () {
    const main = join(at, 'acme')
    for (const name of ['api', 'web']) {
      const one = repository(join(main, name), DEFAULT_BASE_BRANCH)
      writeFileSync(join(one, 'README.md'), `Acme ${name}\n`)
      if (name === 'api') {
        writeFileSync(join(one, 'invoices.ts'), INVOICES)
        writeFileSync(join(one, 'package.json'), PACKAGE)
      }
      git(one, 'add', '.')
      git(one, 'commit', '-q', '-m', 'readme')
      const bare = remote(one, bareOf(name))
      const named = `https://${REMOTE_HOST}/acme/${name}.git`
      git(one, 'remote', 'set-url', 'origin', named)
      git(one, 'config', `url.${bare.replaceAll('\\', '/')}.pushInsteadOf`, named)
      git(one, 'config', 'user.name', 'Ada Lovelace')
      git(one, 'config', 'user.email', 'ada@example.com')
    }
    const project = yield* createProject({
      name: 'acme',
      mainCheckout: main,
      repositories: ['api', 'web'],
    })
    return { project, main }
  })

/** The forge forced as set, the rules saved with `api`'s body. */
const onForge = (body: string) => (projectId: string) =>
  Effect.gen(function* () {
    const project = yield* getProject(projectId)
    const port = yield* ForgePort
    for (const one of project.repositories) {
      yield* port.setForced(project.id, one.id, setting.forge, setting.host)
    }
    const api = project.repositories.find((one) => one.path === 'api')?.id ?? ''
    yield* saveDeliveryRules(project.id, rules(body, api), 0)
  }).pipe(Effect.orDie)

const pushesOf = (missionId: string) => Pushes.use((pushes) => pushes.pushes(missionId))

const apiOf = (pushes: MissionPushes): RepositoryPush | null =>
  pushes.repositories.find((one) => one.repository === 'api') ?? null

const untilApi = (missionId: string, state: RepositoryPush['state']) =>
  until(
    Effect.map(pushesOf(missionId), (pushes) => apiOf(pushes)?.state === state),
    60_000,
  )

/** Waits until `api` is done again at a commit after `first`: the next round pushed. */
const untilPushedAgain = (missionId: string, first: string | null) =>
  until(
    Effect.map(pushesOf(missionId), (pushes) => {
      const api = apiOf(pushes)
      return api?.state === 'done' && api.commit !== first
    }),
    60_000,
  )

const decisions = (missionId: string) =>
  Effect.map(pendingNeedsOf([missionId]), (all) =>
    (all.get(missionId) ?? []).filter((need) => Predicate.isTagged(need.fields, 'Decision')),
  )

/** Waits for a pending decision of the mission whose question holds `words`. */
const decisionSaying = (missionId: string, words: string) =>
  Effect.gen(function* () {
    const holding = (need: Need) =>
      Predicate.isTagged(need.fields, 'Decision') && need.fields.question.includes(words)
    yield* until(
      Effect.map(decisions(missionId), (found) => found.some(holding)),
      60_000,
    )
    const found = (yield* decisions(missionId)).find(holding)
    if (found === undefined) return yield* Effect.die(new Error(`no decision on ${words}`))
    return found
  })

const chosen = (need: Need, option: string) =>
  answerNeed({ id: need.id, key: `answer-${need.id}`, answer: ChosenAnswer.make({ option }) })

/** The mission moved as a Building's end moves it into Review, or as Fix does. */
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

/** An image dropped in a feedback of the user's, its first line the alt text. */
interface Dropped {
  readonly name: string
  readonly bytes: Buffer
  readonly feedback: string
}

/**
 * Acme's mission launched, `api` changed, in Review with the push waiting for its click: `before`
 * runs before the Building ends, then each image is dropped in a feedback of its own. Answers the
 * mission, its `api` folder, its evidence folder and the images' evidence ids.
 */
const inReview = <R = never>(
  body: string,
  images: ReadonlyArray<Dropped>,
  before: (missionId: string) => Effect.Effect<void, never, R> = () => Effect.void,
) =>
  Effect.gen(function* () {
    const { mission } = yield* launched(
      work,
      onForge(body),
      'It touches api, nothing else.',
      undefined,
      acme,
    )
    const database = yield* Database
    const [launch] = yield* database
      .select({ workspaceId: buildingLaunches.workspaceId })
      .from(buildingLaunches)
      .where(eq(buildingLaunches.missionId, mission.id))
      .orderBy(desc(buildingLaunches.startedAt))
    const [row] = yield* database
      .select({ worktree: workspaceRepositories.worktree })
      .from(workspaceRepositories)
      .where(
        and(
          eq(workspaceRepositories.workspaceId, launch?.workspaceId ?? ''),
          eq(workspaceRepositories.path, 'api'),
        ),
      )
    const api = row?.worktree ?? ''
    yield* before(mission.id)
    writeFileSync(join(api, 'notes.ts'), 'export const notes = 1\n')
    yield* moved(mission.id, 'endBuilding')
    yield* until(
      Effect.map(
        Review.use((review) => review.state(mission.id)),
        (state) => state.checkpoints.length > 0,
      ),
      30_000,
    )
    const ids: Array<string> = []
    const feedbacks: Array<string> = []
    for (const image of images) {
      const added = yield* Review.use((review) =>
        review.imageAdd(mission.id, image.name, image.bytes),
      )
      const feedback = yield* Review.use((review) =>
        review.feedbackAdd(
          mission.id,
          { kind: 'remark', body: image.feedback, anchor: null, images: [added.evidenceId] },
          FeedbackUser.make({}),
        ),
      )
      ids.push(added.evidenceId)
      feedbacks.push(feedback.id)
    }
    const key = yield* missionKeyOf(mission.id)
    return {
      missionId: mission.id,
      api,
      evidence: join(missionFolder(data, key), 'evidence'),
      images: ids,
      feedbacks,
    }
  }).pipe(Effect.orDie)

/** Push answered on the mission's click. */
const pushed = (missionId: string) =>
  Effect.gen(function* () {
    yield* chosen(yield* decisionSaying(missionId, 'Push and open'), 'Push')
  })

/** The bytes of every file of a folder, by name. */
const filesOf = (at: string) =>
  Object.fromEntries(readdirSync(at).map((name) => [name, readFileSync(join(at, name))]))

const GREY: Dropped = {
  name: 'grey-button.png',
  bytes: png(640),
  feedback: 'The save button is grey.\nIt should be blue.',
}
const LABELS: Dropped = {
  name: 'labels-overflow.png',
  bytes: png(800),
  feedback: 'The labels overflow on a phone.',
}

/** An evidence's file name in the evidence folder. */
const fileOf = (bytes: Buffer) => `${createHash('sha256').update(bytes).digest('hex')}.png`

/** The asset URL the fake forge gives a file. */
const assetOf = (bytes: Buffer) =>
  `https://github.com/user-attachments/assets/${fileOf(bytes).replace(/\.png$/, '')}`

const NO_LONGER_CHOSEN =
  'No longer chosen for publication (unmarked, or its feedback withdrawn): its file name is listed.'

const setPublishable = (evidenceId: string, publishable: boolean) =>
  Pushes.use((pushes) => pushes.setPublishable(evidenceId, publishable))

describe('Which images are published', () => {
  test(
    'a body with {images} and two feedback images: two --attach arguments with alt text, the references in the body, URLs recorded per evidence after reading the body back',
    async () => {
      const { run } = engine()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const mission = yield* inReview(BODY, [GREY, LABELS])
            yield* pushed(mission.missionId)
            yield* untilApi(mission.missionId, 'done')
            return { mission, api: apiOf(yield* pushesOf(mission.missionId)) }
          }),
        ),
      )
      const [create, ...more] = prCalls('create')
      expect(more).toEqual([])
      expect(attached(create?.args ?? [])).toEqual([
        `${fileOf(GREY.bytes)}#The save button is grey.`,
        `${fileOf(LABELS.bytes)}#The labels overflow on a phone.`,
      ])
      // Each reference rewritten by the forge where the template put `{images}`.
      expect(pullRequests()[0]?.body).toBe(
        [
          'What changed.',
          '',
          `![The save button is grey.](${assetOf(GREY.bytes)})`,
          `![The labels overflow on a phone.](${assetOf(LABELS.bytes)})`,
          '',
          'The end.',
        ].join('\n'),
      )
      expect(fake.calls().some((one) => one.args[1] === 'view' && one.args.includes('body'))).toBe(
        true,
      )
      expect(seen.api?.images).toEqual([
        {
          evidenceId: seen.mission.images[0],
          name: 'grey-button.png',
          alt: 'The save button is grey.',
          state: 'published',
          url: assetOf(GREY.bytes),
          message: null,
        },
        {
          evidenceId: seen.mission.images[1],
          name: 'labels-overflow.png',
          alt: 'The labels overflow on a phone.',
          state: 'published',
          url: assetOf(LABELS.bytes),
          message: null,
        },
      ])
      expect(seen.api?.imagesReason).toBe(null)
    },
    SLOW,
  )

  test(
    'an evidence log file and an unmarked Prototyper image are never attached; an image marked publishable is, and a feedback image unmarked is not',
    async () => {
      const { run } = engine()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const agent = AgentAuthor.make({ role: 'prototyper', sessionId: 'session-1' })
            const put = (missionId: string, name: string, content: EvidenceContent) =>
              putEvidence({ missionId, content, name, about: null, author: agent }).pipe(
                Effect.orDie,
              )
            const kept: Array<string> = []
            const mission = yield* inReview(BODY, [GREY], (missionId) =>
              Effect.gen(function* () {
                yield* put(missionId, 'build.log', { text: 'npm run build\nok\n' })
                yield* put(missionId, 'draft.png', { bytes: png(320) })
                const marked = yield* put(missionId, 'final.png', { bytes: png(1024) })
                const log = yield* put(missionId, 'test.log', { text: 'all green\n' })
                kept.push(marked.id, log.id)
              }),
            )
            yield* setPublishable(kept[0] ?? '', true)
            yield* setPublishable(mission.images[0] ?? '', false)
            const refused = yield* setPublishable(kept[1] ?? '', true).pipe(Effect.flip)
            yield* pushed(mission.missionId)
            yield* untilApi(mission.missionId, 'done')
            return { refused, api: apiOf(yield* pushesOf(mission.missionId)) }
          }),
        ),
      )
      expect(attached(prCalls('create')[0]?.args ?? [])).toEqual([`${fileOf(png(1024))}#final.png`])
      expect(seen.api?.images.map((one) => [one.name, one.state])).toEqual([
        ['final.png', 'published'],
      ])
      expect(seen.refused.message).toBe('Only an image (PNG, JPEG or WebP) can be published.')
    },
    SLOW,
  )

  test(
    'no images to publish: {images} renders empty and nothing is attached',
    async () => {
      const { run } = engine()
      await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const mission = yield* inReview(BODY, [])
            yield* pushed(mission.missionId)
            yield* untilApi(mission.missionId, 'done')
          }),
        ),
      )
      expect(pullRequests()[0]?.body).toBe('What changed.\n\n\n\nThe end.')
      expect(fake.calls().some((one) => one.args.includes('--attach'))).toBe(false)
    },
    SLOW,
  )
})

describe('A public repository asks first', () => {
  test(
    'a public repository: the decision need comes first; until “publish”, the body has the name list; Publish edits it with the images',
    async () => {
      forgeIs({ ...GITHUB, visibility: 'public' })
      const { run } = engine()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const mission = yield* inReview(BODY, [GREY, LABELS])
            yield* pushed(mission.missionId)
            const question = yield* decisionSaying(mission.missionId, 'public pull request')
            yield* untilApi(mission.missionId, 'done')
            const before = {
              body: pullRequests()[0]?.body,
              api: apiOf(yield* pushesOf(mission.missionId)),
            }
            yield* chosen(question, 'Publish')
            yield* until(
              Effect.map(pushesOf(mission.missionId), (pushes) =>
                (apiOf(pushes)?.images ?? []).every((one) => one.state === 'published'),
              ),
              60_000,
            )
            return { question, before, api: apiOf(yield* pushesOf(mission.missionId)) }
          }),
        ),
      )
      const fields = seen.question.fields
      if (!Predicate.isTagged(fields, 'Decision')) throw new Error('not a decision')
      expect(fields.question).toBe(
        'Publish 2 images in the public pull request of acme/api?\ngrey-button.png\nlabels-overflow.png',
      )
      expect(fields.options).toEqual(['Publish', 'List the file names instead'])
      // Opened with the list, nothing attached until the answer.
      expect(prCalls('create')[0]?.args.includes('--attach')).toBe(false)
      expect(seen.before.body).toBe(
        'What changed.\n\n- grey-button.png\n- labels-overflow.png\n\nThe end.',
      )
      expect(seen.before.api?.imagesReason).toBe(
        'acme/api is public: the file names are listed until you answer whether to publish the images.',
      )
      const [edit, ...more] = prCalls('edit')
      expect(more).toEqual([])
      expect(edit?.args.slice(0, 3)).toEqual(['pr', 'edit', '1'])
      expect(attached(edit?.args ?? [])).toEqual([
        `${fileOf(GREY.bytes)}#The save button is grey.`,
        `${fileOf(LABELS.bytes)}#The labels overflow on a phone.`,
      ])
      expect(pullRequests()[0]?.body).toBe(
        [
          'What changed.',
          '',
          `![The save button is grey.](${assetOf(GREY.bytes)})`,
          `![The labels overflow on a phone.](${assetOf(LABELS.bytes)})`,
          '',
          'The end.',
        ].join('\n'),
      )
      expect(seen.api?.imagesReason).toBe(null)
      expect(seen.api?.images.map((one) => one.url)).toEqual([
        assetOf(GREY.bytes),
        assetOf(LABELS.bytes),
      ])
    },
    SLOW,
  )

  test(
    'a public repository answered “list the file names instead”: the list stays, says why, and is not asked again in the next round',
    async () => {
      forgeIs({ ...GITHUB, visibility: 'public' })
      const { run } = engine()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const mission = yield* inReview(BODY, [GREY])
            yield* pushed(mission.missionId)
            const question = yield* decisionSaying(mission.missionId, 'public pull request')
            yield* chosen(question, 'List the file names instead')
            yield* until(
              Effect.map(pushesOf(mission.missionId), (pushes) =>
                (apiOf(pushes)?.imagesReason ?? '').includes('you chose'),
              ),
              60_000,
            )
            // The next round comes back to Review: the answer is kept for the mission.
            const first = apiOf(yield* pushesOf(mission.missionId))?.commit ?? null
            yield* moved(mission.missionId, 'fix')
            writeFileSync(join(mission.api, 'notes.ts'), 'export const notes = 2\n')
            yield* moved(mission.missionId, 'endBuilding')
            yield* pushed(mission.missionId)
            yield* untilPushedAgain(mission.missionId, first)
            return {
              api: apiOf(yield* pushesOf(mission.missionId)),
              asked: (yield* decisions(mission.missionId)).length,
            }
          }),
        ),
      )
      expect(seen.asked).toBe(0)
      expect(pullRequests()[0]?.body).toBe('What changed.\n\n- grey-button.png\n\nThe end.')
      expect(fake.calls().some((one) => one.args.includes('--attach'))).toBe(false)
      expect(seen.api?.imagesReason).toBe(
        'acme/api is public and you chose to list the file names instead of publishing the images.',
      )
      expect(seen.api?.images.map((one) => one.state)).toEqual(['listed'])
    },
    SLOW,
  )

  test.each([
    {
      case: 'Publish after an unmark',
      undo: (mission: { readonly images: ReadonlyArray<string> }) =>
        setPublishable(mission.images[1] ?? '', false),
    },
    {
      case: 'Publish after a feedback withdrawn',
      undo: (mission: { readonly feedbacks: ReadonlyArray<string> }) =>
        Review.use((review) =>
          review.feedbackWithdraw(mission.feedbacks[1] ?? '', FeedbackUser.make({})),
        ),
    },
  ])(
    '$case: only the image still chosen is uploaded, the other stays listed by name and says why',
    async ({ undo }) => {
      forgeIs({ ...GITHUB, visibility: 'public' })
      const { run } = engine()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const mission = yield* inReview(BODY, [GREY, LABELS])
            yield* pushed(mission.missionId)
            const question = yield* decisionSaying(mission.missionId, 'public pull request')
            yield* untilApi(mission.missionId, 'done')
            yield* undo(mission)
            yield* chosen(question, 'Publish')
            yield* until(
              Effect.map(
                pushesOf(mission.missionId),
                (pushes) => apiOf(pushes)?.images[0]?.state === 'published',
              ),
              60_000,
            )
            return apiOf(yield* pushesOf(mission.missionId))
          }),
        ),
      )
      const [edit, ...more] = prCalls('edit')
      expect(more).toEqual([])
      expect(attached(edit?.args ?? [])).toEqual([`${fileOf(GREY.bytes)}#The save button is grey.`])
      expect(fake.calls().some((one) => one.args.join(' ').includes(fileOf(LABELS.bytes)))).toBe(
        false,
      )
      expect(pullRequests()[0]?.body).toBe(
        [
          'What changed.',
          '',
          `![The save button is grey.](${assetOf(GREY.bytes)})`,
          '- labels-overflow.png',
          '',
          'The end.',
        ].join('\n'),
      )
      expect(seen?.images.map((one) => [one.state, one.message])).toEqual([
        ['published', null],
        ['listed', NO_LONGER_CHOSEN],
      ])
    },
    SLOW,
  )
})

describe('A public repository’s question left pending', () => {
  test(
    'left unanswered when Fix takes the mission out of Review, it is withdrawn, and asked again at the next return to Review',
    async () => {
      forgeIs({ ...GITHUB, visibility: 'public' })
      const { run } = engine()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const mission = yield* inReview(BODY, [GREY])
            yield* pushed(mission.missionId)
            const asked = yield* decisionSaying(mission.missionId, 'public pull request')
            yield* untilApi(mission.missionId, 'done')
            const first = apiOf(yield* pushesOf(mission.missionId))?.commit ?? null
            yield* moved(mission.missionId, 'fix')
            yield* until(
              Effect.map(decisions(mission.missionId), (found) => found.length === 0),
              60_000,
            )
            writeFileSync(join(mission.api, 'notes.ts'), 'export const notes = 2\n')
            yield* moved(mission.missionId, 'endBuilding')
            yield* pushed(mission.missionId)
            const again = yield* decisionSaying(mission.missionId, 'public pull request')
            yield* untilPushedAgain(mission.missionId, first)
            yield* chosen(again, 'Publish')
            yield* until(
              Effect.map(pushesOf(mission.missionId), (pushes) =>
                (apiOf(pushes)?.images ?? []).every((one) => one.state === 'published'),
              ),
              60_000,
            )
            return { asked: asked.id, again: again.id }
          }),
        ),
      )
      expect(seen.again).not.toBe(seen.asked)
      expect(prCalls('create')).toHaveLength(1)
      expect(pullRequests()[0]?.body).toBe(
        `What changed.\n\n![The save button is grey.](${assetOf(GREY.bytes)})\n\nThe end.`,
      )
    },
    SLOW,
  )
})

describe('A forge that cannot host images gets the file names', () => {
  test.each([
    {
      case: 'Bitbucket',
      forge: { ...GITHUB, forge: 'bitbucket-datacenter', host: REMOTE_HOST },
      reason: 'Bitbucket cannot host images: the file names are listed.',
    },
    {
      case: 'a GitHub Enterprise Server host',
      forge: { ...GITHUB, host: REMOTE_HOST },
      reason: `GitHub Enterprise Server (${REMOTE_HOST}) cannot host images through gh: the file names are listed.`,
    },
    {
      case: 'gh 2.98.0',
      forge: { ...GITHUB, version: '2.98.0' },
      reason: 'gh 2.98.0 cannot attach images (2.99.0 or later can): the file names are listed.',
    },
    {
      case: 'no push permission',
      forge: { ...GITHUB, push: false },
      reason:
        'Your account cannot push to acme/api, which hosting images needs: the file names are listed.',
    },
  ] satisfies ReadonlyArray<{ case: string; forge: ForgeSetting; reason: string }>)(
    '$case gives the name list with its reason',
    async ({ forge, reason }) => {
      forgeIs(forge)
      const { run } = engine()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const mission = yield* inReview(BODY, [GREY, LABELS])
            yield* pushed(mission.missionId)
            yield* untilApi(mission.missionId, 'done')
            return apiOf(yield* pushesOf(mission.missionId))
          }),
        ),
      )
      expect(pullRequests()[0]?.body).toBe(
        'What changed.\n\n- grey-button.png\n- labels-overflow.png\n\nThe end.',
      )
      expect(fake.calls().some((one) => one.args.includes('--attach'))).toBe(false)
      expect(seen?.imagesReason).toBe(reason)
      expect(seen?.images.map((one) => one.state)).toEqual(['listed', 'listed'])
    },
    SLOW,
  )
})

describe('Partial failures and Retry', () => {
  test(
    'a partial failure: the pull request is recorded, one image marked not published with the CLI’s message masked, Retry sends only that one with gh pr edit --attach',
    async () => {
      forgeIs({ ...GITHUB, failing: [fileOf(LABELS.bytes)] })
      const { run } = engine()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const mission = yield* inReview(BODY, [GREY, LABELS])
            yield* pushed(mission.missionId)
            yield* untilApi(mission.missionId, 'failed')
            const failed = apiOf(yield* pushesOf(mission.missionId))
            forgeIs(GITHUB)
            yield* Pushes.use((pushes) => pushes.retry(mission.missionId, 'api'))
            yield* untilApi(mission.missionId, 'done')
            return { failed, api: apiOf(yield* pushesOf(mission.missionId)) }
          }),
        ),
      )
      expect(prCalls('create')).toHaveLength(1)
      expect(seen.failed?.pullRequest?.url).toBe('https://github.com/acme/api/pull/1')
      expect(seen.failed?.images.map((one) => one.state)).toEqual(['published', 'not-published'])
      const message = seen.failed?.images[1]?.message ?? ''
      expect(message).toContain(`failed to upload ${fileOf(LABELS.bytes)}: HTTP 502`)
      expect(message).not.toContain(TOKEN)
      const [edit, ...more] = prCalls('edit')
      expect(more).toEqual([])
      expect(attached(edit?.args ?? [])).toEqual([
        `${fileOf(LABELS.bytes)}#The labels overflow on a phone.`,
      ])
      expect(seen.api?.images.map((one) => [one.state, one.url])).toEqual([
        ['published', assetOf(GREY.bytes)],
        ['published', assetOf(LABELS.bytes)],
      ])
      expect(pullRequests()[0]?.body).toContain(
        `![The labels overflow on a phone.](${assetOf(LABELS.bytes)})`,
      )
    },
    SLOW,
  )

  test(
    'a Retry after success uploads nothing: the next round finds every URL in the body, and Retry has nothing to retry',
    async () => {
      const { run } = engine()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const mission = yield* inReview(BODY, [GREY])
            yield* pushed(mission.missionId)
            yield* untilApi(mission.missionId, 'done')
            const retried = yield* Pushes.use((pushes) =>
              pushes.retry(mission.missionId, 'api'),
            ).pipe(Effect.flip)
            const first = apiOf(yield* pushesOf(mission.missionId))?.commit ?? null
            yield* moved(mission.missionId, 'fix')
            writeFileSync(join(mission.api, 'notes.ts'), 'export const notes = 2\n')
            yield* moved(mission.missionId, 'endBuilding')
            yield* pushed(mission.missionId)
            yield* untilPushedAgain(mission.missionId, first)
            return { retried, api: apiOf(yield* pushesOf(mission.missionId)) }
          }),
        ),
      )
      expect(Predicate.isTagged(seen.retried, 'NothingToRetry')).toBe(true)
      expect(fake.calls().filter((one) => one.args.includes('--attach'))).toHaveLength(1)
      expect(prCalls('edit')).toEqual([])
      expect(seen.api?.images.map((one) => one.state)).toEqual(['published'])
    },
    SLOW,
  )

  test(
    'a restart once the pull request opened, before its copies were recorded: they are read from the description, nothing is uploaded again',
    async () => {
      const reached = Effect.runSync(Deferred.make<void>())
      const { run } = engine((at, name) =>
        at === 'opened' && name === 'api'
          ? Effect.andThen(Deferred.succeed(reached, undefined), Effect.never)
          : Effect.void,
      )
      const missionId = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const mission = yield* inReview(BODY, [GREY, LABELS])
            yield* pushed(mission.missionId)
            yield* Deferred.await(reached)
            return mission.missionId
          }),
        ),
      )
      const { run: again } = engine()
      const seen = await again(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            yield* untilApi(missionId, 'done')
            return apiOf(yield* pushesOf(missionId))
          }),
        ),
      )
      expect(fake.calls().filter((one) => one.args.includes('--attach'))).toHaveLength(1)
      expect(seen?.images.map((one) => [one.state, one.url])).toEqual([
        ['published', assetOf(GREY.bytes)],
        ['published', assetOf(LABELS.bytes)],
      ])
    },
    SLOW,
  )

  test(
    'the evidence files are byte-identical after publication',
    async () => {
      forgeIs({ ...GITHUB, failing: [fileOf(LABELS.bytes)] })
      const { run } = engine()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const mission = yield* inReview(BODY, [GREY, LABELS])
            const before = filesOf(mission.evidence)
            yield* pushed(mission.missionId)
            yield* untilApi(mission.missionId, 'failed')
            forgeIs(GITHUB)
            yield* Pushes.use((pushes) => pushes.retry(mission.missionId, 'api'))
            yield* untilApi(mission.missionId, 'done')
            return { before, after: filesOf(mission.evidence) }
          }),
        ),
      )
      expect(Object.keys(seen.before).sort()).toEqual(
        [fileOf(GREY.bytes), fileOf(LABELS.bytes)].sort(),
      )
      expect(seen.after).toEqual(seen.before)
    },
    SLOW,
  )

  test(
    'Retry after an unmark: the image not published is not sent again, it stays listed and says why; the one published stays published',
    async () => {
      forgeIs({ ...GITHUB, failing: [fileOf(LABELS.bytes)] })
      const { run } = engine()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const mission = yield* inReview(BODY, [GREY, LABELS])
            yield* pushed(mission.missionId)
            yield* untilApi(mission.missionId, 'failed')
            forgeIs(GITHUB)
            for (const image of mission.images) yield* setPublishable(image, false)
            yield* Pushes.use((pushes) => pushes.retry(mission.missionId, 'api'))
            yield* untilApi(mission.missionId, 'done')
            return apiOf(yield* pushesOf(mission.missionId))
          }),
        ),
      )
      expect(prCalls('create')).toHaveLength(1)
      expect(prCalls('edit')).toEqual([])
      expect(seen?.images.map((one) => [one.state, one.url, one.message])).toEqual([
        ['published', assetOf(GREY.bytes), null],
        ['listed', null, NO_LONGER_CHOSEN],
      ])
    },
    SLOW,
  )
})

describe('What is never sent', () => {
  test(
    'an image added after the pull request opened is not added to it; it shows “not in the pull request”',
    async () => {
      const { run } = engine()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const mission = yield* inReview(BODY, [GREY])
            yield* pushed(mission.missionId)
            yield* untilApi(mission.missionId, 'done')
            const added = yield* Review.use((review) =>
              review.imageAdd(mission.missionId, LABELS.name, LABELS.bytes),
            )
            yield* Review.use((review) =>
              review.feedbackAdd(
                mission.missionId,
                { kind: 'remark', body: LABELS.feedback, anchor: null, images: [added.evidenceId] },
                FeedbackUser.make({}),
              ),
            )
            const first = apiOf(yield* pushesOf(mission.missionId))?.commit ?? null
            yield* moved(mission.missionId, 'fix')
            writeFileSync(join(mission.api, 'notes.ts'), 'export const notes = 2\n')
            yield* moved(mission.missionId, 'endBuilding')
            yield* pushed(mission.missionId)
            yield* untilPushedAgain(mission.missionId, first)
            return apiOf(yield* pushesOf(mission.missionId))
          }),
        ),
      )
      expect(fake.calls().filter((one) => one.args.includes('--attach'))).toHaveLength(1)
      expect(seen?.images.map((one) => [one.name, one.state])).toEqual([
        ['grey-button.png', 'published'],
        ['labels-overflow.png', 'not-in-pull-request'],
      ])
    },
    SLOW,
  )

  test.skipIf(process.platform === 'win32')(
    'an evidence file replaced by a link is never attached: it is marked not published, with why',
    async () => {
      const { run } = engine()
      const outside = join(temporaryFolder('delivery-images-outside'), 'secret.png')
      writeFileSync(outside, GREY.bytes)
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const mission = yield* inReview(BODY, [GREY, LABELS])
            const file = join(mission.evidence, fileOf(GREY.bytes))
            rmSync(file)
            symlinkSync(outside, file)
            yield* pushed(mission.missionId)
            yield* untilApi(mission.missionId, 'failed')
            return apiOf(yield* pushesOf(mission.missionId))
          }),
        ),
      )
      expect(attached(prCalls('create')[0]?.args ?? [])).toEqual([
        `${fileOf(LABELS.bytes)}#The labels overflow on a phone.`,
      ])
      expect(seen?.images.map((one) => one.state)).toEqual(['not-published', 'published'])
      expect(seen?.images[0]?.message).toBe(
        'The evidence file could not be read as Hemera kept it: a link or a junction now stands on its way, and a path is never followed after it was judged',
      )
    },
    SLOW,
  )
})
