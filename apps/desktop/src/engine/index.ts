/**
 * The engine: the utility process that will hold the database, the agents and every business
 * rule. For now it serves its links and nothing else.
 *
 * Main posts one start message on this process's port before anything else: the start itself,
 * typed and decoded, with the ports of the engine's links. The engine serves its own group on the
 * first, calls main's on the second, and, under the headless end-to-end suite only, serves the
 * suite's probe on a third. Every later message on this process's port is the port of an agents'
 * process main started for the engine. The engine uses no Electron API but its ports.
 */

import {
  AgentsPortHandover,
  EngineRpcs,
  EngineStart,
  fromMessagePortMain,
  HostRpcs,
  makeClientProtocol,
  makeServerProtocol,
} from '@hemera/ipc'
import { Effect, Option, Schema } from 'effect'
import type { Scope } from 'effect'
import type { MessagePortMain, ParentPort } from 'electron'
import { RpcClient, RpcServer } from 'effect/rpc'

import { openDiagnosticLog, type Log } from '../main/diagnostic.ts'
import { headless } from '../main/window-options.ts'
import { agentsLauncher } from './agents.ts'
import { portHandovers } from './handovers.ts'
import { probeHandlers, ProbeRpcs } from './probe.ts'
import { engineHandlers } from './serve.ts'

const readStart = Schema.decodeUnknownOption(Schema.toCodecJson(EngineStart))
const readHandover = Schema.decodeUnknownOption(AgentsPortHandover)

const serveOn = (port: MessagePortMain) =>
  Effect.gen(function* () {
    const server = yield* makeServerProtocol
    server.accept(fromMessagePortMain(port))
    return server.protocol
  })

const engine = (
  start: EngineStart,
  [enginePort, hostPort, probePort]: ReadonlyArray<MessagePortMain>,
  parent: ParentPort,
  log: Log,
): Effect.Effect<never, never, Scope.Scope> =>
  Effect.gen(function* () {
    if (enginePort === undefined || hostPort === undefined) {
      log('the start message carried no port to serve on; the engine stops')
      return yield* Effect.die(new Error('no port to serve on'))
    }

    const handovers = portHandovers<MessagePortMain>()
    parent.on('message', ({ data, ports: [port] }) => {
      const handover = readHandover(data)
      if (Option.isSome(handover) && port !== undefined) {
        handovers.receive(handover.value.launch, port)
      }
    })

    yield* RpcServer.make(EngineRpcs, { disableFatalDefects: true }).pipe(
      Effect.provide(engineHandlers(start, log)),
      Effect.provideServiceEffect(RpcServer.Protocol, serveOn(enginePort)),
      Effect.forkScoped,
    )

    const host = yield* RpcClient.make(HostRpcs).pipe(
      Effect.provideServiceEffect(
        RpcClient.Protocol,
        makeClientProtocol(fromMessagePortMain(hostPort), 'main'),
      ),
    )
    const launch = agentsLauncher(host, handovers, fromMessagePortMain, log)

    if (probePort !== undefined && headless(process.env)) {
      yield* RpcServer.make(ProbeRpcs, { disableFatalDefects: true }).pipe(
        Effect.provide(probeHandlers(launch)),
        Effect.provideServiceEffect(RpcServer.Protocol, serveOn(probePort)),
        Effect.forkScoped,
      )
    }

    log(`serving version ${start.version} on channel ${start.channel}`)
    return yield* Effect.never
  })

const parent: ParentPort = process.parentPort

parent.once('message', ({ data, ports }) => {
  const start = readStart(data)
  if (Option.isNone(start)) {
    process.stderr.write('the engine was started without a start message it could read\n')
    process.exit(1)
  }
  const log = openDiagnosticLog(start.value.dataFolder, 'engine')
  Effect.runFork(Effect.scoped(engine(start.value, ports, parent, log)))
})
