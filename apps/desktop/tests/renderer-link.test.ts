/**
 * The window's side of its link, as React sees it: promises and subscriptions, never Effect.
 * Main is played by a server over a Node port.
 */

import { MessageChannel } from 'node:worker_threads'

import {
  DatabaseOpen,
  DEFAULT_PREFERENCES,
  EngineGone,
  fromMessagePort,
  makeServerProtocol,
  WindowRpcs,
  UnknownProject,
  ShellSyntax,
  type CommandDraft,
  type PreferencesChange,
  type EngineStatus,
  type Run,
  type EnvironmentReport,
  type Project,
  NeedTarget,
  OpenTarget,
} from '@hemera/ipc'
import { Deferred, Effect, Stream } from 'effect'
import { RpcServer } from 'effect/rpc'
import { afterEach, describe, expect, test, vi } from 'vite-plus/test'

import { ENGINE_START_LIMIT, watchEngine, type EngineState } from '../src/renderer/engine-start.ts'
import { linkOver, type Link } from '../src/renderer/link.ts'
import { SILENT_LINK } from './fake-link.ts'

const status: EngineStatus = {
  ready: true,
  version: '1.0.0',
  channel: 'dev',
  dataFolder: '/data',
  database: DatabaseOpen.make({
    lastMigration: null,
    writtenByVersion: '1.0.0',
    backups: { count: 0, latest: null },
    reconciliation: 'none',
  }),
}
const report: EnvironmentReport = {
  version: '1.0.0',
  channel: 'dev',
  platform: 'linux',
  osVersion: 'test',
  distribution: null,
  session: null,
  displays: [],
  versions: { electron: '44', chrome: '140', node: '24' },
  dataFolder: '/data',
  notVerified: [],
  producedAt: '2026-10-03T00:00:00.000Z',
}

const acme: Project = {
  id: 'acme',
  name: 'Acme',
  mainCheckout: '/work/acme',
  workspacesRoot: null,
  branchPrefix: null,
  keyPrefix: 'ACME',
  version: 1,
  createdAt: '2026-10-04T08:00:00.000Z',
  updatedAt: '2026-10-04T08:00:00.000Z',
  repositories: [],
}

const COMMAND: CommandDraft = {
  name: 'web',
  type: 'serve',
  line: 'pnpm dev && open',
  lineWindows: null,
  lineLinux: null,
  repositoryId: null,
  folder: null,
  scope: 'project',
  portless: false,
  portlessName: null,
  check: false,
  atOpen: false,
  askBeforeRunning: false,
  readOnly: false,
  writeGlobs: [],
}

/** A system notification clicked: where it leads. */
const NOTICE = OpenTarget.make({
  target: NeedTarget.make({ projectId: 'acme', missionKey: 'ACME-12', needId: 'need-1' }),
})

const SERVICE: Run = {
  id: 'run-1',
  projectId: 'acme',
  workspaceId: null,
  commandId: 'web',
  name: 'web',
  type: 'serve',
  line: 'pnpm dev',
  folder: '/work/acme',
  startedBy: 'user',
  sessionId: null,
  missionId: null,
  state: 'ready',
  exitCode: null,
  url: 'http://localhost:5173',
  portConflict: null,
  startedAt: '2026-10-04T08:00:00.000Z',
  endedAt: null,
}

const unused = () => Effect.die('the window’s link is not asked for Projects here')

/** The Projects and their Workspaces, which no test of the window's link asks for. */
const noProjects = {
  'projects.list': unused,
  'projects.get': unused,
  'projects.create': unused,
  'projects.update': unused,
  'projects.detectRepositories': unused,
  'projects.setWorkspacesRoot': unused,
  'projects.setBranchPrefix': unused,
  'projects.changes': () => Stream.die('the window’s link is not asked for Projects here'),
  'repositories.add': unused,
  'repositories.remove': unused,
  'repositories.update': unused,
  'repositories.status': unused,
  'repositories.remotes': unused,
  'repositories.setRemote': unused,
  'repositories.setBaseBranch': unused,
  'repositories.upToDateBase': unused,
  'repositories.changes': () => Stream.die('the window’s link is not asked for Projects here'),
  'workspaces.create': unused,
  'workspaces.get': unused,
  'workspaces.list': unused,
  'workspaces.status': unused,
  'workspaces.prepare': unused,
  'workspaces.resume': unused,
  'workspaces.remove': unused,
  'workspaces.changes': () => Stream.die('the window’s link is not asked for Projects here'),
  'recipe.get': unused,
  'recipe.save': unused,
  'recipe.check': unused,
  'variables.list': unused,
  'variables.set': unused,
  'variables.remove': unused,
  'variables.reveal': unused,
  'catalogue.list': unused,
  'catalogue.save': unused,
  'catalogue.remove': unused,
  'catalogue.checkLine': unused,
  'runs.list': unused,
  'runs.start': unused,
  'runs.stop': unused,
  'runs.restart': unused,
  'runs.output': unused,
  'runs.changes': () => Stream.die('the window’s link is not asked for Projects here'),
  'missions.list': unused,
  'missions.get': unused,
  'missions.create': unused,
  'missions.launch': unused,
  'missions.fix': unused,
  'missions.ship': unused,
  'missions.cancel': unused,
  'missions.changes': () => Stream.die('the window’s link is not asked for missions here'),
  'needs.list': unused,
  'needs.get': unused,
  'needs.answer': unused,
  'needs.retry': unused,
  'permissions.neverList': unused,
  'permissions.setNeverList': unused,
  'permissions.grants': unused,
  'permissions.revoke': unused,
  'permissions.decisions': () => Stream.die('the window’s link is not asked for decisions here'),
  'hemeraAuto.setConsent': unused,
  'hemeraAuto.whoJudges': unused,
  'hemeraAuto.status': unused,
  'hemeraAuto.saveKey': unused,
  'hemeraAuto.removeKey': unused,
  'tickets.saveJiraToken': unused,
  'tickets.removeJiraToken': unused,
  'tickets.jiraTokenStatus': unused,
  'sessions.list': unused,
  'sessions.thread': unused,
  'sessions.instructionFiles': unused,
  'models.roles': unused,
  'models.setRole': unused,
  'models.marks': unused,
  'models.mark': unused,
  'limits.project': unused,
  'limits.setProject': unused,
  'limits.mission': unused,
  'chats.list': unused,
  'chats.create': unused,
  'chats.rename': unused,
  'chats.send': unused,
  'chats.stop': unused,
  'chats.setModel': unused,
  'chats.transcript': unused,
  'chats.changes': unused,
  'setup.cards': unused,
  'setup.accept': unused,
  'setup.decline': unused,
  'setup.acceptAll': unused,
  'setup.propose': unused,
  'setup.standing': unused,
  'setup.changes': unused,
  'tester.findings': unused,
  'tester.folder': unused,
  'start.search': unused,
  'start.create': unused,
  'planning.spec': unused,
  'planning.changesSince': unused,
  'planning.markRead': unused,
  'planning.addVision': unused,
  'planning.keepAfterTriage': unused,
  'planning.changed': unused,
  'planning.specLanguage': unused,
  'planning.setSpecLanguage': unused,
  'planning.tasks': unused,
  'resources.list': unused,
  'resources.save': unused,
  'resources.holders': unused,
  'resources.changed': () => Stream.die('the window’s link is not asked for the resources here'),
  'coldRead.list': unused,
  'coldRead.again': unused,
  'coldRead.dismiss': unused,
  'coldRead.freshness': unused,
  'coldRead.settled': unused,
  'coldRead.changed': () => Stream.die('the window’s link is not asked for the cold reads here'),
  'planning.waves': unused,
  'planning.answer': unused,
  'planning.waitOnSomeone': unused,
  'planning.openQuestions': unused,
  'planning.questionsChanged': unused,
  'planning.inputs': unused,
  'livingSpec.domains': unused,
  'livingSpec.requirements': unused,
  'livingSpec.requirement': unused,
  'livingSpec.runs': unused,
  'livingSpec.validateDomain': unused,
  'livingSpec.rejectDomain': unused,
  'livingSpec.dropRequirement': unused,
  'livingSpec.bootstrap': unused,
  'livingSpec.changed': () => Stream.die('the window’s link is not asked for the living spec here'),
  'probes.list': unused,
  'probes.read': unused,
  'probes.changed': () => Stream.die('the window’s link is not asked for the Probes here'),
  'discussions.list': unused,
  'discussions.read': unused,
  'discussions.open': unused,
  'discussions.say': unused,
  'discussions.accept': unused,
  'discussions.close': unused,
  'discussions.changed': unused,
  'tickets.providers': unused,
  'tickets.proposeGithub': unused,
  'tickets.addJira': unused,
  'tickets.jiraDeployment': unused,
  'tickets.addGithub': unused,
  'tickets.updateProvider': unused,
  'tickets.removeProvider': unused,
  'tickets.status': unused,
  'tickets.checkAgain': unused,
  'tickets.specMode': unused,
  'tickets.setSpecMode': unused,
  'tickets.ticket': unused,
  'tickets.changed': () => Stream.die('the window’s link is not asked for the tickets here'),
  'missions.freezeReadiness': unused,
  'missions.freezeReadinessChanged': () =>
    Stream.die('the window’s link is not asked for the Freeze here'),
  'missions.freeze': unused,
  'missions.returnToPlanning': unused,
  'dependencies.list': unused,
  'dependencies.decide': unused,
  'memory.now': unused,
  'memory.journal': unused,
  'memory.notes': unused,
  'memory.evidenceList': unused,
  'memory.evidence': unused,
  'memory.changes': () => Stream.die('the window’s link is not asked for the Memory here'),
  'agents.list': unused,
  'agents.checkUpdates': unused,
  'agents.update': unused,
  'notifications.settings': unused,
  'notifications.setKind': unused,
  'notifications.setSound': unused,
  'notifications.setStyle': unused,
}

/** A main that answers as told, and says when the window stopped listening. */
const main = async (engine: 'answers' | 'gone') => {
  const stopped = Deferred.makeUnsafe<void>()
  let logsShown = 0
  const written: PreferencesChange[] = []
  const { port1: windowPort, port2: mainPort } = new MessageChannel()
  const handlers = WindowRpcs.toLayer({
    'engine.status': () =>
      engine === 'answers' ? Effect.succeed(status) : Effect.fail(new EngineGone()),
    'engine.statusChanges': () =>
      engine === 'answers'
        ? Stream.concat(Stream.make(status), Stream.never).pipe(
            Stream.ensuring(Deferred.succeed(stopped, undefined)),
          )
        : Stream.fail(new EngineGone()),
    'preferences.read': () => Effect.succeed(DEFAULT_PREFERENCES),
    'preferences.write': (change) =>
      Effect.sync(() => {
        written.push(change)
      }),
    'profile.backups': () => Effect.succeed({ count: 0, latest: null }),
    'diagnostics.retention': () =>
      Effect.succeed({ folder: '/data', maxAgeDays: 30, maxTotalMegabytes: 500 }),
    'profile.backup': ({ folder }) => Effect.succeed(folder),
    'profile.restore': () => Effect.void,
    'environment.report': () => Effect.succeed(report),
    'application.relaunch': () => Effect.void,
    'application.showLog': () =>
      Effect.sync(() => {
        logsShown += 1
      }),
    'application.chooseFolder': () => Effect.succeed('/work/acme'),
    'notifications.window': () => Stream.concat(Stream.make(NOTICE), Stream.never),
    'notifications.preview': () => Effect.succeed('played'),
    ...noProjects,
    'catalogue.save': () => Effect.fail(new ShellSyntax({ token: '&&' })),
    'variables.reveal': ({ key }) => Effect.succeed(`value of ${key}`),
    'runs.changes': () => Stream.concat(Stream.make(SERVICE), Stream.never),
    'projects.list': () => Effect.succeed([acme]),
    'projects.get': ({ id }) =>
      id === acme.id ? Effect.succeed(acme) : Effect.fail(new UnknownProject({ id })),
    'projects.changes': () =>
      Stream.concat(Stream.make({ ...acme, name: 'Acme Corp', version: 2 }), Stream.never),
  })
  const program = Effect.gen(function* () {
    const server = yield* makeServerProtocol
    server.accept(fromMessagePort(mainPort))
    yield* RpcServer.make(WindowRpcs, { disableFatalDefects: true }).pipe(
      Effect.provide(handlers),
      Effect.provideService(RpcServer.Protocol, server.protocol),
      Effect.forkScoped,
    )
    yield* Effect.never
  })
  const fiber = Effect.runFork(Effect.scoped(program))
  const link = linkOver(fromMessagePort(windowPort))
  cleanups.push(() => {
    link.close()
    fiber.interruptUnsafe()
  })
  return {
    link,
    stopped: Effect.runPromise(Deferred.await(stopped)),
    logsShown: () => logsShown,
    written,
  }
}

const cleanups: Array<() => void> = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
  vi.useRealTimers()
})

describe('The window’s link, for components and hooks', () => {
  test('the Projects are listed, read one by one and followed', async () => {
    const { link } = await main('answers')
    await expect(link.projects()).resolves.toEqual([acme])
    await expect(link.project('acme')).resolves.toEqual(acme)
    const failure = await link.project('gone').catch((error: Error) => error)
    expect(failure).toBeInstanceOf(UnknownProject)
    const changed = await new Promise<Project>((resolve) => {
      const stop = link.onProjectChanges(
        (project) => {
          stop()
          resolve(project)
        },
        () => undefined,
      )
    })
    expect(changed.name).toBe('Acme Corp')
  })

  test('the window asks main for the system’s folder picker, and hears the folder chosen', async () => {
    const { link } = await main('answers')
    await expect(link.chooseFolder()).resolves.toBe('/work/acme')
  })

  test('a save the engine refuses rejects with its typed refusal, its sentence intact', async () => {
    const { link } = await main('answers')
    const refusal = await link.saveCommand({ projectId: 'acme', id: null, command: COMMAND }).then(
      () => new Error('the save was not refused'),
      (error: Error) => error,
    )
    expect(refusal).toBeInstanceOf(ShellSyntax)
    expect(refusal.message).toContain('“&&” is shell syntax')
  })

  test('a variable’s value is read on request, and the runs are followed as they change', async () => {
    const { link } = await main('answers')
    await expect(
      link.revealVariable({ projectId: 'acme', workspaceId: null, key: 'TOKEN' }),
    ).resolves.toBe('value of TOKEN')
    const heard = await new Promise<Run>((resolve) => {
      const stop = link.onRunChanges(
        (run) => {
          stop()
          resolve(run)
        },
        () => undefined,
      )
    })
    expect(heard).toEqual(SERVICE)
  })

  test('what main tells of notifications reaches the listener', async () => {
    const { link } = await main('answers')
    const heard = await new Promise((resolve) => {
      const stop = link.onNotices((notice) => {
        stop()
        resolve(notice)
      })
    })
    expect(heard).toEqual(NOTICE)
  })

  test('the preferences are read, and a theme chosen is written', async () => {
    const { link, written } = await main('answers')
    await expect(link.preferences()).resolves.toEqual(DEFAULT_PREFERENCES)
    await link.writePreferences({ theme: 'dark' })
    expect(written).toEqual([{ theme: 'dark' }])
  })

  test('the window asks main to show the diagnostic log', async () => {
    const { link, logsShown } = await main('answers')
    await link.showLog()
    expect(logsShown()).toBe(1)
  })

  test('a call resolves with its value', async () => {
    const { link } = await main('answers')
    await expect(link.engineStatus()).resolves.toEqual(status)
  })

  test('a call rejects with the decoded typed error, as its class', async () => {
    const { link } = await main('gone')
    const failure = await link.engineStatus().catch((error: Error) => error)
    expect(failure).toBeInstanceOf(EngineGone)
  })

  test('unsubscribing from a stream interrupts it in main', async () => {
    const { link, stopped } = await main('answers')
    const statuses: EngineStatus[] = []
    const unsubscribe = await new Promise<() => void>((resolve) => {
      const stop = link.onEngineStatus(
        (next) => {
          statuses.push(next)
          resolve(stop)
        },
        () => undefined,
      )
    })
    unsubscribe()
    await stopped
    expect(statuses).toEqual([status])
  })
})

/** A link whose engine does what the test says, when it says. */
const scripted = () => {
  let answer: ((status: EngineStatus) => void) | undefined
  let end: ((error: EngineGone) => void) | undefined
  const link: Link = {
    ...SILENT_LINK,
    engineStatus: () => new Promise((resolve) => (answer = resolve)),
    onEngineStatus: (_, onEnd) => {
      end = onEnd
      return () => undefined
    },
    environmentReport: async () => report,
    projects: async () => [],
  }
  return {
    link,
    answers: () => answer?.(status),
    dies: () => end?.(new EngineGone()),
  }
}

describe('The window waits for the engine to start', () => {
  test('the engine’s first answer makes it ready', async () => {
    const engine = scripted()
    const states: EngineState[] = []
    watchEngine(engine.link, (state) => states.push(state))
    engine.answers()
    await vi.waitFor(() => expect(states.at(-1)).toEqual({ kind: 'ready', status }))
  })

  test('no answer within the limit says so, with the diagnostic folder, and cancels nothing', async () => {
    vi.useFakeTimers()
    const engine = scripted()
    const states: EngineState[] = []
    watchEngine(engine.link, (state) => states.push(state))
    await vi.advanceTimersByTimeAsync(ENGINE_START_LIMIT)
    expect(states.at(-1)).toEqual({ kind: 'late', dataFolder: '/data' })
    engine.answers()
    await vi.waitFor(() => expect(states.at(-1)).toEqual({ kind: 'ready', status }))
  })

  test('the limit is thirty seconds', () => {
    expect(ENGINE_START_LIMIT).toBe(30_000)
  })

  test('an engine that dies says it stopped', async () => {
    const engine = scripted()
    const states: EngineState[] = []
    watchEngine(engine.link, (state) => states.push(state))
    engine.answers()
    engine.dies()
    await vi.waitFor(() => expect(states.at(-1)).toEqual({ kind: 'stopped' }))
  })
})
