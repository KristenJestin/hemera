/**
 * The world the role sessions' suites run in: the engine as it starts (its database, its gate and
 * MCP server, its Memory), with the fake agent of #32 behind the starter — never a real agent —
 * a Project Acme with its repository `api` and a mission in Building, and the waits they share.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { AgentProvider } from '@hemera/core/domain'
import { AgentNotSignedIn } from '@hemera/ipc'
import { Duration, Effect, Layer } from 'effect'

import { ADAPTERS } from '../src/engine/agents/adapters/index.ts'
import { Discovery } from '../src/engine/agents/discovery.ts'
import { type FakeAgent, type FakeScript, fakeAgent } from '../src/engine/agents/fake.ts'
import { AgentStarter } from '../src/engine/agents/runtime.ts'
import { createMission, moveMission, type MissionParts } from '../src/engine/missions.ts'
import type {
  EngineServices,
  ProfileParts,
  SessionsParts,
  StartedProfile,
} from '../src/engine/profile.ts'
import { createProject } from '../src/engine/projects.ts'
import type { RoleEntry } from '../src/engine/sessions/roles.ts'
import { SESSION_TIMINGS, type SessionTimings } from '../src/engine/sessions/service.ts'
import { ProcessSupervisor } from '../src/engine/supervisor.ts'
import { STAYS_UP, commandsEngine, script } from './commands-engine.ts'
import { repository } from './repositories.ts'
import { TEST_ROLE } from './test-role.ts'
import type { GhSettings } from '../src/engine/tickets/gh.ts'

/** The moves are the stages' to allow: every guard passes. */
export const PASSING: MissionParts['guards'] = {
  freeze: () => Effect.succeed([]),
  launch: () => Effect.succeed([]),
  fix: () => Effect.succeed([]),
  ship: () => Effect.succeed([]),
}

/** A Builder, a helper and a reviewer, shaped as their tickets will register them. */
export const BUILDER: RoleEntry = {
  ...TEST_ROLE,
  id: 'builder',
  displayName: 'the Builder',
  mainOf: 'building',
  brief: () => Effect.succeed([{ label: 'Your task', text: 'Export the invoices as CSV.' }]),
}
export const HELPER: RoleEntry = { ...TEST_ROLE, id: 'helper', displayName: 'a helper' }
export const REVIEWER: RoleEntry = {
  ...TEST_ROLE,
  id: 'code-reviewer',
  displayName: 'the code reviewer',
  readsMemory: false,
  writes: false,
}

/**
 * Short bounds: a note waits 300 ms, swept every 100 ms. A turn may be silent as long as the
 * product lets it: under load, an ordinary first turn (its agent started, a tool called) stays
 * silent for more than a short bound, and the sweep would replace its session under the suite.
 */
export const FAST = {
  notePickup: Duration.millis(300),
  stuckAfter: SESSION_TIMINGS.stuckAfter,
  sweepEvery: Duration.millis(100),
}

/** The silence bound of the suites about silence (CT-12): a turn held past 400 ms is stuck. */
export const SILENCE = { stuckAfter: Duration.millis(400) }

/** What a world started: one fake agent per process, and the real children of some. */
export interface World {
  readonly agents: FakeAgent[]
  readonly pids: number[]
}

/** Every agent found, each started as the fake one, but those named, which are not signed in. */
export const agentsFound = (unusable: ReadonlyArray<AgentProvider> = []) =>
  Layer.succeed(Discovery, {
    list: Effect.succeed([]),
    probe: () => Effect.succeed(null),
    resolve: (id) =>
      unusable.includes(id)
        ? Effect.fail(new AgentNotSignedIn({ agent: id, label: id, loginHint: `${id} login` }))
        : Effect.succeed({
            adapter: ADAPTERS[id],
            from: 'bundled' as const,
            program: '/adapters/fake.mjs',
            args: [],
            env: {},
            own: {},
          }),
  })

/** Every agent found, each started as the fake one. */
export const everyAgentFound = agentsFound()

/**
 * The engine over `data`, its agents the fake one, scripted by the order they start in. With
 * `children`, each agent's start also starts a real child under the supervisor, ended with it.
 */
export const sessionsEngine = (
  data: string,
  scriptOf: (index: number) => FakeScript,
  options: {
    readonly children?: boolean
    readonly memory?: ProfileParts['memory']
    readonly roles?: ReadonlyArray<RoleEntry>
    readonly sessions?: Omit<SessionsParts, 'roles' | 'starter' | 'timings'>
    readonly missions?: Omit<Partial<MissionParts>, 'guards'>
    /** Runs as each agent starts, after its child and before the agent answers. */
    readonly starting?: () => Effect.Effect<void>
    /** Bounds other than `FAST`, for a suite whose turns are held longer. */
    readonly timings?: Partial<SessionTimings>
    /** The ports of the tools' gate a suite fills (a judge, the home folder). */
    readonly tools?: ProfileParts['tools']
    /** The Probes' Cleanup hook a suite watches. */
    readonly probes?: ProfileParts['probes']
    /** The fake `gh` of the ticket suites (#95). */
    readonly gh?: GhSettings
  } = {},
) => {
  const world: World = { agents: [], pids: [] }
  const starter = Layer.effect(
    AgentStarter,
    Effect.gen(function* () {
      const supervisor = yield* ProcessSupervisor
      return {
        start: (_resolved, _environment, sessionId) =>
          Effect.gen(function* () {
            if (options.children === true) {
              const child = yield* supervisor
                .start(process.execPath, [script(STAYS_UP)], {
                  owner: { kind: 'session', id: sessionId },
                  graceMillis: 200,
                })
                .pipe(Effect.orDie)
              world.pids.push(child.pid)
            }
            if (options.starting !== undefined) yield* options.starting()
            const agent = fakeAgent(scriptOf(world.agents.length))
            world.agents.push(agent)
            return agent.process
          }),
      }
    }),
  )
  const parts = {
    gh: options.gh,
    missions: { ...options.missions, guards: PASSING },
    sessions: {
      discovery: everyAgentFound,
      ...options.sessions,
      roles: options.roles ?? [BUILDER, HELPER, REVIEWER],
      starter,
      timings: { ...FAST, ...options.timings },
    },
  }
  const withMemory = options.memory === undefined ? parts : { ...parts, memory: options.memory }
  const withTools =
    options.tools === undefined ? withMemory : { ...withMemory, tools: options.tools }
  const run = commandsEngine(
    data,
    options.probes === undefined ? withTools : { ...withTools, probes: options.probes },
  )
  return { world, run }
}

/** Acme in `work`, its repository `api` with its instruction files, and a mission in Building. */
export const acmeIn = (work: string) =>
  Effect.gen(function* () {
    const main = join(work, 'acme')
    mkdirSync(main, { recursive: true })
    repository(join(main, 'api'))
    writeFileSync(join(main, 'api', 'CLAUDE.md'), 'api: run pnpm test before saying done.')
    writeFileSync(join(main, 'api', 'AGENTS.md'), 'api: agents read this.')
    const project = yield* createProject({
      name: 'Acme',
      mainCheckout: main,
      repositories: ['api'],
    })
    const mission = yield* createMission({
      projectId: project.id,
      idea: { sentence: 'Export the invoices as CSV', ticket: null },
    })
    yield* moveMission(mission.id, 'freeze', 'user')
    yield* moveMission(mission.id, 'launch', 'user')
    return { project, mission, main, owner: { kind: 'mission' as const, missionId: mission.id } }
  })

/** Waits, on the real clock, until a check holds; fails after five seconds. */
export const until = <E, R>(check: Effect.Effect<boolean, E, R>) =>
  Effect.gen(function* () {
    for (let tries = 0; tries < 250; tries += 1) {
      if (yield* check) return
      yield* Effect.sleep('20 millis')
    }
    return yield* Effect.die(new Error('the condition never held'))
  })

export const text = (blocks: ReadonlyArray<{ readonly type: string; readonly text?: string }>) =>
  blocks.map((block) => block.text ?? '').join('')

/** Runs a program on the engine's services, its failures as defects. */
export const within = <A, E>(
  profile: StartedProfile,
  program: Effect.Effect<A, E, EngineServices>,
) => profile.use(program).pipe(Effect.orDie)

/** A promise a test resolves when it chooses: what a held step of a turn waits on. */
export const held = () => {
  const { promise, resolve } = Promise.withResolvers<void>()
  return { promise, release: () => resolve() }
}
