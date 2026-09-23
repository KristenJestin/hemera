/**
 * The commands of a Project, as the panel and the thread read them (D6-11, D6-12, D8-07).
 *
 * Each suite is named after the scenario of the issue's Spec section that it covers, and nothing
 * here is mocked: the engine is the real one — the Projects, the Sessions and the commands over a
 * database in a temporary folder — and the commands are real children of the machine running the
 * tests, started through the real supervisor. A run that says it failed has to have failed.
 */

import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vite-plus/test'
import { Effect, Layer, Result } from 'effect'

import { Commands, Platform } from '#engine/commands/service.ts'
import { Projects } from '#engine/projects.ts'
import { Sessions } from '#engine/sessions.ts'
import { SqliteClient } from '#engine/storage/database.ts'

import {
  FAILS_LOUDLY,
  PUBLISHES_AN_ADDRESS,
  diagnostics,
  engine,
  opened,
  request,
  runEntries,
  runLines,
  scratch,
  until,
} from './commands-engine.ts'

describe('A one-off command shows and is not promoted', () => {
  it('keeps what it said on standard error, its exit code, and one entry of the thread', async () => {
    const seen = await engine()(
      Effect.gen(function* () {
        const session = yield* opened
        const commands = yield* Commands
        // A one-off: a line the agent wrote, which the catalogue never hears about.
        const started = yield* commands.run(
          request(session, { name: 'boom', line: FAILS_LOUDLY, type: 'test', startedBy: 'agent' }),
        )
        const settled = yield* until(
          Effect.gen(function* () {
            return {
              run: yield* commands.output(session.sessionId, started.id),
              entries: yield* runEntries(session.sessionId),
            }
          }),
          // The run has ended, what it printed has arrived, and the thread has been told: the
          // three are one moment, and reading them apart would read a run mid-death.
          (read) =>
            read.run.state !== 'running' &&
            read.run.output.includes('boom') &&
            read.entries.some((entry) => entry.state !== 'running'),
        )
        return {
          settled,
          catalogue: yield* commands.list(session.projectId),
        }
      }),
    )

    // What a failing tool says on standard error is what the agent came for: an exit code with
    // nothing under it would be a failure nobody can account for.
    expect(seen.settled.run.output).toContain('boom')
    // It is the run's output and nothing else: the engine's diagnostic log does not copy it.
    expect(diagnostics.some((line) => line.includes('boom'))).toBe(false)
    expect(seen.settled.run.exitCode).toBe(3)
    expect(seen.settled.run.state).toBe('failed')
    // A one-off is run, not remembered: the catalogue is the user's and nothing promotes into it.
    expect(seen.catalogue).toHaveLength(0)

    // One entry for the run, started and ended: the thread shows a block that changed state
    // rather than the same command twice.
    expect(seen.settled.entries).toHaveLength(1)
    const entry = seen.settled.entries[0]
    expect(entry?.kind).toBe('command_run')
    expect(entry?.role).toBe('hemera')
    expect(entry?.body).toBe('boom')
    expect(entry?.state).toBe('failed')
    // What the block on screen is drawn from: the run, as it ended, and the fact that a line
    // the agent wrote is not a command of the catalogue.
    expect(JSON.parse(entry?.payload ?? '{}')).toMatchObject({
      runId: seen.settled.run.id,
      name: 'boom',
      type: 'test',
      state: 'failed',
      cwd: scratch.root,
      url: null,
      exitCode: 3,
      startedBy: 'agent',
      oneOff: true,
    })
  })
})

describe('The agent starts the app and the user opens it', () => {
  it('reads the address from the output, and the thread entry carries it', async () => {
    const seen = await engine()(
      Effect.gen(function* () {
        const session = yield* opened
        const commands = yield* Commands
        const saved = yield* commands.save(
          {
            projectId: session.projectId,
            name: 'dev',
            line: PUBLISHES_AN_ADDRESS,
            type: 'serve',
            lineWindows: null,
            lineLinux: null,
            scope: 'workspace',
            portless: false,
            folder: null,
          },
          false,
        )
        const started = yield* commands.run(
          request(session, {
            commandId: saved.id,
            name: saved.name,
            line: saved.line,
            type: saved.type,
            startedBy: 'agent',
          }),
        )
        // The address is the first one the output names, and it is named while the app runs.
        const published = yield* until(
          commands.output(session.sessionId, started.id),
          (view) => view.url !== null,
        )
        // The user closes it, which is what rewrites the entry with what the run had become.
        const ended = yield* commands.stop(session.sessionId, started.id)
        return { published, ended, entries: yield* runEntries(session.sessionId) }
      }),
    )

    expect(seen.published.url).toBe('http://localhost:4321')
    expect(seen.ended.state).toBe('stopped')

    expect(seen.entries).toHaveLength(1)
    const entry = seen.entries[0]
    expect(entry?.body).toBe('dev')
    expect(entry?.state).toBe('stopped')
    // The address the user opens is in the block, and the block says this run has a name in the
    // catalogue: a command of the Project can be run again by name, a one-off cannot.
    expect(JSON.parse(entry?.payload ?? '{}')).toMatchObject({
      name: 'dev',
      type: 'serve',
      state: 'stopped',
      url: 'http://localhost:4321',
      oneOff: false,
    })
  })
})

describe('A run is written in the Journal under whoever started it', () => {
  it('names the human for a run of the panel, and the tool for a run of the agent', async () => {
    const seen = await engine()(
      Effect.gen(function* () {
        const session = yield* opened
        const commands = yield* Commands
        const run = (startedBy: 'agent' | 'user') =>
          commands.run(
            request(session, {
              name: startedBy,
              line: `${process.execPath} -e 0`,
              type: 'test',
              startedBy,
            }),
          )
        const user = yield* run('user')
        yield* run('agent')
        const lines = yield* runLines(session.projectId)
        return { user, started: lines.filter((entry) => entry.type === 'command.run_started') }
      }),
    )

    const byName = (name: string) =>
      seen.started.find((entry) => JSON.stringify(entry.payload).includes(`"name":"${name}"`))
    expect(byName('user')?.author).toBe('human')
    expect(byName('agent')?.author).toBe('mcp')
    // The run is the entity of its lines, in the Workspace it ran in (D8-16).
    expect(byName('user')?.entityKind).toBe('command')
    expect(byName('user')?.entityId).toBe(seen.user.id)
    expect(byName('user')?.payload).toMatchObject({ name: 'user', workspaceName: 'main' })
  })
})

describe('A stopped run ends once', () => {
  it('ends stopped, with one event for its end, however the platform reports the death', async () => {
    const seen = await engine()(
      Effect.gen(function* () {
        const session = yield* opened
        const commands = yield* Commands
        const started = yield* commands.run(
          request(session, { name: 'server', line: PUBLISHES_AN_ADDRESS, type: 'serve' }),
        )
        const ended = yield* commands.stop(session.sessionId, started.id)
        // Anything the watcher would still write arrives now, not after the suite has read.
        yield* Effect.sleep('200 millis')
        const lines = yield* runLines(session.projectId)
        return {
          ended,
          row: (yield* commands.recent(session.sessionId))[0],
          ends: lines.filter((entry) => entry.type !== 'command.run_started'),
        }
      }),
    )

    expect(seen.ended.state).toBe('stopped')
    expect(seen.row?.state).toBe('stopped')
    expect(seen.ends.map((entry) => entry.type)).toEqual(['command.run_ended'])
    expect(seen.ends[0]?.payload).toMatchObject({ state: 'stopped' })
  })
})

describe('A run whose end cannot be recorded', () => {
  it('still ends: a stop returns, and the diagnostic log says the row was not written', async () => {
    const seen = await engine()(
      Effect.gen(function* () {
        const session = yield* opened
        const commands = yield* Commands
        const started = yield* commands.run(
          request(session, { name: 'server', line: PUBLISHES_AN_ADDRESS, type: 'serve' }),
        )
        // The database refuses every later write of a run, as a locked or full one would.
        const sql = yield* SqliteClient
        yield* sql.unsafe(
          "CREATE TRIGGER refuse_runs BEFORE UPDATE ON command_runs BEGIN SELECT RAISE(ABORT, 'disk full'); END",
        )
        const stopped = yield* commands
          .stop(session.sessionId, started.id)
          .pipe(Effect.timeout('10 seconds'), Effect.result)
        return { stopped, lines: [...diagnostics] }
      }),
    )

    expect(Result.isSuccess(seen.stopped)).toBe(true)
    expect(seen.lines.some((line) => line.includes('was not recorded'))).toBe(true)
  })
})

describe('A run that ended is left as it ended', () => {
  it('keeps its end and what it printed when its Session is swept afterwards', async () => {
    const seen = await engine()(
      Effect.gen(function* () {
        const session = yield* opened
        const commands = yield* Commands
        const started = yield* commands.run(
          request(session, { name: 'boom', line: FAILS_LOUDLY, type: 'test', startedBy: 'agent' }),
        )
        // Ended and written: the row says so, which is when the run is no longer held in memory.
        yield* until(commands.recent(session.sessionId), (rows) => rows[0]?.state === 'failed')
        yield* commands.stopped(session.sessionId)
        const lines = yield* runLines(session.projectId)
        return {
          read: yield* commands.output(session.sessionId, started.id),
          ends: lines.filter((entry) => entry.type === 'command.run_ended'),
        }
      }),
    )

    expect(seen.read.state).toBe('failed')
    expect(seen.read.exitCode).toBe(3)
    expect(seen.read.output).toContain('boom')
    // One end, the one it had: the sweep writes no second one.
    expect(seen.ends).toHaveLength(1)
    expect(seen.ends[0]?.payload).toMatchObject({ state: 'failed', exitCode: 3 })
  })
})

describe('A running app is shared by the Sessions of its Project', () => {
  it('is joined, read and stopped from another Session, and from no other Project', async () => {
    const seen = await engine()(
      Effect.gen(function* () {
        const first = yield* opened
        const sessions = yield* Sessions
        const projects = yield* Projects
        const second = yield* sessions.create(first.projectId, 'claude')
        const elsewhere = yield* projects.create({
          name: 'Other',
          tone: 'primary',
          mainPath: scratch.folder,
        })
        const stranger = yield* sessions.create(elsewhere.id, 'claude')
        const commands = yield* Commands
        const run = (sessionId: string) =>
          commands.run(
            request(
              { projectId: first.projectId, sessionId },
              { name: 'dev', line: PUBLISHES_AN_ADDRESS, type: 'serve', startedBy: 'agent' },
            ),
          )
        const started = yield* run(first.sessionId)
        const joined = yield* run(second.id)
        const read = yield* commands.output(second.id, started.id)
        const refused = yield* commands.output(stranger.id, started.id).pipe(Effect.flip)
        const stopped = yield* commands.stop(second.id, started.id)
        return { started, joined, read, refused, stopped }
      }),
    )

    expect(seen.joined.joined).toBe(true)
    expect(seen.joined.id).toBe(seen.started.id)
    expect(seen.read.id).toBe(seen.started.id)
    expect(seen.refused.message).toContain(seen.started.id)
    expect(seen.stopped.state).toBe('stopped')
  })
})

/** A program that prints the arguments it was given, one `|` between two of them. */
const PRINTS_ITS_ARGUMENTS = `-e "console.log(process.argv.slice(1).join('|'))"`

/** Starts one line as a `test` of the suite's Session and reads it once it has ended. */
const ranToTheEnd = (line: string) =>
  Effect.gen(function* () {
    const session = yield* opened
    const commands = yield* Commands
    const started = yield* commands.run(request(session, { name: 'arguments', line, type: 'test' }))
    return yield* until(
      commands.output(session.sessionId, started.id),
      (view) => view.state !== 'running',
    )
  })

describe('A line is split into words, a quoted one staying whole', () => {
  it('hands the program a quoted argument as one argument', async () => {
    const seen = await engine()(
      ranToTheEnd(`"${process.execPath}" ${PRINTS_ITS_ARGUMENTS} "two words" plain`),
    )

    expect(seen.state).toBe('exited')
    expect(seen.output).toContain('two words|plain')
  })

  it.runIf(process.platform === 'win32')(
    'runs a .cmd shim through cmd.exe, with its arguments as they were written',
    async () => {
      // A shim as npm writes one: a batch file that hands its arguments on to a program.
      writeFileSync(
        join(scratch.root, 'echo-args.cmd'),
        `@"${process.execPath}" ${PRINTS_ITS_ARGUMENTS} %*\r\n`,
      )
      const before = process.env['PATH']
      process.env['PATH'] = `${scratch.root};${before ?? ''}`
      try {
        const seen = await engine()(ranToTheEnd('echo-args "two words" "a&b" plain'))

        expect(seen.state).toBe('exited')
        expect(seen.output).toContain('two words|a&b|plain')
      } finally {
        process.env['PATH'] = before
      }
    },
  )
})

describe('A run keeps the first address it names', () => {
  it('does not move to an address printed later', async () => {
    const seen = await engine()(
      ranToTheEnd(
        `"${process.execPath}" -e "console.log('http://127.0.0.1:4000');console.log('http://localhost:5000')"`,
      ),
    )

    expect(seen.output).toContain('localhost:5000')
    expect(seen.url).toBe('http://127.0.0.1:4000')
  })
})

describe('The machine runs its own variant', () => {
  it('runs the Windows line on Windows and the default line on Linux, and keeps the line run', async () => {
    // What the catalogue holds: a default line, and a line of its own for Windows.
    const seed = { name: 'seed', line: './scripts/seed.sh', lineWindows: 'scripts\\seed.cmd' }
    const ranOn = (platform: string) =>
      engine(Layer.succeed(Platform, platform))(
        Effect.gen(function* () {
          const session = yield* opened
          const commands = yield* Commands
          const started = yield* commands.run(request(session, { ...seed, type: 'script' }))
          return yield* until(
            commands.output(session.sessionId, started.id),
            (view) => view.state !== 'running',
          )
        }),
      )
    // The default line is a script of the Workspace, which this machine can really run.
    mkdirSync(join(scratch.root, 'scripts'))
    writeFileSync(join(scratch.root, 'scripts', 'seed.sh'), '#!/bin/sh\necho seeded\n')
    chmodSync(join(scratch.root, 'scripts', 'seed.sh'), 0o755)

    const linux = await ranOn('linux')
    const windows = await ranOn('win32')

    expect(linux.line).toBe('./scripts/seed.sh')
    expect(windows.line).toBe('scripts\\seed.cmd')
    // The Linux one ran for real where it can: the line kept is the line that ran.
    if (process.platform === 'linux') expect(linux.output).toContain('seeded')
  })
})

describe('A run shows what it ran', () => {
  it('keeps the line run, its folder, the variables given, its output and its exit code', async () => {
    const api = join(scratch.root, 'sources', 'api')
    mkdirSync(api, { recursive: true })
    const seen = await engine()(
      Effect.gen(function* () {
        const session = yield* opened
        const commands = yield* Commands
        const saved = yield* commands.save(
          {
            projectId: session.projectId,
            name: 'test',
            line: `"${process.execPath}" -e "console.log('port '+process.env.PORT);process.exit(1)"`,
            type: 'test',
            lineWindows: null,
            lineLinux: null,
            scope: 'workspace',
            portless: false,
            folder: 'sources/api',
          },
          false,
        )
        const started = yield* commands.run(
          request(session, {
            commandId: saved.id,
            name: saved.name,
            line: saved.line,
            type: saved.type,
            folder: saved.folder,
            cwd: api,
            environment: { PORT: '3001' },
          }),
        )
        // Ended, what it printed arrived, and its entry rewritten: one moment, read as one.
        return yield* until(
          Effect.gen(function* () {
            return {
              saved,
              run: yield* commands.output(session.sessionId, started.id),
              entries: yield* runEntries(session.sessionId),
            }
          }),
          (read) =>
            read.run.state !== 'running' &&
            read.run.output.includes('port') &&
            read.entries.some((entry) => entry.state !== 'running'),
        )
      }),
    )

    expect(seen.run.line).toBe(seen.saved.line)
    expect(seen.run.folder).toBe('sources/api')
    expect(seen.run.cwd).toBe(api)
    expect(seen.run.environment['PORT']).toBe('3001')
    // The variable reached the process: what it printed says so.
    expect(seen.run.output).toContain('port 3001')
    expect(seen.run.exitCode).toBe(1)
    expect(seen.run.state).toBe('failed')
    expect(JSON.parse(seen.entries[0]?.payload ?? '{}')).toMatchObject({
      line: seen.saved.line,
      folder: 'sources/api',
      cwd: api,
      environment: { PORT: '3001' },
      workspaceName: 'main',
      exitCode: 1,
    })
  })
})
