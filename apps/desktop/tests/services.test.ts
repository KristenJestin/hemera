/**
 * The services of a Project: `serve` runs per Workspace or per Project, their readiness, the
 * ports they hold, and Portless (D8-07, D8-08, D8-09, D8-10).
 *
 * Each suite is named after a scenario of the Spec section `services`. Nothing is mocked: the
 * runs are real children of this machine that print an address and stay up, as a dev server
 * does, over the real engine on a database in a temporary folder; an address that answers is a
 * real HTTP server of a child, listening when the child decides to. The second Workspace is a
 * row written as its creation would leave it, `ready`, with a folder of its own. The real
 * `portless` is never run: a machine without it is a `PATH` of an empty folder, and one with it
 * is a script of the suite standing in for it.
 */

import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { type AddressInfo, createServer } from 'node:net'
import { join } from 'node:path'
import { describe, expect, it } from 'vite-plus/test'
import { Effect, Layer } from 'effect'

import { hostLookup } from '#engine/commands/line.ts'
import { Commands, ProgramLookup, ReadinessSettings } from '#engine/commands/service.ts'
import { Sessions } from '#engine/sessions.ts'
import { Database } from '#engine/storage/database.ts'
import { workspaces } from '#engine/storage/schema.ts'

import {
  PUBLISHES_AN_ADDRESS,
  engine,
  opened,
  request,
  runLines,
  scratch,
  until,
} from './commands-engine.ts'

/** Where programs are looked for in `folder` alone: a machine whose `PATH` is that folder. */
const onlyIn = (folder: string) =>
  Layer.succeed(ProgramLookup, (cwd: string) => ({ ...hostLookup(cwd), path: folder }))

/** A dedicated Workspace of the Project, `ready`, in a folder beside `main`. */
const loginForm = (projectId: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const id = crypto.randomUUID()
    const path = join(scratch.folder, 'login-form')
    mkdirSync(path, { recursive: true })
    yield* database.insert(workspaces).values({
      id,
      projectId,
      name: 'login-form',
      path,
      createdAt: new Date().toISOString(),
      state: 'ready',
    })
    return { id, name: 'login-form', path }
  })

/**
 * The Project with its `login-form` Workspace, and a Session in each Workspace: what a `serve`
 * command is asked for from.
 */
const twoWorkspaces = Effect.gen(function* () {
  const main = yield* opened
  const workspace = yield* loginForm(main.projectId)
  const sessions = yield* Sessions
  const inLoginForm = yield* sessions.create(main.projectId, 'claude', workspace.id)
  return {
    main,
    workspace,
    inLoginForm: { projectId: main.projectId, sessionId: inLoginForm.id },
  }
})

/** `dev`, a `serve` command of the catalogue scoped to the Workspace, as the caller asks it. */
const dev = { name: 'dev', line: PUBLISHES_AN_ADDRESS, type: 'serve' as const }

describe('Two Workspaces run the same command as two instances', () => {
  it('runs dev once in login-form and once in main, and joins the login-form one again', async () => {
    const seen = await engine()(
      Effect.gen(function* () {
        const { main, workspace, inLoginForm } = yield* twoWorkspaces
        const commands = yield* Commands
        const inWorkspace = request(inLoginForm, {
          ...dev,
          cwd: workspace.path,
          workspaceId: workspace.id,
          workspaceName: workspace.name,
        })
        const first = yield* commands.run(inWorkspace)
        const second = yield* commands.run(request(main, dev))
        const again = yield* commands.run(inWorkspace)
        return {
          first,
          second,
          again,
          workspace,
          running: yield* commands.runningOf(main.projectId),
        }
      }),
    )

    expect(seen.second.joined).toBe(false)
    expect(seen.second.id).not.toBe(seen.first.id)
    // Two runs going, each in its own Workspace's folder; started in the same millisecond, they
    // are read by Workspace rather than by order.
    expect(Object.fromEntries(seen.running.map((run) => [run.workspaceName, run.cwd]))).toEqual({
      'login-form': seen.workspace.path,
      main: scratch.root,
    })
    // A third ask in login-form is its instance, handed back rather than started.
    expect(seen.again.joined).toBe(true)
    expect(seen.again.id).toBe(seen.first.id)
  })
})

describe('A Project-scoped service is one instance for all', () => {
  it('starts auth in main from a login-form Session, and joins it from a main Session', async () => {
    const seen = await engine()(
      Effect.gen(function* () {
        const { main, inLoginForm } = yield* twoWorkspaces
        const commands = yield* Commands
        // The caller resolves a Project-scoped command under main, whichever Workspace asks.
        const auth = { name: 'auth', line: PUBLISHES_AN_ADDRESS, type: 'serve' as const }
        const first = yield* commands.run(request(inLoginForm, { ...auth, scope: 'project' }))
        const second = yield* commands.run(request(main, { ...auth, scope: 'project' }))
        return { first, second, running: yield* commands.runningOf(main.projectId) }
      }),
    )

    expect(seen.running).toHaveLength(1)
    expect(seen.first.cwd).toBe(scratch.root)
    expect(seen.first.workspaceName).toBe('main')
    expect(seen.second.joined).toBe(true)
    expect(seen.second.id).toBe(seen.first.id)
  })
})

describe('Stopping one instance leaves the other running', () => {
  it('stops the login-form instance, and the main one is still running', async () => {
    const seen = await engine()(
      Effect.gen(function* () {
        const { main, workspace, inLoginForm } = yield* twoWorkspaces
        const commands = yield* Commands
        const there = yield* commands.run(
          request(inLoginForm, {
            ...dev,
            cwd: workspace.path,
            workspaceId: workspace.id,
            workspaceName: workspace.name,
          }),
        )
        const here = yield* commands.run(request(main, dev))
        const stopped = yield* commands.stop(inLoginForm.sessionId, there.id)
        return {
          here,
          stopped,
          still: yield* commands.output(main.sessionId, here.id),
          inMain: yield* commands.runningIn(null, main.projectId),
          inLoginForm: yield* commands.runningIn(workspace.id, main.projectId),
        }
      }),
    )

    expect(seen.stopped.state).toBe('stopped')
    expect(seen.still.state).toBe('running')
    expect(seen.inMain.map((run) => run.id)).toEqual([seen.here.id])
    expect(seen.inLoginForm).toEqual([])
  })
})

/** A port nothing listens on: one the system handed out, closed again before it is used. */
async function freePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, resolve))
  // SAFETY: a server listening on a TCP port answers its address as an object, never a pipe name.
  const { port } = server.address() as AddressInfo
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return port
}

/** A line that prints its address at once and stays up, never listening on it. */
const printsOnly = (port: number) =>
  `"${process.execPath}" -e "console.log('http://localhost:${String(port)}');setInterval(()=>{},1000)"`

/** A line that prints its address at once and only listens on it `after` milliseconds later. */
const listensLater = (port: number, after: number) =>
  `"${process.execPath}" -e "console.log('http://localhost:${String(port)}');setTimeout(()=>require('http').createServer((q,s)=>s.end('ok')).listen(${String(port)}),${String(after)})"`

/** A line that listens on its port, and prints its address once it does. */
const listens = (port: number) =>
  `"${process.execPath}" -e "require('http').createServer((q,s)=>s.end('ok')).listen(${String(port)},()=>console.log('http://localhost:${String(port)}'))"`

/** A line that tries to listen on a port, and dies if it is taken. */
const triesToListen = (port: number) =>
  `"${process.execPath}" -e "require('http').createServer().listen(${String(port)})"`

describe('A URL is ready only after it answers', () => {
  it('shows the address starting until it answers two seconds later, then ready', async () => {
    const port = await freePort()
    const seen = await engine()(
      Effect.gen(function* () {
        const session = yield* opened
        const commands = yield* Commands
        const started = yield* commands.run(
          request(session, { name: 'dev', line: listensLater(port, 2_000), type: 'serve' }),
        )
        const read = commands.output(session.sessionId, started.id)
        const published = yield* until(read, (view) => view.url !== null)
        // A second after the address was printed, nothing answers it yet.
        yield* Effect.sleep('1 second')
        const starting = yield* read
        const ready = yield* until(read, (view) => view.readyAt !== null)
        const lines = yield* runLines(session.projectId)
        return {
          published,
          starting,
          ready,
          row: (yield* commands.recent(session.sessionId))[0],
          readyLines: lines.filter((line) => line.type === 'command.run_ready'),
        }
      }),
    )

    expect(seen.published.readiness).toBe('starting')
    expect(seen.starting.url).toBe(`http://localhost:${String(port)}`)
    expect(seen.starting.readyAt).toBeNull()
    expect(seen.starting.readiness).toBe('starting')
    expect(seen.ready.readiness).toBe('ready')
    expect(seen.ready.readyAt).not.toBeNull()
    // Written on the row, and said in the Journal once (D8-16).
    expect(seen.row?.readyAt).toBe(seen.ready.readyAt)
    expect(seen.readyLines).toHaveLength(1)
    expect(seen.readyLines[0]?.entityId).toBe(seen.ready.id)
  })

  it('says an address that never answers is unanswered once the time is up', async () => {
    const port = await freePort()
    // The minute, shortened to a second: what is under test is its end, not its length.
    const shortened = Layer.succeed(ReadinessSettings, { everyMs: 200, forMs: 1_000 })
    const seen = await engine(shortened)(
      Effect.gen(function* () {
        const session = yield* opened
        const commands = yield* Commands
        const started = yield* commands.run(
          request(session, { name: 'dev', line: printsOnly(port), type: 'serve' }),
        )
        return yield* until(
          commands.output(session.sessionId, started.id),
          (view) => view.readiness === 'unanswered',
        )
      }),
    )

    expect(seen.state).toBe('running')
    expect(seen.readiness).toBe('unanswered')
    expect(seen.readyAt).toBeNull()
  })
})

describe('A port conflict names its holder', () => {
  it('names the main run holding the port, on a run that publishes it and on one that dies of it', async () => {
    const port = await freePort()
    const seen = await engine()(
      Effect.gen(function* () {
        const { main, workspace, inLoginForm } = yield* twoWorkspaces
        const commands = yield* Commands
        const inWorkspace = {
          cwd: workspace.path,
          workspaceId: workspace.id,
          workspaceName: workspace.name,
        }
        // main really listens on the port, and says so.
        const holder = yield* commands.run(
          request(main, { name: 'dev', line: listens(port), type: 'serve' }),
        )
        yield* until(commands.output(main.sessionId, holder.id), (view) => view.url !== null)
        // login-form prints the same address.
        const second = yield* commands.run(
          request(inLoginForm, {
            name: 'dev',
            line: printsOnly(port),
            type: 'serve',
            ...inWorkspace,
          }),
        )
        const named = yield* until(
          commands.output(inLoginForm.sessionId, second.id),
          (view) => view.portConflict !== null,
        )
        // And another tries to listen on it, and dies of it.
        const third = yield* commands.run(
          request(inLoginForm, {
            name: 'api',
            line: triesToListen(port),
            type: 'serve',
            ...inWorkspace,
          }),
        )
        // Read once its end is written: what it printed last is what names the port.
        const died = yield* commands.awaited(inLoginForm.sessionId, third.id, 5_000)
        return { holder, named, died }
      }),
    )

    const conflict = {
      port,
      runId: seen.holder.id,
      workspaceId: null,
      workspaceName: 'main',
      name: 'dev',
    }
    expect(seen.named.state).toBe('running')
    expect(seen.named.portConflict).toEqual(conflict)
    expect(seen.died.output).toContain('EADDRINUSE')
    expect(seen.died.state).toBe('failed')
    expect(seen.died.portConflict).toEqual(conflict)
  })
})

describe('Portless is refused when it is not installed', () => {
  it('refuses the launch naming portless, and starts nothing', async () => {
    const empty = join(scratch.folder, 'bin')
    mkdirSync(empty)
    const marker = join(scratch.root, 'started')
    const seen = await engine(onlyIn(empty))(
      Effect.gen(function* () {
        const session = yield* opened
        const commands = yield* Commands
        // What the line would leave behind, had anything run it.
        const line = `"${process.execPath}" -e "require('fs').writeFileSync('started','')"`
        const run = yield* commands.run(
          request(session, { name: 'dev', line, type: 'serve', portless: true }),
        )
        const lines = yield* runLines(session.projectId)
        return { run, lines: lines.map((one) => one.type) }
      }),
    )

    expect(seen.run.state).toBe('failed')
    expect(seen.run.output).toBe('portless was not found on the PATH: nothing was started')
    expect(seen.run.pid).toBeNull()
    expect(existsSync(marker)).toBe(false)
    // Ended at once: never started, so never said to have started (D8-16).
    expect(seen.lines).toEqual(['command.run_ended'])
  })
})

describe('A Portless command runs through portless under its Workspace name', () => {
  it.runIf(process.platform !== 'win32')(
    'runs portless <workspace>-<name> <line>, reads its address, and names no conflict',
    async () => {
      // A stand-in for `portless`: it prints the address the real one would, then runs the line.
      const bin = join(scratch.folder, 'bin')
      mkdirSync(bin)
      writeFileSync(
        join(bin, 'portless'),
        '#!/bin/sh\necho "https://$1.localhost"\nshift\nexec "$@"\n',
      )
      chmodSync(join(bin, 'portless'), 0o755)
      const line = `"${process.execPath}" -e "console.log(process.argv.slice(1).join('|'));setInterval(()=>{},1000)" two words`
      const seen = await engine(onlyIn(bin))(
        Effect.gen(function* () {
          const { workspace, inLoginForm } = yield* twoWorkspaces
          const commands = yield* Commands
          const started = yield* commands.run(
            request(inLoginForm, {
              name: 'Dev',
              line,
              type: 'serve',
              portless: true,
              cwd: workspace.path,
              workspaceId: workspace.id,
              workspaceName: workspace.name,
            }),
          )
          return yield* until(
            commands.output(inLoginForm.sessionId, started.id),
            (view) => view.url !== null && view.output.includes('two|words'),
          )
        }),
      )

      expect(seen.line).toBe(`portless login-form-dev ${line}`)
      expect(seen.state).toBe('running')
      expect(seen.url).toBe('https://login-form-dev.localhost')
      expect(seen.output).toContain('two|words')
      expect(seen.portConflict).toBeNull()
    },
  )
})
