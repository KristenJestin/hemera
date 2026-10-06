/**
 * The order of decision behind the gate, through the real gate of a real engine: each step with a
 * call that stops at it, the sensitive places through file tools and shell strings, the words
 * that do not read, the CT-17 folders of the data folder, the refusals of a mission's agents and
 * the "never" list, the defence in depth against a local bare repository, and the decision each
 * call leaves in the journal.
 */

import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { NeverProgram } from '@hemera/core/domain'
import type { CommandDraft } from '@hemera/ipc'
import { eq } from 'drizzle-orm'
import { Effect, Layer } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { saveCommand } from '../src/engine/catalogue.ts'
import { setNeverList } from '../src/engine/permissions/never-list.ts'
import { Judge, MissionGrants, MissionPlaces } from '../src/engine/permissions/ports.ts'
import { sensitivePlacesLayer } from '../src/engine/permissions/sensitive.ts'
import { ProfileHome } from '../src/engine/profile-home.ts'
import type { EngineServices } from '../src/engine/profile.ts'
import { startRun } from '../src/engine/runs.ts'
import { secretsRegistry } from '../src/engine/secrets.ts'
import { Database } from '../src/engine/storage/database.ts'
import { domainEvents } from '../src/engine/storage/schema.ts'
import { SensitivePlaces } from '../src/engine/tools/ports.ts'
import { type Started, commandsEngine, nodeLine, script, until } from './commands-engine.ts'
import { removeFolders, temporaryFolder } from './storage.ts'
import { acmeWithMission, callTool, questionsKept, sessionOf } from './tools-world.ts'

let data: string
let work: string

beforeEach(() => {
  data = realpathSync.native(temporaryFolder('permissions'))
  work = realpathSync.native(temporaryFolder('permissions-work'))
})
afterEach(removeFolders)

const draft = (name: string, line: string, more: Partial<CommandDraft> = {}): CommandDraft => ({
  name,
  type: 'script',
  line,
  lineWindows: null,
  lineLinux: null,
  repositoryId: null,
  folder: null,
  scope: 'workspace',
  portless: false,
  portlessName: null,
  check: false,
  atOpen: false,
  askBeforeRunning: false,
  readOnly: false,
  writeGlobs: [],
  ...more,
})

type Engine = Parameters<typeof commandsEngine>[1]

/**
 * One engine whose home is the work folder, its questions kept: runs `body` with a Builder of
 * Acme's mission (and the Chat of Acme), and answers what the body answers with the questions.
 */
const withBuilder = <A, E>(
  body: (world: {
    readonly builder: string
    readonly chat: string
    readonly main: string
    readonly projectId: string
    readonly missionKey: string
    readonly started: Started
  }) => Effect.Effect<A, E, EngineServices>,
  parts: NonNullable<Engine> = {},
) => {
  const questions = questionsKept()
  return commandsEngine(data, {
    ...parts,
    tools: { home: work, permissionRequests: questions.layer, ...parts.tools },
  })((started) =>
    Effect.gen(function* () {
      const answer = yield* started.profile.use(
        Effect.gen(function* () {
          const { project, mission, main } = yield* acmeWithMission(work)
          const builder = yield* sessionOf('builder', main, { kind: 'mission', id: mission.id })
          const chat = yield* sessionOf('chat', main, { kind: 'project', id: project.id })
          return yield* body({
            builder: builder.grantId,
            chat: chat.grantId,
            main,
            projectId: project.id,
            missionKey: mission.key,
            started,
          })
        }),
      )
      return { answer, questions: questions.asked.map((one) => one.reason) }
    }),
  )
}

const run = (grantId: string, line: string) => callTool(grantId, 'commands_run', { line })
const read = (grantId: string, path: string) => callTool(grantId, 'fs_read', { path })

const decisions = Effect.flatMap(Database, (database) =>
  database.select().from(domainEvents).where(eq(domainEvents.type, 'permission.decided')),
)

describe('The order of decision: each step, and only steps 1 and 2 refuse', () => {
  test('step 2 refuses (a deletion of .git), step 3 asks (outside), step 4 allows (a read inside), and the judge port answering unavailable asks', async () => {
    const { answer, questions } = await withBuilder(({ builder }) =>
      Effect.all([
        run(builder, 'rm -rf .git'),
        read(builder, '../elsewhere.txt'),
        read(builder, 'README.md'),
        callTool(builder, 'fs_write', { path: 'notes.md', content: 'x' }),
      ]),
    )
    expect(answer[0].text).toBe('refused: a deletion that touches a .git folder')
    expect(answer[1].text).toBe('refused: approvals are not available yet')
    expect(answer[2].text).not.toContain('approvals')
    expect(answer[3].text).toBe('refused: approvals are not available yet')
    expect(questions).toEqual([
      `outside the Workspace: ~/elsewhere.txt`,
      'no judge could rate it: no judge is set up',
    ])
  })

  test('the judge allows or asks; when it fails, the call asks, never allowed', async () => {
    const allows = Layer.succeed(Judge, {
      judge: () => Effect.succeed({ verdict: 'allow', reason: 'risk 0.2' }),
    })
    const fails = Layer.succeed(Judge, { judge: () => Effect.die(new Error('429')) })
    const allowed = await withBuilder(
      ({ builder }) => callTool(builder, 'fs_write', { path: 'notes.md', content: 'x' }),
      { tools: { judge: allows } },
    )
    expect(allowed.answer.ok).toBe(true)
    const failed = await withBuilder(
      ({ builder }) => callTool(builder, 'fs_write', { path: 'notes.md', content: 'x' }),
      { tools: { judge: fails } },
    )
    expect(failed.answer.ok).toBe(false)
    expect(failed.questions).toEqual(['the judge failed'])
  })

  test('a judge that allows never lifts a refusal nor a sensitive place', async () => {
    const allows = Layer.succeed(Judge, {
      judge: () => Effect.succeed({ verdict: 'allow', reason: 'risk 0.1' }),
    })
    const { answer, questions } = await withBuilder(
      ({ builder }) => Effect.all([run(builder, 'git push'), read(builder, '.env')]),
      { tools: { judge: allows } },
    )
    expect(answer[0].text).toBe('refused: no agent of a mission may run git push')
    expect(answer[1].ok).toBe(false)
    expect(questions).toEqual(['sensitive place: ~/acme/.env'])
  })

  test('a grant allows an outside call, never a sensitive place', async () => {
    const liftsAll = Layer.succeed(MissionGrants, {
      allowing: () => Effect.succeed('g-1'),
    })
    const { answer, questions } = await withBuilder(
      ({ builder }) =>
        Effect.gen(function* () {
          writeFileSync(join(work, 'elsewhere.txt'), 'hello')
          return yield* Effect.all([
            read(builder, '../elsewhere.txt'),
            read(builder, '~/.ssh/config'),
          ])
        }),
      { tools: { grants: liftsAll } },
    )
    expect(answer[0].text).toContain('hello')
    expect(questions).toEqual(['outside the Workspace: ~/.ssh/config; sensitive place: ~/.ssh'])
  })

  test('a catalogue command marked "ask before running" asks; one that is not runs', async () => {
    const quiet = script('process.stdout.write("ran\\n")\n')
    const { answer, questions } = await withBuilder(({ builder, projectId }) =>
      Effect.gen(function* () {
        const asks = yield* saveCommand({
          projectId,
          id: null,
          command: draft('seed', nodeLine(quiet), { askBeforeRunning: true }),
        })
        const plain = yield* saveCommand({
          projectId,
          id: null,
          command: draft('hello', nodeLine(quiet)),
        })
        return yield* Effect.all([
          callTool(builder, 'commands_run', { command: asks.id }),
          callTool(builder, 'commands_run', { command: plain.id }),
        ])
      }),
    )
    expect(answer[0].ok).toBe(false)
    expect(answer[1].text).toContain('ran')
    expect(questions).toEqual(['ask before running: seed'])
  })
})

describe('Sensitive places always ask, for file tools and commands', () => {
  const lines = [
    'cat ~/.ssh/config',
    `sh -c 'cat "$HOME/.ssh/config"'`,
    `bash -lc 'cat ~/.ssh/config | head'`,
    'cmd /c type %USERPROFILE%\\.ssh\\config',
    'powershell -Command Get-Content ~/.ssh/config',
    `sh -c "bash -c 'cat ~/.ssh/config'"`,
    `sudo sh -c 'cat ~/.ssh/config'`,
  ]
  test.each(lines)('%s asks as a sensitive place', async (line) => {
    const { questions } = await withBuilder(({ builder }) => run(builder, line))
    expect(questions).toHaveLength(1)
    // A path written with backslashes is shown as it was written.
    expect(questions[0]).toMatch(/sensitive place: ~[\\/]\.ssh/)
  })

  test.each(['~/.ssh/config', '~/.aws/credentials', '~/.npmrc', '~/.config/gh/hosts.yml'])(
    'fs_read of %s asks',
    async (path) => {
      const { questions } = await withBuilder(({ builder }) => read(builder, path))
      expect(questions[0]).toContain('sensitive place:')
    },
  )

  test('.env.local inside the Workspace asks, for a read and for a command', async () => {
    const { questions } = await withBuilder(({ builder, main }) =>
      Effect.gen(function* () {
        writeFileSync(join(main, '.env.local'), 'TOKEN=x')
        return yield* Effect.all([read(builder, '.env.local'), run(builder, 'cat .env.local')])
      }),
    )
    expect(questions).toEqual([
      'sensitive place: ~/acme/.env.local',
      'sensitive place: ~/acme/.env.local',
    ])
  })
})

describe('What cannot be read with certainty counts as outside', () => {
  test.each([
    ['an unknown variable', `sh -c 'cat $SECRET_FILE'`],
    ['a substitution', `sh -c 'cat $(echo notes)'`],
    ['backticks', 'sh -c "cat `echo notes`"'],
    ['an unclosed quote', `sh -c 'cat "notes'`],
    ['-EncodedCommand', 'powershell -EncodedCommand ZwBjACAAfgA='],
    ['| sh', `sh -c 'echo ls | sh'`],
    ['python -c', `python3 -c 'print(1)'`],
    ['node -e', `node -e 'console.log(1)'`],
  ])('%s: %s', async (_, line) => {
    const { questions } = await withBuilder(({ builder }) => run(builder, line))
    expect(questions).toHaveLength(1)
    expect(questions[0]).toMatch(/^outside the Workspace: words that do not read/)
  })
})

describe("CT-17: the data folder's missions/ exception keeps missions isolated", () => {
  test("the session's own missions/<key>/ is not sensitive, another mission's and snapshots/ are, through a link too", async () => {
    const { answer, questions } = await withBuilder(({ builder, main, missionKey }) =>
      Effect.gen(function* () {
        for (const folder of [`missions/${missionKey}`, 'missions/OTHER-9', 'snapshots']) {
          mkdirSync(join(data, folder), { recursive: true })
          writeFileSync(join(data, folder, 'notes.md'), 'n')
        }
        symlinkSync(join(data, 'missions', 'OTHER-9'), join(main, 'other'), 'junction')
        return yield* Effect.all([
          read(builder, join(data, 'missions', missionKey, 'notes.md')),
          read(builder, join(data, 'missions', 'OTHER-9', 'notes.md')),
          read(builder, join(data, 'snapshots', 'notes.md')),
          read(builder, 'other/notes.md'),
        ])
      }),
    )
    expect(answer.every((one) => !one.ok)).toBe(true)
    expect(questions[0]).not.toContain('sensitive')
    expect(questions[1]).toContain('sensitive place:')
    expect(questions[1]).toContain('OTHER-9')
    expect(questions[2]).toContain('sensitive place:')
    expect(questions[2]).toContain('snapshots')
    expect(questions[3]).toContain('sensitive place:')
  })

  test("a dependency's missions/<key>/ may be read, never written", async () => {
    const session = {
      sessionId: 's',
      role: 'builder' as const,
      projectId: 'p',
      missionId: 'm',
      place: { kind: 'workspace' as const, readOnly: false, root: join(work, 'ws') },
    }
    const said = await Effect.runPromise(
      Effect.gen(function* () {
        const places = yield* SensitivePlaces
        const at = (key: string) => join(data, 'missions', key, 'spec.md')
        return [
          yield* places.sensitive(at('AC-1'), { session, writes: true }),
          yield* places.sensitive(at('AC-2'), { session, writes: false }),
          yield* places.sensitive(at('AC-2'), { session, writes: true }),
          yield* places.sensitive(at('AC-3'), { session, writes: false }),
          yield* places.sensitive(join(data, 'missions', 'AC-1', '.env'), {
            session,
            writes: false,
          }),
        ]
      }).pipe(
        Effect.provide(
          sensitivePlacesLayer({ home: work, platform: process.platform }).pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(MissionPlaces, {
                  foldersOf: () => Effect.succeed({ own: 'AC-1', dependencies: ['AC-2'] }),
                }),
                Layer.succeed(ProfileHome, { dataFolder: data, version: '1', migrations: '' }),
              ),
            ),
          ),
        ),
      ),
    )
    expect(said[0]).toBeNull()
    expect(said[1]).toBeNull()
    expect(said[2]).toMatch(/^sensitive place: .*AC-2$/)
    expect(said[3]).toMatch(/^sensitive place: .*AC-3$/)
    expect(said[4]).toMatch(/^sensitive place: .*\.env$/)
  })
})

describe("The refusals of a mission's agents, on the effective action", () => {
  test.each([
    ['git push', 'no agent of a mission may run git push'],
    ['git merge feature', 'no agent of a mission may run git merge'],
    ['git commit -m wip', 'no agent of a mission may run git commit in this Project'],
    ['npx gh pr merge 1', 'no agent of a mission may run gh beyond its reads'],
    ['pnpm exec gh pr merge 1', 'no agent of a mission may run gh beyond its reads'],
    ['env GH_PAGER=cat gh release create v1', 'no agent of a mission may run gh beyond its reads'],
    ['time npm publish', 'no agent of a mission may publish a package (npm)'],
    [`sh -c 'git push origin main'`, 'no agent of a mission may run git push'],
  ])('%s is refused at step 2', async (line, reason) => {
    const { answer, questions } = await withBuilder(({ builder }) => run(builder, line))
    expect(answer.text).toBe(`refused: ${reason}`)
    expect(questions).toEqual([])
  })

  test('a read of a forge CLI is not refused (it goes on, and asks without a judge)', async () => {
    const { answer, questions } = await withBuilder(({ builder }) => run(builder, 'gh pr view 1'))
    expect(answer.text).toBe('refused: approvals are not available yet')
    expect(questions).toEqual(['no judge could rate it: no judge is set up'])
  })

  test("the Chat's commands are not refused by the mission rules: they go through the order", async () => {
    const { answer, questions } = await withBuilder(({ chat }) => run(chat, 'git push'))
    expect(answer.text).toBe('refused: approvals are not available yet')
    // The Chat always asks before a push (#43), before any judge.
    expect(questions).toEqual(['the Chat always asks before git push'])
  })
})

describe('A "never" entry refuses a call that begins with it, through a wrapper too', () => {
  test('make deploy, directly and through env and sh -c; the list is live', async () => {
    const { answer } = await withBuilder(({ builder, chat, projectId }) =>
      Effect.gen(function* () {
        const before = yield* run(builder, 'make deploy')
        yield* setNeverList(projectId, [NeverProgram.make({ words: ['make', 'deploy'] })])
        return [
          before,
          yield* run(builder, 'make deploy'),
          yield* run(builder, 'env STAGE=prod make deploy --now'),
          yield* run(chat, `sh -c 'make deploy'`),
          yield* run(builder, 'make build'),
        ] as const
      }),
    )
    expect(answer[0].text).toBe('refused: approvals are not available yet')
    for (const refused of answer.slice(1, 4)) {
      expect(refused.text).toBe('refused: the Project never allows make deploy')
    }
    expect(answer[4].text).toBe('refused: approvals are not available yet')
  })
})

/** Git, run quietly in a folder, its result. */
const git = (cwd: string, ...args: ReadonlyArray<string>) =>
  spawnSync('git', ['-c', 'user.name=Acme', '-c', 'user.email=acme@example.invalid', ...args], {
    cwd,
    encoding: 'utf8',
  })

describe('The real gate test: nothing reaches the bare repository', () => {
  test('git push, sh -c "git push" and npx gh pr merge 1 are refused at step 2; a script that pushes fails on pushInsteadOf; the refs are unchanged', async () => {
    const remote = join(work, 'remote.git')
    const seen = join(work, 'seen.json')
    const pusher = script(`
import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
const push = spawnSync('git', ['push', 'origin', 'HEAD:main'], { encoding: 'utf8' })
writeFileSync(process.argv[2], JSON.stringify({
  status: push.status,
  stderr: push.stderr,
  ghConfig: process.env.GH_CONFIG_DIR ?? null,
  ghToken: process.env.GH_TOKEN ?? null,
}))
`)
    const { answer } = await withBuilder(({ builder, main, projectId }) =>
      Effect.gen(function* () {
        git(work, 'init', '-q', '--bare', remote)
        git(main, 'init', '-q')
        git(main, 'commit', '-q', '--allow-empty', '-m', 'first')
        git(main, 'remote', 'add', 'origin', remote)
        const pushes = yield* saveCommand({
          projectId,
          id: null,
          command: draft('publish-notes', nodeLine(pusher, seen)),
        })
        return [
          yield* run(builder, 'git push origin HEAD:main'),
          yield* run(builder, 'sh -c "git push origin HEAD:main"'),
          yield* run(builder, 'npx gh pr merge 1'),
          yield* callTool(builder, 'commands_run', { command: pushes.id }),
        ] as const
      }),
    )
    expect(answer[0].text).toBe('refused: no agent of a mission may run git push')
    expect(answer[1].text).toBe('refused: no agent of a mission may run git push')
    expect(answer[2].text).toBe('refused: no agent of a mission may run gh beyond its reads')
    expect(answer[3].ok).toBe(true)
    const pushed = JSON.parse(readFileSync(seen, 'utf8'))
    expect(pushed.status).not.toBe(0)
    expect(pushed.stderr).toContain('hemera-refused-push')
    expect(pushed.ghConfig).toBe(join(data, 'permissions', 'no-forge-login'))
    expect(pushed.ghToken).toBe('')
    expect(git(remote, 'for-each-ref').stdout).toBe('')
  })

  test("the user's own run keeps the real configuration", async () => {
    const seen = join(work, 'env.json')
    const prints = script(`
import { writeFileSync } from 'node:fs'
writeFileSync(process.argv[2], JSON.stringify({ ghConfig: process.env.GH_CONFIG_DIR ?? null }))
`)
    await withBuilder(({ projectId }) =>
      Effect.gen(function* () {
        const started = yield* startRun({
          projectId,
          workspaceId: null,
          commandId: null,
          line: nodeLine(prints, seen),
          folder: null,
          startedBy: 'user',
          sessionId: null,
        })
        yield* until(
          Effect.sync(() => {
            try {
              return readFileSync(seen, 'utf8')
            } catch {
              return ''
            }
          }),
          (text) => text !== '',
        )
        return started.id
      }),
    )
    expect(JSON.parse(readFileSync(seen, 'utf8')).ghConfig).toBe(
      process.env['GH_CONFIG_DIR'] ?? null,
    )
  })
})

describe('Every decision is told, with its policy, never with a secret', () => {
  test('a permission.decided event carries the verdict, who decided, the policy version and level, and the target masked', async () => {
    const secrets = secretsRegistry()
    secrets.register('suite', ['hunter2-not-real'])
    const { answer } = await withBuilder(
      ({ builder }) =>
        Effect.gen(function* () {
          yield* run(builder, 'git push https://me:hunter2-not-real@example.invalid/acme.git')
          yield* read(builder, 'README.md')
          return yield* decisions
        }),
      { secrets },
    )
    expect(answer).toHaveLength(2)
    expect(JSON.stringify(answer)).not.toContain('hunter2-not-real')
    const [push, readme] = answer.map((one) => JSON.parse(one.payload))
    expect(answer[0]?.entityKind).toBe('mission')
    expect(push).toMatchObject({
      tool: 'commands_run',
      verdict: 'deny',
      by: 'rules',
      reasons: ['no agent of a mission may run git push'],
      policyVersion: 1,
      level: 'normal',
    })
    expect(readme).toMatchObject({ tool: 'fs_read', verdict: 'allow', policyVersion: 1 })
  })

  test('one line of the diagnostic log per decision, masked', async () => {
    const secrets = secretsRegistry()
    secrets.register('suite', ['hunter2-not-real'])
    const told = await commandsEngine(data, { secrets, tools: { home: work } })(
      ({ profile, lines }) =>
        profile.use(
          Effect.gen(function* () {
            const { mission, main } = yield* acmeWithMission(work)
            const builder = yield* sessionOf('builder', main, { kind: 'mission', id: mission.id })
            yield* run(builder.grantId, 'git push https://hunter2-not-real@example.invalid/x')
            return lines.filter((line) => line.startsWith('permissions:'))
          }),
        ),
    )
    expect(told).toHaveLength(1)
    expect(told[0]).toContain('deny by rules')
    expect(told[0]).toContain('[policy 1, normal]')
    expect(told[0]).not.toContain('hunter2-not-real')
  })
})
