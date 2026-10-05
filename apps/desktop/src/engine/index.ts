/**
 * The engine: the utility process that holds the database, and will hold the agents and every
 * business rule.
 *
 * Main posts one start message on this process's port before anything else: the start itself,
 * typed and decoded, with the ports of the engine's links. The engine serves its own group on the
 * first, calls main's on the second, and, under the headless end-to-end suite only, serves the
 * suite's probe on a third. Every later message on this process's port is the port of an agents'
 * process main started for the engine. The engine uses no Electron API but its ports.
 */

import {
  AgentsPortHandover,
  EngineMainRpcs,
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
import { startProfile } from './profile.ts'
import { BACKUP_FOLDERS, RECONCILIATION_STEPS } from './registries.ts'
import { secretsRegistry, type SecretsRegistry } from './secrets.ts'
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
  secrets: SecretsRegistry,
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

    // The Profile first: its database is opened, migrated and reconciled before anything is served.
    const profile = yield* startProfile(
      start,
      { backupFolders: BACKUP_FOLDERS, reconciliationSteps: RECONCILIATION_STEPS, secrets },
      log,
    )

    yield* RpcServer.make(EngineMainRpcs, { disableFatalDefects: true }).pipe(
      Effect.provide(engineHandlers(start, profile, log)),
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
        Effect.provide(probeHandlers(launch, profile, start.dataFolder)),
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
  // The registry of known secrets is the engine's, built before anything is written.
  const secrets = secretsRegistry()
  const log = openDiagnosticLog(start.value.dataFolder, 'engine', secrets.mask)
  Effect.runFork(Effect.scoped(engine(start.value, ports, parent, log, secrets)))
})
