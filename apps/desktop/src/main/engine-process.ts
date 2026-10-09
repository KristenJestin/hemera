/**
 * The engine, started by main and joined to it by two links: main calls the engine on one, the
 * engine calls main on the other (to have an agents' process started). Under the headless
 * end-to-end suite only, a third port carries the suite's probe.
 *
 * The engine is not restarted behind anyone's back: when it stops, every call waiting on it fails
 * with `EngineGone`, main writes it down, and the window offers to restart Hemera.
 */

import { join } from 'node:path'

import {
  type TokenUnreadable,
  AgentsPortHandover,
  closesWith,
  EngineMainRpcs,
  EngineStart,
  fromMessagePortMain,
  HostRpcs,
  makeClientProtocol,
  makeServerProtocol,
  type Port,
} from '@hemera/ipc'
import { Effect, Schema } from 'effect'
import type { Scope } from 'effect'
import { RpcClient, RpcServer } from 'effect/rpc'
import { MessageChannelMain, app, utilityProcess } from 'electron/main'
import type { MessagePortMain, UtilityProcess } from 'electron/main'

import type { Log } from './diagnostic.ts'
import { launchHandlers, type Launcher } from './launches.ts'
import type { EngineClient } from './window-link.ts'

export interface Engine {
  readonly client: EngineClient
  readonly process: UtilityProcess
  /** The probe's port, under the headless end-to-end suite only. */
  readonly probe: MessagePortMain | undefined
}

const encodeStart = Schema.encodeSync(Schema.toCodecJson(EngineStart))
const encodeHandover = Schema.encodeSync(AgentsPortHandover)

/** A port of a link to `child`, which also closes when `child` exits. */
const linkTo = (child: UtilityProcess, port: MessagePortMain): Port =>
  closesWith(fromMessagePortMain(port), (close) => {
    child.once('exit', close)
  })

/** How main starts an agents' process: this application's own, with the program as argument. */
const electronLauncher = (
  main: string,
  engine: UtilityProcess,
  log: Log,
): Launcher<MessagePortMain> => ({
  fork: (program, args, environment) => {
    const child = utilityProcess.fork(join(main, '..', 'agents', 'index.js'), [program, ...args], {
      serviceName: 'agents',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...environment },
    })
    // What the agents' process itself says (never its program's lines, which travel on the port)
    // is what a process that could not start leaves behind.
    for (const pipe of [child.stdout, child.stderr]) {
      pipe?.setEncoding('utf8')
      pipe?.on('data', (text: string) => log(`agents' process for ${program}: ${text.trimEnd()}`))
    }
    return {
      get pid() {
        return child.pid
      },
      onSpawn: (listener) => {
        child.once('spawn', listener)
      },
      onExit: (listener) => {
        child.once('exit', listener)
      },
      give: (port) => child.postMessage({}, [port]),
      kill: () => {
        child.kill()
      },
    }
  },
  channel: () => {
    const { port1, port2 } = new MessageChannelMain()
    return [port1, port2]
  },
  handOver: (launch, port) =>
    engine.postMessage(encodeHandover(AgentsPortHandover.make({ launch })), [port]),
})

export const startEngine = (
  main: string,
  start: EngineStart,
  log: Log,
  withProbe: boolean,
  openToken: (ciphertext: string) => Effect.Effect<string, TokenUnreadable>,
): Effect.Effect<Engine, never, Scope.Scope> =>
  Effect.gen(function* () {
    const child = utilityProcess.fork(join(main, '..', 'engine', 'index.js'), [], {
      serviceName: 'engine',
    })

    let leaving = false
    app.once('before-quit', () => {
      leaving = true
    })
    child.once('exit', (code) => {
      if (!leaving) log(`the engine stopped with code ${String(code)}`)
    })

    const calls = new MessageChannelMain()
    const host = new MessageChannelMain()
    const probe = withProbe ? new MessageChannelMain() : undefined
    child.postMessage(encodeStart(start), [
      calls.port2,
      host.port2,
      ...(probe === undefined ? [] : [probe.port2]),
    ])

    const hostServer = yield* makeServerProtocol
    hostServer.accept(linkTo(child, host.port1))
    yield* RpcServer.make(HostRpcs, { disableFatalDefects: true }).pipe(
      Effect.provide(launchHandlers(electronLauncher(main, child, log), log, openToken)),
      Effect.provideService(RpcServer.Protocol, hostServer.protocol),
      Effect.forkScoped,
    )

    const client = yield* RpcClient.make(EngineMainRpcs).pipe(
      Effect.provideServiceEffect(
        RpcClient.Protocol,
        makeClientProtocol(linkTo(child, calls.port1), 'the engine'),
      ),
    )
    return { client, process: child, probe: probe?.port1 }
  })
