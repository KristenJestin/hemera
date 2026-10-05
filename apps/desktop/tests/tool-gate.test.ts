/**
 * The single gate every call of Hemera's tools goes through: the role's guards before any
 * verdict, the verdict and its one question, the places rule of workflow tools, idempotency by
 * the call's key, writing only on the version read, and the record of every call.
 *
 * The engine is the real one, its data folder and the Project's main checkout are on disk; the
 * verdict and the question are the ports later tickets fill, handed as parts that answer as each
 * test says and remember what they were asked.
 */

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { eq } from 'drizzle-orm'
import { Deferred, Effect, Fiber, Layer } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { HemeraEndpoint } from '../src/engine/agents/endpoint.ts'
import { secretsRegistry } from '../src/engine/secrets.ts'
import { Database } from '../src/engine/storage/database.ts'
import { agentSessions, effectfulActions, toolCalls } from '../src/engine/storage/schema.ts'
import { saveCommand } from '../src/engine/catalogue.ts'
import { placesForWorkflow } from '../src/engine/tools/gate.ts'
import { ToolAccess } from '../src/engine/tools/index.ts'
import { SensitivePlaces, Verdicts } from '../src/engine/tools/ports.ts'
import { commandsEngine, nodeLine, script } from './commands-engine.ts'
import { endChild, removeFolders, temporaryFolder } from './storage.ts'
import {
  ALLOW,
  acmeWithMission,
  callTool,
  questionsKept,
  sessionOf,
  verdictsSaying,
} from './tools-world.ts'

let data: string
let work: string

beforeEach(() => {
  data = realpathSync.native(temporaryFolder('gate'))
  work = realpathSync.native(temporaryFolder('gate-work'))
})
afterEach(removeFolders)

const callsOf = (sessionId: string) =>
  Effect.flatMap(Database, (database) =>
    database.select().from(toolCalls).where(eq(toolCalls.sessionId, sessionId)),
  )

const actionsRecorded = Effect.flatMap(Database, (database) =>
  database.select().from(effectfulActions),
)

describe("A role's guards come before any verdict", () => {
  test('a Planner fs_write is refused by the guard, and no verdict is asked', async () => {
    const verdicts = verdictsSaying(() => ALLOW)
    const [answer, calls] = await commandsEngine(data, { tools: { verdicts: verdicts.layer } })(
      ({ profile }) =>
        profile.use(
          Effect.gen(function* () {
            const { mission, main } = yield* acmeWithMission(work)
            const planner = yield* sessionOf('planner', main, { kind: 'mission', id: mission.id })
            const refused = yield* callTool(planner.grantId, 'fs_write', {
              path: 'notes.md',
              content: 'plan',
            })
            return [refused, yield* callsOf(planner.sessionId)] as const
          }),
        ),
    )
    expect(answer).toEqual({
      ok: false,
      refused: true,
      text: 'refused: the Planner has no tool fs_write',
    })
    expect(verdicts.asked).toEqual([])
    expect(calls).toMatchObject([{ tool: 'fs_write', outcome: 'refused', verdictBy: 'guard' }])
  })

  test('a writing tool from a read-only place is refused as such, before any verdict', async () => {
    const verdicts = verdictsSaying(() => ALLOW)
    const answer = await commandsEngine(data, { tools: { verdicts: verdicts.layer } })(
      ({ profile }) =>
        profile.use(
          Effect.gen(function* () {
            const { mission, main } = yield* acmeWithMission(work)
            const builder = yield* sessionOf('builder', main, { kind: 'mission', id: mission.id })
            // A grant whose place was narrowed to read-only keeps its tools but not its writing.
            const grant = yield* ToolAccess.use((access) => access.byId(builder.grantId))
            if (grant === null) return yield* Effect.die(new Error('no grant'))
            const token = yield* ToolAccess.use((access) =>
              access.mint({ ...grant, place: { ...grant.place, readOnly: true } }),
            )
            const narrowed = yield* ToolAccess.use((access) => access.byToken(token))
            return yield* callTool(narrowed?.id ?? '', 'fs_write', { path: 'a.md', content: 'x' })
          }),
        ),
    )
    expect(answer.text).toBe('refused: the Builder does not write files')
    expect(verdicts.asked).toEqual([])
  })

  test("the Planner runs only the catalogue's read-only checks: never a line", async () => {
    const verdicts = verdictsSaying(() => ALLOW)
    const passes = script('process.stdout.write("types are fine\\n")\n')
    const answers = await commandsEngine(data, { tools: { verdicts: verdicts.layer } })(
      ({ profile }) =>
        profile.use(
          Effect.gen(function* () {
            const { project, mission, main } = yield* acmeWithMission(work)
            const command = (name: string, check: boolean, readOnly: boolean) =>
              saveCommand({
                projectId: project.id,
                id: null,
                command: {
                  name,
                  type: check ? 'typecheck' : 'script',
                  line: nodeLine(passes),
                  lineWindows: null,
                  lineLinux: null,
                  repositoryId: null,
                  folder: null,
                  scope: 'workspace',
                  portless: false,
                  portlessName: null,
                  check,
                  atOpen: false,
                  askBeforeRunning: false,
                  readOnly,
                  writeGlobs: [],
                },
              })
            const typecheck = yield* command('typecheck', true, true)
            const format = yield* command('format', true, false)
            const planner = yield* sessionOf('planner', main, { kind: 'mission', id: mission.id })
            return [
              yield* callTool(planner.grantId, 'commands_run', { line: 'git status' }),
              yield* callTool(planner.grantId, 'commands_run', { command: format.id }),
              yield* callTool(planner.grantId, 'commands_run', { command: typecheck.id }),
              yield* callTool(planner.grantId, 'commands_list', {}),
            ] as const
          }),
        ),
    )
    expect(answers[0].text).toBe(
      "refused: the Planner runs only the catalogue's read-only checks, and a command line is not one",
    )
    expect(answers[1].text).toBe(
      "refused: the Planner runs only the catalogue's read-only checks, and format is not one",
    )
    expect(answers[2]).toMatchObject({ ok: true })
    expect(answers[2].text).toContain('types are fine')
    expect(answers[3].text).toContain('typecheck')
    expect(answers[3].text).not.toContain('format')
    // Only the read-only check reached a verdict, and only commands_list beside it.
    expect(verdicts.asked.map((call) => call.tool)).toEqual(['commands_run', 'commands_list'])
  })
})

describe('With the default order and no judge, what the rules do not allow asks', () => {
  test('a Builder writing inside its place is asked, and nothing is written', async () => {
    const questions = questionsKept()
    const answers = await commandsEngine(data, {
      tools: { permissionRequests: questions.layer },
    })(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { mission, main } = yield* acmeWithMission(work)
          const builder = yield* sessionOf('builder', main, { kind: 'mission', id: mission.id })
          return [
            yield* callTool(builder.grantId, 'fs_write', { path: 'notes.md', content: 'x' }),
            yield* callTool(builder.grantId, 'commands_run', { line: 'node --version' }),
            yield* callTool(builder.grantId, 'fs_list', { path: '.' }),
          ] as const
        }),
      ),
    )
    expect(answers[0].text).toBe('refused: approvals are not available yet')
    expect(answers[1].text).toBe('refused: approvals are not available yet')
    expect(questions.asked.map((one) => one.reason)).toEqual([
      'no judge could rate it: no judge is set up',
      'no judge could rate it: no judge is set up',
    ])
    expect(existsSync(join(work, 'acme', 'notes.md'))).toBe(false)
    // A read inside the place is allowed by the rules.
    expect(answers[2]).toMatchObject({ ok: true })
  })

  test('a read of a sensitive place outside asks with both reasons, never allowed', async () => {
    const questions = questionsKept()
    const answer = await commandsEngine(data, {
      tools: { home: work, permissionRequests: questions.layer },
    })(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { mission, main } = yield* acmeWithMission(work)
          mkdirSync(join(work, '.ssh'))
          writeFileSync(join(work, '.ssh', 'config'), 'Host *')
          const builder = yield* sessionOf('builder', main, { kind: 'mission', id: mission.id })
          return yield* callTool(builder.grantId, 'fs_read', { path: '~/.ssh/config' })
        }),
      ),
    )
    expect(answer).toEqual({
      ok: false,
      refused: true,
      text: 'refused: approvals are not available yet',
    })
    expect(questions.asked[0]?.reason).toBe(
      'outside the Workspace: ~/.ssh/config; sensitive place: ~/.ssh',
    )
  })
})

describe('A path is resolved before it is judged', () => {
  test('a symbolic link inside the place that leads out of it counts as outside', async () => {
    const verdicts = verdictsSaying(() => ALLOW)
    await commandsEngine(data, { tools: { verdicts: verdicts.layer } })(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { mission, main } = yield* acmeWithMission(work)
          const elsewhere = join(work, 'elsewhere')
          mkdirSync(elsewhere)
          writeFileSync(join(elsewhere, 'secret.txt'), 'nope')
          symlinkSync(elsewhere, join(main, 'linked'), 'junction')
          const builder = yield* sessionOf('builder', main, { kind: 'mission', id: mission.id })
          yield* callTool(builder.grantId, 'fs_read', { path: 'linked/secret.txt' })
        }),
      ),
    )
    expect(verdicts.asked[0]?.path).toMatchObject({
      named: 'linked/secret.txt',
      resolved: join(work, 'elsewhere', 'secret.txt'),
      inside: false,
    })
  })

  test.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'a path that cannot be resolved with certainty counts as outside',
    async () => {
      const verdicts = verdictsSaying(() => ALLOW)
      await commandsEngine(data, { tools: { verdicts: verdicts.layer } })(({ profile }) =>
        profile.use(
          Effect.gen(function* () {
            const { mission, main } = yield* acmeWithMission(work)
            const closed = join(main, 'closed')
            mkdirSync(closed)
            chmodSync(closed, 0o000)
            const builder = yield* sessionOf('builder', main, { kind: 'mission', id: mission.id })
            yield* callTool(builder.grantId, 'fs_read', { path: 'closed/inner/file.txt' }).pipe(
              Effect.ensuring(Effect.sync(() => chmodSync(closed, 0o700))),
            )
          }),
        ),
      )
      expect(verdicts.asked[0]?.path).toMatchObject({ inside: false, certain: false })
    },
  )
})

describe('A verdict that asks is one question, answered at once', () => {
  test('the question is created once, and the agent is told it was refused', async () => {
    const verdicts = verdictsSaying(() => ({
      verdict: 'ask',
      reason: 'a write in the Workspace',
      by: 'suite',
    }))
    const questions = questionsKept()
    const answer = await commandsEngine(data, {
      tools: { verdicts: verdicts.layer, permissionRequests: questions.layer },
    })(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { mission, main } = yield* acmeWithMission(work)
          const builder = yield* sessionOf('builder', main, { kind: 'mission', id: mission.id })
          return yield* callTool(builder.grantId, 'fs_write', {
            path: 'notes.md',
            content: 'x',
            why: 'the notes of the plan',
          })
        }),
      ),
    )
    expect(answer.text).toBe('refused: approvals are not available yet')
    expect(questions.asked).toHaveLength(1)
    expect(questions.asked[0]?.reason).toBe('a write in the Workspace')
    expect(questions.asked[0]?.call.why).toBe('the notes of the plan')
  })
})

describe('Workflow tools respect places, and never ask', () => {
  const session = (root: string) => ({
    sessionId: 's',
    role: 'builder' as const,
    projectId: 'p',
    missionId: 'm',
    place: { kind: 'workspace' as const, readOnly: false, root },
  })

  test('a path outside the place is refused with its reason, and no question is created', async () => {
    const questions = questionsKept()
    const refused = await Effect.runPromise(
      placesForWorkflow(
        session(join(work, 'acme')),
        { named: '../x', resolved: join(work, 'x'), inside: false, certain: true },
        work,
      ).pipe(
        Effect.provide(Layer.succeed(SensitivePlaces, { sensitive: () => Effect.succeed(null) })),
      ),
    )
    expect(refused).toBe('refused: outside the Workspace: ~/x')
    expect(questions.asked).toEqual([])
  })

  test('a path in a sensitive place is refused with the reason the port gives', async () => {
    const refused = await Effect.runPromise(
      placesForWorkflow(
        session(join(work, 'acme')),
        { named: '.env', resolved: join(work, 'acme', '.env'), inside: true, certain: true },
        work,
      ).pipe(
        Effect.provide(
          Layer.succeed(SensitivePlaces, {
            sensitive: (path) =>
              Effect.succeed(path.endsWith('.env') ? 'a sensitive place: .env' : null),
          }),
        ),
      ),
    )
    expect(refused).toBe('refused: a sensitive place: .env')
  })

  test('commands_stop, a workflow tool, never reaches a verdict', async () => {
    const verdicts = verdictsSaying(() => ALLOW)
    const answer = await commandsEngine(data, { tools: { verdicts: verdicts.layer } })(
      ({ profile }) =>
        profile.use(
          Effect.gen(function* () {
            const { mission, main } = yield* acmeWithMission(work)
            const builder = yield* sessionOf('builder', main, { kind: 'mission', id: mission.id })
            return yield* callTool(builder.grantId, 'commands_stop', { run: 'no-such-run' })
          }),
        ),
    )
    expect(answer.text).toBe('refused: no-such-run is not a run this mission started')
    expect(verdicts.asked).toEqual([])
  })
})

describe('The arguments decode with the tool’s schema', () => {
  test('a call whose arguments do not read is refused naming the field', async () => {
    const answer = await commandsEngine(data)(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { mission, main } = yield* acmeWithMission(work)
          const builder = yield* sessionOf('builder', main, { kind: 'mission', id: mission.id })
          return yield* callTool(builder.grantId, 'fs_read', { range: { offset: -1 } })
        }),
      ),
    )
    expect(answer.text).toMatch(/^refused: the arguments of fs_read do not read: The field `path`/)
  })
})

describe('The same call key executes once', () => {
  test('a second call under the same key is answered the first one’s answer, and recorded once', async () => {
    const verdicts = verdictsSaying(() => ALLOW)
    const [first, second, calls, actions] = await commandsEngine(data, {
      tools: { verdicts: verdicts.layer },
    })(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { mission, main } = yield* acmeWithMission(work)
          const builder = yield* sessionOf('builder', main, { kind: 'mission', id: mission.id })
          const write = { path: 'notes.md', content: 'once' }
          const written = yield* callTool(builder.grantId, 'fs_write', write, 'toolu_1')
          const again = yield* callTool(builder.grantId, 'fs_write', write, 'toolu_1')
          return [
            written,
            again,
            yield* callsOf(builder.sessionId),
            yield* actionsRecorded,
          ] as const
        }),
      ),
    )
    expect(first).toEqual({ ok: true, refused: false, text: 'wrote notes.md (4 bytes)' })
    expect(second).toEqual(first)
    expect(calls).toHaveLength(1)
    expect(actions).toHaveLength(1)
    expect(verdicts.asked).toHaveLength(1)
  })

  test('a retry that arrives while the first call runs waits for it', async () => {
    const answers = await Effect.runPromise(
      Effect.gen(function* () {
        const release = yield* Deferred.make<void>()
        const asked: string[] = []
        const holding = Layer.succeed(Verdicts, {
          judge: () =>
            Effect.andThen(
              Effect.sync(() => asked.push('judged')),
              Effect.as(Deferred.await(release), ALLOW),
            ),
        })
        const result = yield* Effect.promise(() =>
          commandsEngine(data, { tools: { verdicts: holding } })(({ profile }) =>
            profile.use(
              Effect.gen(function* () {
                const { mission, main } = yield* acmeWithMission(work)
                const builder = yield* sessionOf('builder', main, {
                  kind: 'mission',
                  id: mission.id,
                })
                const write = { path: 'notes.md', content: 'once' }
                const first = yield* Effect.forkChild(
                  callTool(builder.grantId, 'fs_write', write, 'toolu_2'),
                )
                yield* Effect.sleep('50 millis')
                const retry = yield* Effect.forkChild(
                  callTool(builder.grantId, 'fs_write', write, 'toolu_2'),
                )
                yield* Effect.sleep('50 millis')
                yield* Deferred.succeed(release, undefined)
                return [yield* Fiber.join(first), yield* Fiber.join(retry), asked] as const
              }),
            ),
          ),
        )
        return result
      }),
    )
    expect(answers[0]).toMatchObject({ ok: true })
    expect(answers[1]).toEqual(answers[0])
    expect(answers[2]).toEqual(['judged'])
  })
})

describe('Writing only on the version that was read', () => {
  const engine = () =>
    commandsEngine(data, {
      tools: { verdicts: verdictsSaying(() => ALLOW).layer },
      secrets: (() => {
        const secrets = secretsRegistry()
        secrets.register('project-variables:acme', ['hunter2'])
        return secrets
      })(),
    })

  test('fs_write on a file the session never read is refused if the file exists', async () => {
    const answer = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { mission, main } = yield* acmeWithMission(work)
          writeFileSync(join(main, 'README.md'), 'mine\n')
          const builder = yield* sessionOf('builder', main, { kind: 'mission', id: mission.id })
          return yield* callTool(builder.grantId, 'fs_write', { path: 'README.md', content: 'x' })
        }),
      ),
    )
    expect(answer.text).toBe(
      'refused: README.md exists and this session has not read it: read it with fs_read first',
    )
    expect(readFileSync(join(work, 'acme', 'README.md'), 'utf8')).toBe('mine\n')
  })

  test('fs_write refuses when the file changed after the session read it, and shows the change masked', async () => {
    const answer = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { mission, main } = yield* acmeWithMission(work)
          writeFileSync(join(main, 'config.txt'), 'name = acme\nport = 80\nend\n')
          const builder = yield* sessionOf('builder', main, { kind: 'mission', id: mission.id })
          yield* callTool(builder.grantId, 'fs_read', { path: 'config.txt' })
          writeFileSync(join(main, 'config.txt'), 'name = acme\npassword = hunter2\nend\n')
          return yield* callTool(builder.grantId, 'fs_write', {
            path: 'config.txt',
            content: 'name = acme\nport = 81\nend\n',
          })
        }),
      ),
    )
    expect(answer.ok).toBe(false)
    expect(answer.text).toContain(
      'refused: config.txt changed since this session read it; read it again before writing.',
    )
    expect(answer.text).toContain('- port = 80')
    expect(answer.text).toContain('+ password = •••')
    expect(answer.text).not.toContain('hunter2')
    expect(readFileSync(join(work, 'acme', 'config.txt'), 'utf8')).toContain('password')
  })

  test('a file read then written is written, its mode kept, and written again on what it wrote', async () => {
    const answers = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { mission, main } = yield* acmeWithMission(work)
          writeFileSync(join(main, 'run.sh'), '#!/bin/sh\necho one\n', { mode: 0o755 })
          const builder = yield* sessionOf('builder', main, { kind: 'mission', id: mission.id })
          yield* callTool(builder.grantId, 'fs_read', { path: 'run.sh' })
          return [
            yield* callTool(builder.grantId, 'fs_write', {
              path: 'run.sh',
              content: '#!/bin/sh\necho two\n',
            }),
            yield* callTool(builder.grantId, 'fs_edit', {
              path: 'run.sh',
              edits: [{ old: 'two', new: 'three' }],
            }),
            yield* callTool(builder.grantId, 'fs_write', {
              path: 'docs/new/notes.md',
              content: 'new',
            }),
          ] as const
        }),
      ),
    )
    expect(answers.map((answer) => answer.ok)).toEqual([true, true, true])
    const file = join(work, 'acme', 'run.sh')
    expect(readFileSync(file, 'utf8')).toBe('#!/bin/sh\necho three\n')
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o755)
    expect(readFileSync(join(work, 'acme', 'docs', 'new', 'notes.md'), 'utf8')).toBe('new')
  })

  test('a write over a file another process holds open replaces it, or fails clearly and leaves it whole', async () => {
    const file = join(work, 'acme', 'held.txt')
    const holder = async () => {
      // On Windows the holder shares nothing, as an editor or an antivirus may; elsewhere an
      // open file never stops a rename.
      const child =
        process.platform === 'win32'
          ? spawn('powershell.exe', [
              '-NoProfile',
              '-Command',
              `$f = [System.IO.File]::Open('${file}', 'Open', 'Read', 'None'); 'held'; Start-Sleep -Seconds 60`,
            ])
          : spawn(process.execPath, [
              '-e',
              `require('node:fs').openSync(${JSON.stringify(file)}, 'r'); console.log('held'); setInterval(() => {}, 1000)`,
            ])
      await once(child.stdout, 'data')
      return child
    }
    const answer = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { mission, main } = yield* acmeWithMission(work)
          writeFileSync(join(main, 'held.txt'), 'before\n')
          const builder = yield* sessionOf('builder', main, { kind: 'mission', id: mission.id })
          yield* callTool(builder.grantId, 'fs_read', { path: 'held.txt' })
          return yield* Effect.acquireUseRelease(
            Effect.promise(holder),
            () => callTool(builder.grantId, 'fs_write', { path: 'held.txt', content: 'after\n' }),
            (child) => Effect.promise(() => endChild(child)),
          )
        }),
      ),
    )
    const now = readFileSync(file, 'utf8')
    // Which of the two the system chose, for the record of a run on each system.
    console.info(`a held file on ${process.platform}: ${answer.ok ? 'replaced' : answer.text}`)
    if (answer.ok) expect(now).toBe('after\n')
    else {
      // A file shared with no one cannot even be read for its version: refused before writing.
      expect(answer.text).toMatch(
        /^could not (?:write held\.txt: .*; the file is as it was|read held\.txt: .*; nothing was written)$/,
      )
      expect(now).toBe('before\n')
    }
    expect(['after\n', 'before\n']).toContain(now)
  })

  test('fs_edit with an anchor found twice or not at all changes nothing', async () => {
    const answers = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { mission, main } = yield* acmeWithMission(work)
          writeFileSync(join(main, 'a.txt'), 'one two two\n')
          const builder = yield* sessionOf('builder', main, { kind: 'mission', id: mission.id })
          yield* callTool(builder.grantId, 'fs_read', { path: 'a.txt' })
          return [
            yield* callTool(builder.grantId, 'fs_edit', {
              path: 'a.txt',
              edits: [{ old: 'two', new: '2' }],
            }),
            yield* callTool(builder.grantId, 'fs_edit', {
              path: 'a.txt',
              edits: [
                { old: 'one', new: '1' },
                { old: 'three', new: '3' },
              ],
            }),
          ] as const
        }),
      ),
    )
    expect(answers[0].text).toBe(
      'refused: the anchor of edit 1 appears 2 time(s) in a.txt; it must appear exactly once. Nothing was changed',
    )
    expect(answers[1].text).toBe(
      'refused: the anchor of edit 2 appears 0 time(s) in a.txt; it must appear exactly once. Nothing was changed',
    )
    expect(readFileSync(join(work, 'acme', 'a.txt'), 'utf8')).toBe('one two two\n')
  })

  test('fs_edit of a file the session never read is refused', async () => {
    const answer = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { mission, main } = yield* acmeWithMission(work)
          writeFileSync(join(main, 'a.txt'), 'one\n')
          const builder = yield* sessionOf('builder', main, { kind: 'mission', id: mission.id })
          return yield* callTool(builder.grantId, 'fs_edit', {
            path: 'a.txt',
            edits: [{ old: 'one', new: '1' }],
          })
        }),
      ),
    )
    expect(answer.text).toBe(
      'refused: this session has not read a.txt: read it with fs_read before editing it',
    )
  })

  test('the fingerprint of a read survives a restart with the session', async () => {
    let grant = ''
    let mission = ''
    const first = engine()
    await first(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const made = yield* acmeWithMission(work)
          mission = made.mission.id
          writeFileSync(join(made.main, 'a.txt'), 'one\n')
          const builder = yield* sessionOf('builder', made.main, { kind: 'mission', id: mission })
          grant = builder.sessionId
          yield* callTool(builder.grantId, 'fs_read', { path: 'a.txt' })
        }),
      ),
    )
    const answer = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const token = yield* HemeraEndpoint.use((endpoint) => endpoint.mint(grant))
          const again = yield* ToolAccess.use((access) => access.byToken(token))
          return yield* callTool(again?.id ?? '', 'fs_write', { path: 'a.txt', content: 'two\n' })
        }),
      ),
    )
    expect(answer).toMatchObject({ ok: true })
    expect(readFileSync(join(work, 'acme', 'a.txt'), 'utf8')).toBe('two\n')
  })
})

describe('The gate never reads the agent’s own permission mode', () => {
  test('the verdict is the same whatever mode the agent stands on', async () => {
    const verdicts = verdictsSaying(() => ({ verdict: 'deny', reason: 'not here', by: 'suite' }))
    const answers = await commandsEngine(data, { tools: { verdicts: verdicts.layer } })(
      ({ profile }) =>
        profile.use(
          Effect.gen(function* () {
            const { mission, main } = yield* acmeWithMission(work)
            const builder = yield* sessionOf('builder', main, { kind: 'mission', id: mission.id })
            const database = yield* Database
            const said: string[] = []
            for (const mode of ['default', 'acceptEdits', 'bypassPermissions', 'plan']) {
              yield* database
                .update(agentSessions)
                .set({ chosenMode: mode, takenMode: mode })
                .where(eq(agentSessions.id, builder.sessionId))
              const answer = yield* callTool(builder.grantId, 'fs_write', {
                path: 'notes.md',
                content: 'x',
              })
              said.push(answer.text)
            }
            return said
          }),
        ),
    )
    expect(new Set(answers)).toEqual(new Set(['refused: not here']))
    expect(new Set(verdicts.asked.map((call) => JSON.stringify(call))).size).toBe(1)
  })
})

describe('Every call is recorded', () => {
  test('with its session, role, mission, tool, class, verdict and who gave it, outcome and duration', async () => {
    const verdicts = verdictsSaying(() => ({
      verdict: 'deny',
      reason: 'the password hunter2 is not for you',
      by: 'suite',
    }))
    const secrets = secretsRegistry()
    secrets.register('project-variables:acme', ['hunter2'])
    const [calls, missionId, sessionId] = await commandsEngine(data, {
      tools: { verdicts: verdicts.layer },
      secrets,
    })(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { mission, main } = yield* acmeWithMission(work)
          const builder = yield* sessionOf('builder', main, { kind: 'mission', id: mission.id })
          yield* callTool(builder.grantId, 'fs_write', { path: 'a.md', content: 'x' })
          return [yield* callsOf(builder.sessionId), mission.id, builder.sessionId] as const
        }),
      ),
    )
    expect(calls).toMatchObject([
      {
        sessionId,
        role: 'builder',
        missionId,
        tool: 'fs_write',
        gateClass: 'judged',
        verdict: 'deny',
        verdictBy: 'suite',
        outcome: 'refused',
        reason: 'refused: the password ••• is not for you',
      },
    ])
    expect(calls[0]?.durationMs).toBeGreaterThanOrEqual(0)
  })
})

describe('A path the agent copies from a shell', () => {
  test('`~` is the home folder', async () => {
    const verdicts = verdictsSaying(() => ALLOW)
    await commandsEngine(data, { tools: { verdicts: verdicts.layer } })(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { mission, main } = yield* acmeWithMission(work)
          const builder = yield* sessionOf('builder', main, { kind: 'mission', id: mission.id })
          yield* callTool(builder.grantId, 'fs_read', { path: '~/.hemera-test-nothing' })
        }),
      ),
    )
    expect(verdicts.asked[0]?.path?.resolved).toBe(join(homedir(), '.hemera-test-nothing'))
  })
})
