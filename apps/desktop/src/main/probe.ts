/**
 * The end-to-end suite's handle on the engine, put on `globalThis.hemeraProbe` when the suite
 * runs headless and never otherwise. The suite reaches it from main with
 * `browser.electron.execute`; each method answers a promise of plain values.
 */

import { ApplicationOwner, EnvironmentFields } from '@hemera/core/domain'
import { closedAs, EngineGone, fromMessagePortMain, makeClientProtocol } from '@hemera/ipc'
import { Cause, Effect, Exit, Option, Predicate, Stream } from 'effect'
import type { Scope } from 'effect'
import { RpcClient } from 'effect/rpc'
import { app } from 'electron/main'
import type { MessagePortMain, UtilityProcess } from 'electron/main'

import { ProbeRpcs } from '../engine/probe.ts'
import type { HemeraProbe, LoadMeasure } from './probe-types.ts'
import {
  changePreferences,
  restoreProfile,
  type Application,
  type EngineClient,
} from './window-link.ts'
import type { WindowPorts } from './window-ports.ts'

const gone = () => new EngineGone()

/** The need the suite creates unless it says which: something missing, Hemera's own. */
const DOCKER = EnvironmentFields.make({
  missing: 'Docker is not running',
  action: 'Start Docker',
  settingsSection: null,
})

export const installProbe = (
  port: MessagePortMain,
  engine: UtilityProcess,
  windows: WindowPorts,
  engineClient: EngineClient,
  application: Application,
): Effect.Effect<void, never, Scope.Scope> =>
  Effect.gen(function* () {
    const client = yield* RpcClient.make(ProbeRpcs).pipe(
      Effect.provideServiceEffect(
        RpcClient.Protocol,
        makeClientProtocol(fromMessagePortMain(port), 'the engine'),
      ),
    )
    const lines: string[] = []
    let outcome: Promise<string> = Promise.resolve('no agents’ process was started')

    const probe: HemeraProbe = {
      enginePid: () => engine.pid,
      changeTheme: (theme) =>
        Effect.runPromise(changePreferences(engineClient, application)({ theme })),
      createProject: (name, folder) =>
        Effect.runPromise(
          closedAs(gone)(
            engineClient['projects.create']({ name, mainCheckout: folder, repositories: [] }),
          ).pipe(Effect.map((project) => project.id)),
        ),
      backUp: (folder) =>
        Effect.runPromise(closedAs(gone)(engineClient['profile.backup']({ folder }))),
      restore: (folder) => Effect.runPromise(restoreProfile(engineClient, application)(folder)),
      closeWindowLinks: () => windows.closeAll(),
      crashEngine: () => {
        Effect.runFork(client['probe.crash']())
      },
      startAgents: (program, input) =>
        new Promise((resolve, reject) => {
          const run = Stream.runForEach(client['probe.agents']({ program, input }), (event) =>
            Effect.sync(() =>
              Predicate.isTagged(event, 'Pid') ? resolve(event.pid) : lines.push(event.line),
            ),
          )
          outcome = Effect.runPromiseExit(run).then((exit) => {
            if (Exit.isSuccess(exit)) return 'ended'
            const failure = Cause.findErrorOption(exit.cause)
            const said = Option.isSome(failure) ? failure.value.message : Cause.pretty(exit.cause)
            reject(new Error(said))
            return said
          })
        }),
      agentsLines: () => [...lines],
      agentsOutcome: async () => ({ ended: await outcome, lines }),
      load: (count, size) => {
        const metrics = () =>
          app.getAppMetrics().find((metric) => metric.pid === engine.pid)?.memory.workingSetSize ??
          0
        const before = { main: process.memoryUsage().rss, engine: metrics() }
        const started = performance.now()
        let received = 0
        return Effect.runPromise(
          Stream.runForEach(client['probe.load']({ count, size }), () =>
            Effect.sync(() => {
              received += 1
            }),
          ),
        ).then((): LoadMeasure => ({
          items: received,
          millis: performance.now() - started,
          mainRssBefore: before.main,
          mainRssAfter: process.memoryUsage().rss,
          engineWorkingSetBeforeKb: before.engine,
          engineWorkingSetAfterKb: metrics(),
        }))
      },
      createNeed: (owner = ApplicationOwner.make({}), fields = DOCKER) =>
        Effect.runPromise(client['probe.need']({ owner, fields })),
      createMission: (projectId, sentence) =>
        Effect.runPromise(
          closedAs(gone)(
            engineClient['missions.create']({ projectId, idea: { sentence, ticket: null } }),
          ).pipe(Effect.map((mission) => ({ id: mission.id, key: mission.key }))),
        ),
      agentWrites: (folder, count) =>
        Effect.runPromise(client['probe.agentWrites']({ folder, count })),
      memory: () => Effect.runPromise(client['probe.memory']()),
      scriptAgent: (script) =>
        Effect.runPromise(client['probe.script']({ script: JSON.stringify(script) })),
      setupStanding: (name) =>
        Effect.runPromise(
          Effect.gen(function* () {
            const projects = yield* closedAs(gone)(engineClient['projects.list']())
            const project = projects.find((one) => one.name === name)
            if (project === undefined) return yield* Effect.die(`no Project is named ${name}`)
            const standing = yield* closedAs(gone)(
              engineClient['setup.standing']({ projectId: project.id }),
            )
            return standing.state
          }),
        ),
      pendingNeeds: () =>
        Effect.runPromise(
          closedAs(gone)(engineClient['needs.list']()).pipe(
            Effect.map((groups) =>
              groups.flatMap((group) =>
                group.needs.map((need) => ({
                  id: need.id,
                  state: need.state,
                  answered: need.answer !== null,
                })),
              ),
            ),
          ),
        ),
    }
    globalThis.hemeraProbe = probe
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        globalThis.hemeraProbe = undefined
      }),
    )
  })
