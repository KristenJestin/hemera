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
  type SincePage,
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

/** A page of "Since you left": one mission, one thing that happened. */
const SINCE: SincePage = {
  groups: [
    {
      projectId: 'acme',
      missionId: 'm1',
      missionKey: 'ACME-1',
      title: 'Export invoices',
      ball: null,
      events: [
        { sequence: 7, tone: 'done', text: 'The review passed', at: '2026-10-09T08:00:00.000Z' },
      ],
    },
  ],
  before: 7,
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
  'projects.setKeyPrefix': unused,
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
  'home.sinceYouLeft': unused,
  'home.sinceYouLeftChanged': unused,
  'home.looked': unused,
  'home.recent': unused,
  'home.opened': unused,
  'memory.journalTail': unused,
  'start.create': unused,
  'planning.spec': unused,
  'planning.changesSince': unused,
  'planning.markRead': unused,
  'planning.addVision': unused,
  'planning.visions': unused,
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
  'planning.acceptProposedAnswer': unused,
  'planning.dismissProposedAnswer': unused,
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
  'tickets.syncInterval': unused,
  'tickets.setSyncInterval': unused,
  'tickets.lastCheck': unused,
  'tickets.events': unused,
  'tickets.difference': unused,
  'tickets.acknowledge': unused,
  'tickets.writes': unused,
  'tickets.retryWrite': unused,
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

/** Notes what the window asked of main: one line per call, the call then its payload as JSON. */
const noted = <P>(asked: string[], call: string, payload: P) =>
  Effect.sync(() => {
    asked.push(`${call} ${JSON.stringify(payload) ?? ''}`.trim())
  })

const asking = (asked: string[], call: string) => ({
  answer: <P>(payload: P) =>
    noted(asked, call, payload).pipe(Effect.andThen(Effect.die(`${call} is not answered here`))),
  follow: <P>(payload: P) =>
    Stream.drain(Stream.fromEffect(noted(asked, call, payload))).pipe(Stream.concat(Stream.never)),
})

/** The calls whose wiring is checked by what they ask, not by what they answer. */
const recording = (asked: string[]) => {
  const call = (name: string) => asking(asked, name).answer
  const stream = (name: string) => asking(asked, name).follow
  return {
    'start.search': stream('start.search'),
    'start.create': call('start.create'),
    'missions.cancel': call('missions.cancel'),
    'missions.freezeReadiness': call('missions.freezeReadiness'),
    'missions.freezeReadinessChanged': stream('missions.freezeReadinessChanged'),
    'missions.freeze': call('missions.freeze'),
    'planning.spec': call('planning.spec'),
    'planning.keepAfterTriage': call('planning.keepAfterTriage'),
    'planning.openQuestions': call('planning.openQuestions'),
    'planning.questionsChanged': stream('planning.questionsChanged'),
    'planning.specLanguage': call('planning.specLanguage'),
    'planning.setSpecLanguage': call('planning.setSpecLanguage'),
    'home.sinceYouLeftChanged': stream('home.sinceYouLeftChanged'),
    'home.looked': call('home.looked'),
    'home.opened': call('home.opened'),
    'livingSpec.domains': call('livingSpec.domains'),
    'livingSpec.requirements': call('livingSpec.requirements'),
    'livingSpec.requirement': call('livingSpec.requirement'),
    'livingSpec.runs': call('livingSpec.runs'),
    'livingSpec.validateDomain': call('livingSpec.validateDomain'),
    'livingSpec.rejectDomain': call('livingSpec.rejectDomain'),
    'livingSpec.dropRequirement': call('livingSpec.dropRequirement'),
    'livingSpec.bootstrap': call('livingSpec.bootstrap'),
    'livingSpec.changed': stream('livingSpec.changed'),
    'tickets.providers': call('tickets.providers'),
    'tickets.proposeGithub': call('tickets.proposeGithub'),
    'tickets.addGithub': call('tickets.addGithub'),
    'tickets.addJira': call('tickets.addJira'),
    'tickets.jiraDeployment': call('tickets.jiraDeployment'),
    'tickets.updateProvider': call('tickets.updateProvider'),
    'tickets.removeProvider': call('tickets.removeProvider'),
    'tickets.status': call('tickets.status'),
    'tickets.checkAgain': call('tickets.checkAgain'),
    'tickets.specMode': call('tickets.specMode'),
    'tickets.setSpecMode': call('tickets.setSpecMode'),
    'tickets.changed': stream('tickets.changed'),
    'tickets.saveJiraToken': call('tickets.saveJiraToken'),
    'tickets.removeJiraToken': call('tickets.removeJiraToken'),
    'tickets.jiraTokenStatus': call('tickets.jiraTokenStatus'),
    'tickets.syncInterval': call('tickets.syncInterval'),
    'tickets.setSyncInterval': call('tickets.setSyncInterval'),
    'tickets.lastCheck': call('tickets.lastCheck'),
    'resources.list': call('resources.list'),
    'resources.save': call('resources.save'),
    'resources.holders': call('resources.holders'),
    'resources.changed': stream('resources.changed'),
    'planning.changesSince': call('planning.changesSince'),
    'planning.markRead': call('planning.markRead'),
    'planning.addVision': call('planning.addVision'),
    'planning.visions': call('planning.visions'),
    'planning.waves': call('planning.waves'),
    'planning.answer': call('planning.answer'),
    'planning.waitOnSomeone': call('planning.waitOnSomeone'),
    'planning.inputs': call('planning.inputs'),
    'planning.acceptProposedAnswer': call('planning.acceptProposedAnswer'),
    'planning.dismissProposedAnswer': call('planning.dismissProposedAnswer'),
    'discussions.open': call('discussions.open'),
    'discussions.say': call('discussions.say'),
    'discussions.accept': call('discussions.accept'),
    'discussions.close': call('discussions.close'),
    'probes.read': call('probes.read'),
    'coldRead.again': call('coldRead.again'),
    'coldRead.dismiss': call('coldRead.dismiss'),
    'coldRead.freshness': call('coldRead.freshness'),
    'dependencies.list': call('dependencies.list'),
    'dependencies.decide': call('dependencies.decide'),
    'tickets.events': call('tickets.events'),
    'tickets.acknowledge': call('tickets.acknowledge'),
    'memory.now': call('memory.now'),
    'sessions.list': call('sessions.list'),
    'planning.changed': stream('planning.changed'),
    'discussions.changed': stream('discussions.changed'),
    'probes.changed': stream('probes.changed'),
    'coldRead.changed': stream('coldRead.changed'),
    'memory.changes': stream('memory.changes'),
  }
}

/** A main that answers as told, and says when the window stopped listening. */
const main = async (engine: 'answers' | 'gone') => {
  const asked: string[] = []
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
    ...recording(asked),
    'home.sinceYouLeft': (payload) =>
      noted(asked, 'home.sinceYouLeft', payload).pipe(Effect.as(SINCE)),
    'home.recent': () => noted(asked, 'home.recent', undefined).pipe(Effect.as([])),
    'memory.journalTail': (payload) =>
      noted(asked, 'memory.journalTail', payload).pipe(
        Effect.as(payload.missionIds.map((missionId) => ({ missionId, line: null }))),
      ),
    'projects.setKeyPrefix': (payload) =>
      noted(asked, 'projects.setKeyPrefix', payload).pipe(
        Effect.as({ ...acme, keyPrefix: payload.prefix, version: payload.version + 1 }),
      ),
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
    asked,
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

/** A method of the link, what it is called with, and the call it makes of main. */
interface Wiring {
  readonly method: string
  readonly run: (link: Link) => void
  readonly asks: string
}

const NO_END = (): void => undefined

/** Makes a call whose refusal is not what is checked. */
const ask = <A>(call: Promise<A>): void => {
  void call.catch(() => undefined)
}

const GITHUB = { host: 'github.com', repositories: ['acme/web'] }
const JIRA = {
  site: 'https://acme.atlassian.net',
  deployment: 'cloud',
  email: 'kris@acme.test',
  projectKeys: ['ACME'],
} as const
const DRAFT = {
  name: 'Staging database',
  description: 'One at a time',
  uses: ['migrate'],
  changes: ['migrate'],
  resetCommandId: null,
}

const WIRINGS: ReadonlyArray<Wiring> = [
  {
    method: 'searchStart',
    run: (link) => {
      link.searchStart('acme', 'invoices', NO_END, NO_END)
    },
    asks: 'start.search {"projectId":"acme","text":"invoices"}',
  },
  {
    method: 'createStart',
    run: (link) =>
      ask(link.createStart({ projectId: 'acme', text: 'Export', idempotencyKey: 'k1' })),
    asks: 'start.create {"projectId":"acme","text":"Export","idempotencyKey":"k1"}',
  },
  {
    method: 'cancelMission',
    run: (link) => ask(link.cancelMission('m1')),
    asks: 'missions.cancel {"id":"m1"}',
  },
  {
    method: 'freezeReadiness',
    run: (link) => ask(link.freezeReadiness('m1')),
    asks: 'missions.freezeReadiness {"id":"m1"}',
  },
  {
    method: 'onFreezeReadiness',
    run: (link) => {
      link.onFreezeReadiness('m1', NO_END, NO_END)
    },
    asks: 'missions.freezeReadinessChanged {"id":"m1"}',
  },
  {
    method: 'keepAfterTriage',
    run: (link) => ask(link.keepAfterTriage('m1')),
    asks: 'planning.keepAfterTriage {"missionId":"m1"}',
  },
  {
    method: 'freeze',
    run: (link) => ask(link.freeze('m1', 3)),
    asks: 'missions.freeze {"id":"m1","specVersion":3}',
  },
  { method: 'spec', run: (link) => ask(link.spec('m1')), asks: 'planning.spec {"missionId":"m1"}' },
  {
    method: 'openQuestions',
    run: (link) => ask(link.openQuestions()),
    asks: 'planning.openQuestions {}',
  },
  {
    method: 'onOpenQuestions',
    run: (link) => {
      link.onOpenQuestions(NO_END, NO_END)
    },
    asks: 'planning.questionsChanged {}',
  },
  {
    method: 'sinceYouLeft',
    run: (link) => ask(link.sinceYouLeft(null)),
    asks: 'home.sinceYouLeft {"before":null}',
  },
  {
    method: 'onSinceYouLeft',
    run: (link) => {
      link.onSinceYouLeft(NO_END, NO_END)
    },
    asks: 'home.sinceYouLeftChanged',
  },
  {
    method: 'lookedAtHome',
    run: (link) => ask(link.lookedAtHome(7)),
    asks: 'home.looked {"upTo":7}',
  },
  { method: 'recentMissions', run: (link) => ask(link.recentMissions()), asks: 'home.recent' },
  {
    method: 'missionOpened',
    run: (link) => ask(link.missionOpened('m1')),
    asks: 'home.opened {"missionId":"m1"}',
  },
  {
    method: 'journalTail',
    run: (link) => ask(link.journalTail(['m1', 'm2'])),
    asks: 'memory.journalTail {"missionIds":["m1","m2"]}',
  },
  {
    method: 'livingSpecDomains',
    run: (link) => ask(link.livingSpecDomains('acme')),
    asks: 'livingSpec.domains {"projectId":"acme"}',
  },
  {
    method: 'onLivingSpec',
    run: (link) => {
      link.onLivingSpec('acme', NO_END, NO_END)
    },
    asks: 'livingSpec.changed {"projectId":"acme"}',
  },
  {
    method: 'livingSpecRequirements',
    run: (link) => ask(link.livingSpecRequirements('acme', 'd1')),
    asks: 'livingSpec.requirements {"projectId":"acme","domainId":"d1"}',
  },
  {
    method: 'livingSpecRequirement',
    run: (link) => ask(link.livingSpecRequirement('r1')),
    asks: 'livingSpec.requirement {"id":"r1"}',
  },
  {
    method: 'livingSpecRuns',
    run: (link) => ask(link.livingSpecRuns('acme')),
    asks: 'livingSpec.runs {"projectId":"acme"}',
  },
  {
    method: 'validateDomain',
    run: (link) => ask(link.validateDomain('d1', [])),
    asks: 'livingSpec.validateDomain {"domainId":"d1","seen":[]}',
  },
  {
    method: 'rejectDomain',
    run: (link) => ask(link.rejectDomain('d1', [])),
    asks: 'livingSpec.rejectDomain {"domainId":"d1","seen":[]}',
  },
  {
    method: 'dropRequirement',
    run: (link) => ask(link.dropRequirement('r1')),
    asks: 'livingSpec.dropRequirement {"requirementId":"r1"}',
  },
  {
    method: 'bootstrapLivingSpec (every domain)',
    run: (link) => ask(link.bootstrapLivingSpec('acme')),
    asks: 'livingSpec.bootstrap {"projectId":"acme"}',
  },
  {
    method: 'bootstrapLivingSpec (one domain)',
    run: (link) => ask(link.bootstrapLivingSpec('acme', 'd1')),
    asks: 'livingSpec.bootstrap {"projectId":"acme","domainId":"d1"}',
  },
  {
    method: 'ticketProviders',
    run: (link) => ask(link.ticketProviders('acme')),
    asks: 'tickets.providers {"projectId":"acme"}',
  },
  {
    method: 'proposeGithub',
    run: (link) => ask(link.proposeGithub('acme', 'github.com')),
    asks: 'tickets.proposeGithub {"projectId":"acme","host":"github.com"}',
  },
  {
    method: 'addGithub',
    run: (link) => ask(link.addGithub('acme', GITHUB)),
    asks: `tickets.addGithub ${JSON.stringify({ projectId: 'acme', config: GITHUB })}`,
  },
  {
    method: 'addJira',
    run: (link) => ask(link.addJira('acme', JIRA)),
    asks: `tickets.addJira ${JSON.stringify({ projectId: 'acme', config: JIRA })}`,
  },
  {
    method: 'jiraDeployment',
    run: (link) => ask(link.jiraDeployment('https://acme.atlassian.net')),
    asks: 'tickets.jiraDeployment {"site":"https://acme.atlassian.net"}',
  },
  {
    method: 'updateProvider',
    run: (link) => ask(link.updateProvider('p1', GITHUB)),
    asks: `tickets.updateProvider ${JSON.stringify({ providerId: 'p1', config: GITHUB })}`,
  },
  {
    method: 'removeProvider',
    run: (link) => ask(link.removeProvider('p1')),
    asks: 'tickets.removeProvider {"providerId":"p1"}',
  },
  {
    method: 'providerStatus',
    run: (link) => ask(link.providerStatus('p1')),
    asks: 'tickets.status {"providerId":"p1"}',
  },
  {
    method: 'checkProviderAgain',
    run: (link) => ask(link.checkProviderAgain('p1')),
    asks: 'tickets.checkAgain {"providerId":"p1"}',
  },
  {
    method: 'specMode',
    run: (link) => ask(link.specMode('acme')),
    asks: 'tickets.specMode {"projectId":"acme"}',
  },
  {
    method: 'setSpecMode',
    run: (link) => ask(link.setSpecMode('acme', 'linked')),
    asks: 'tickets.setSpecMode {"projectId":"acme","mode":"linked"}',
  },
  {
    method: 'onTicketSettings',
    run: (link) => {
      link.onTicketSettings('acme', NO_END, NO_END)
    },
    asks: 'tickets.changed {"projectId":"acme"}',
  },
  {
    method: 'saveJiraToken',
    run: (link) => ask(link.saveJiraToken('p1', 'secret')),
    asks: 'tickets.saveJiraToken {"providerId":"p1","token":"secret"}',
  },
  {
    method: 'removeJiraToken',
    run: (link) => ask(link.removeJiraToken('p1')),
    asks: 'tickets.removeJiraToken {"providerId":"p1"}',
  },
  {
    method: 'jiraTokenStatus',
    run: (link) => ask(link.jiraTokenStatus('p1')),
    asks: 'tickets.jiraTokenStatus {"providerId":"p1"}',
  },
  {
    method: 'syncInterval',
    run: (link) => ask(link.syncInterval('acme')),
    asks: 'tickets.syncInterval {"projectId":"acme"}',
  },
  {
    method: 'setSyncInterval',
    run: (link) => ask(link.setSyncInterval('acme', 30)),
    asks: 'tickets.setSyncInterval {"projectId":"acme","minutes":30}',
  },
  {
    method: 'lastCheck',
    run: (link) => ask(link.lastCheck('acme')),
    asks: 'tickets.lastCheck {"projectId":"acme"}',
  },
  {
    method: 'specLanguage',
    run: (link) => ask(link.specLanguage('acme')),
    asks: 'planning.specLanguage {"projectId":"acme"}',
  },
  {
    method: 'setSpecLanguage',
    run: (link) => ask(link.setSpecLanguage('acme', 'French')),
    asks: 'planning.setSpecLanguage {"projectId":"acme","language":"French"}',
  },
  {
    method: 'setKeyPrefix',
    run: (link) => ask(link.setKeyPrefix({ id: 'acme', version: 2, prefix: 'AC' })),
    asks: 'projects.setKeyPrefix {"id":"acme","version":2,"prefix":"AC"}',
  },
  {
    method: 'resources',
    run: (link) => ask(link.resources('acme')),
    asks: 'resources.list {"projectId":"acme"}',
  },
  {
    method: 'saveResources',
    run: (link) => ask(link.saveResources('acme', [DRAFT])),
    asks: `resources.save ${JSON.stringify({ projectId: 'acme', resources: [DRAFT] })}`,
  },
  {
    method: 'resourceHolders',
    run: (link) => ask(link.resourceHolders()),
    asks: 'resources.holders',
  },
  {
    method: 'onResourceHolders',
    run: (link) => {
      link.onResourceHolders(NO_END, NO_END)
    },
    asks: 'resources.changed',
  },
  {
    method: 'onSpec',
    run: (link) => {
      link.onSpec('m1', NO_END, NO_END)
    },
    asks: 'planning.changed {"missionId":"m1"}',
  },
  {
    method: 'changesSince',
    run: (link) => ask(link.changesSince('m1', 4)),
    asks: 'planning.changesSince {"missionId":"m1","version":4}',
  },
  {
    method: 'markRead',
    run: (link) => ask(link.markRead('m1', 5)),
    asks: 'planning.markRead {"missionId":"m1","version":5}',
  },
  {
    method: 'addVision',
    run: (link) => ask(link.addVision('m1', 'Keep it small')),
    asks: 'planning.addVision {"missionId":"m1","text":"Keep it small"}',
  },
  {
    method: 'visions',
    run: (link) => ask(link.visions('m1')),
    asks: 'planning.visions {"missionId":"m1"}',
  },
  {
    method: 'waves',
    run: (link) => ask(link.waves('m1')),
    asks: 'planning.waves {"missionId":"m1"}',
  },
  {
    method: 'answer',
    run: (link) => ask(link.answer('m1', 'Q1', { optionId: 'A' })),
    asks: 'planning.answer {"missionId":"m1","questionId":"Q1","optionId":"A"}',
  },
  {
    method: 'waitOnSomeone',
    run: (link) => ask(link.waitOnSomeone('m1', 'Q2', 'The design team')),
    asks: 'planning.waitOnSomeone {"missionId":"m1","questionId":"Q2","note":"The design team"}',
  },
  {
    method: 'planningInputs',
    run: (link) => ask(link.planningInputs('m1')),
    asks: 'planning.inputs {"missionId":"m1"}',
  },
  {
    method: 'acceptProposedAnswer',
    run: (link) => ask(link.acceptProposedAnswer('pa1', null)),
    asks: 'planning.acceptProposedAnswer {"proposalId":"pa1"}',
  },
  {
    method: 'dismissProposedAnswer',
    run: (link) => ask(link.dismissProposedAnswer('pa1')),
    asks: 'planning.dismissProposedAnswer {"proposalId":"pa1"}',
  },
  {
    method: 'onDiscussions',
    run: (link) => {
      link.onDiscussions('m1', NO_END, NO_END)
    },
    asks: 'discussions.changed {"missionId":"m1"}',
  },
  {
    method: 'openDiscussion',
    run: (link) => ask(link.openDiscussion('m1', { kind: 'question', id: 'Q1' }, 'Why?')),
    asks: 'discussions.open {"missionId":"m1","item":{"kind":"question","id":"Q1"},"text":"Why?"}',
  },
  {
    method: 'sayInDiscussion',
    run: (link) => ask(link.sayInDiscussion('d1', 'And then?')),
    asks: 'discussions.say {"discussionId":"d1","text":"And then?"}',
  },
  {
    method: 'acceptDiscussion',
    run: (link) => ask(link.acceptDiscussion('d1', '2026-10-05T09:00:00.000Z')),
    asks: 'discussions.accept {"discussionId":"d1","proposedAt":"2026-10-05T09:00:00.000Z"}',
  },
  {
    method: 'closeDiscussion',
    run: (link) => ask(link.closeDiscussion('d1', null)),
    asks: 'discussions.close {"discussionId":"d1","closing":{"noDecision":true}}',
  },
  {
    method: 'onProbes',
    run: (link) => {
      link.onProbes('m1', NO_END, NO_END)
    },
    asks: 'probes.changed {"missionId":"m1"}',
  },
  {
    method: 'probe',
    run: (link) => ask(link.probe('p1')),
    asks: 'probes.read {"probeId":"p1"}',
  },
  {
    method: 'onColdReads',
    run: (link) => {
      link.onColdReads('m1', NO_END, NO_END)
    },
    asks: 'coldRead.changed {"missionId":"m1"}',
  },
  {
    method: 'coldReadAgain',
    run: (link) => ask(link.coldReadAgain('m1')),
    asks: 'coldRead.again {"missionId":"m1"}',
  },
  {
    method: 'dismissFinding',
    run: (link) => ask(link.dismissFinding('m1', 'C1.F2')),
    asks: 'coldRead.dismiss {"missionId":"m1","findingId":"C1.F2"}',
  },
  {
    method: 'coldReadFreshness',
    run: (link) => ask(link.coldReadFreshness('m1')),
    asks: 'coldRead.freshness {"missionId":"m1"}',
  },
  {
    method: 'dependencies',
    run: (link) => ask(link.dependencies('m1')),
    asks: 'dependencies.list {"missionId":"m1"}',
  },
  {
    method: 'decideDependency',
    run: (link) => ask(link.decideDependency('dep1', true)),
    asks: 'dependencies.decide {"id":"dep1","accept":true}',
  },
  {
    method: 'ticketEvents',
    run: (link) => ask(link.ticketEvents('m1')),
    asks: 'tickets.events {"missionId":"m1"}',
  },
  {
    method: 'acknowledgeTicketEvent',
    run: (link) => ask(link.acknowledgeTicketEvent('te1')),
    asks: 'tickets.acknowledge {"eventId":"te1"}',
  },
  {
    method: 'memoryNow',
    run: (link) => ask(link.memoryNow('m1')),
    asks: 'memory.now {"missionId":"m1"}',
  },
  {
    method: 'onMemory',
    run: (link) => {
      link.onMemory('m1', NO_END, NO_END)
    },
    asks: 'memory.changes {"missionId":"m1"}',
  },
  {
    method: 'missionSessions',
    run: (link) => ask(link.missionSessions('m1')),
    asks: 'sessions.list {"ownerKind":"mission","ownerId":"m1"}',
  },
]

describe('The window’s link, for the screens that come back to a mission and its spec', () => {
  test.each(WIRINGS)('$method asks main for $asks', async ({ run, asks }) => {
    const { link, asked } = await main('answers')
    run(link)
    await vi.waitFor(() => expect(asked).toContain(asks))
  })

  test('Home reads a page of what happened since the user left, and the cursor of the next', async () => {
    const { link } = await main('answers')
    await expect(link.sinceYouLeft(null)).resolves.toEqual(SINCE)
  })

  test('the last Journal line of each mission asked comes back by mission', async () => {
    const { link } = await main('answers')
    await expect(link.journalTail(['m1'])).resolves.toEqual([{ missionId: 'm1', line: null }])
  })

  test('a Project’s new key prefix comes back on the Project, at its next version', async () => {
    const { link } = await main('answers')
    const saved = await link.setKeyPrefix({ id: 'acme', version: 1, prefix: 'AC' })
    expect(saved).toMatchObject({ keyPrefix: 'AC', version: 2 })
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
