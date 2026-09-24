/**
 * What the window holds about the Workspaces of a Project (D8-02, D8-05, D8-06, D8-08, D8-09,
 * D8-14, D8-15).
 *
 * The bridge is replaced by one that answers from a script, because what is under test is the
 * store and not the channel: which use case it asks, what it does with an answer, a push and a
 * refusal.
 */

import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import type { EngineEvent, WorkspaceStep } from '@hemera/ipc'
import {
  cleanUp,
  forgetWorkspacesRefusal,
  listenToWorkspaces,
  moveRecipeStep,
  readWorkspaces,
  removeRecipeStep,
  removeVariable,
  resumePreparation,
  selectRun,
  serviceChange,
  showStepRun,
  showWorkspace,
  stopService,
  workspacesOf,
  workspacesSnapshot,
  type ShownWorkspace,
} from '#renderer/workspaces-store.ts'

import { LOGIN_FORM, MAIN, STATUS, run, step, workspace } from './workspace-views.ts'

/** What was asked of the bridge, in the order it was asked. */
let asked: { name: string; argument: unknown }[] = []

/** Answers given one per call, in order: what a channel asked twice answers each time. */
class InTurn {
  constructor(readonly answers: unknown[]) {}
}

/** What the bridge answers, per channel: a value, a promise of one, an error, or one per call. */
let answers: Map<string, unknown>

/** An answer still on its way, and the hand that lets it arrive. */
interface Later<T> {
  readonly answer: Promise<T>
  readonly arrive: (value: T) => void
}

function later<T>(): Later<T> {
  let arrive: (value: T) => void = () => undefined
  const answer = new Promise<T>((resolve) => {
    arrive = resolve
  })
  return { answer, arrive }
}

/** What the engine would push, once the store is listening. */
let push: (event: EngineEvent) => void = () => undefined

let stop: () => void = () => undefined

/** Lets every answer the store is waiting on arrive. */
async function settled(): Promise<void> {
  for (let turn = 0; turn < 5; turn += 1) {
    // oxlint-disable-next-line no-await-in-loop -- one microtask turn after another, on purpose
    await Promise.resolve()
  }
}

beforeEach(() => {
  asked = []
  answers = new Map()
  // The one place a test reaches into the page: the preload is not there, so the bridge is.
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      hemera: {
        // oxlint-disable-next-line anti-slop/no-unknown-parameters -- stands in for the preload's bridge, whose job is to carry an argument it never reads
        invoke: async (name: string, argument: unknown) => {
          asked.push({ name, argument })
          const held = answers.get(name)
          const answer = held instanceof InTurn ? held.answers.shift() : held
          if (answer instanceof Error) throw answer
          // A promise is an answer still on its way, which the test lets arrive when it wants.
          return await Promise.resolve(answer)
        },
        on: (listener: (event: EngineEvent) => void) => {
          push = listener
          return () => undefined
        },
      },
    },
  })
  stop = listenToWorkspaces()
})

afterEach(async () => {
  stop()
  await showWorkspace(null)
  forgetWorkspacesRefusal()
})

/** Answers every read of a Workspace shown. */
function answersForShowing(): void {
  answers.set('workspaces.status', STATUS)
  answers.set('preparation.steps', [step(1)])
  answers.set('variables.list', [{ key: 'PORT', value: '3001', workspaceId: 'login-form' }])
  answers.set('commands.services', [run('run-dev')])
}

describe('The store of the Workspaces holds what the engine answered', () => {
  test('the Workspaces of a Project are the list the engine answered', async () => {
    answers.set('workspaces.list', [MAIN, LOGIN_FORM])

    await readWorkspaces('atlas')

    expect(workspacesOf('atlas').map((one) => one.name)).toEqual(['main', 'login-form'])
  })

  test('showing a Workspace reads its Git state, its steps, its variables and its services', async () => {
    answersForShowing()

    await showWorkspace(LOGIN_FORM)

    const shown = workspacesSnapshot().shown
    expect(shown?.status).toEqual(STATUS)
    expect(shown?.steps.map((one) => one.id)).toEqual(['step-1'])
    expect(shown?.variables.map((one) => one.key)).toEqual(['PORT'])
    expect(shown?.services.map((one) => one.id)).toEqual(['run-dev'])
    expect(asked.find((one) => one.name === 'variables.list')?.argument).toEqual({
      projectId: 'atlas',
      workspaceId: 'login-form',
    })
    expect(asked.find((one) => one.name === 'commands.services')?.argument).toEqual({
      projectId: 'atlas',
      workspaceId: 'login-form',
    })
  })

  test("main's services are asked for as main's, whichever row its runs were written with", async () => {
    answersForShowing()

    await showWorkspace(MAIN)

    expect(asked.find((one) => one.name === 'commands.services')?.argument).toEqual({
      projectId: 'atlas',
      workspaceId: null,
    })
  })

  test('a cleaned-up Workspace is shown without asking Git about a folder that is gone', async () => {
    answersForShowing()

    await showWorkspace(workspace('onboarding', { state: 'cleaned' }))

    expect(asked.map((one) => one.name)).not.toContain('workspaces.status')
  })

  test('an answer about a Workspace the reader has moved off is dropped', async () => {
    answersForShowing()
    let answer: (steps: WorkspaceStep[]) => void = () => undefined
    answers.set(
      'preparation.steps',
      new Promise<WorkspaceStep[]>((resolve) => {
        answer = resolve
      }),
    )
    const first = showWorkspace(LOGIN_FORM)
    await settled()

    answers.set('preparation.steps', [])
    await showWorkspace(MAIN)
    answer([step(1, { state: 'failed' })])
    await first

    expect(workspacesSnapshot().shown?.workspaceId).toBe('main')
    expect(workspacesSnapshot().shown?.steps).toEqual([])
  })

  test("a refused cleanup is the engine's sentence, and the list is left as it was", async () => {
    answers.set('workspaces.list', [MAIN, LOGIN_FORM])
    await readWorkspaces('atlas')
    answers.set('workspaces.cleanup', new Error('a service of login-form is running: dev'))

    expect(await cleanUp('atlas', 'login-form')).toBe('a service of login-form is running: dev')
    expect(workspacesOf('atlas').find((one) => one.id === 'login-form')?.state).toBe('ready')
  })

  test('a cleanup that went through reads the list again', async () => {
    answers.set('workspaces.cleanup', { ...LOGIN_FORM, state: 'cleaned' })
    answers.set('workspaces.list', [MAIN, { ...LOGIN_FORM, state: 'cleaned' }])

    expect(await cleanUp('atlas', 'login-form')).toBeNull()
    expect(workspacesOf('atlas').find((one) => one.id === 'login-form')?.state).toBe('cleaned')
  })

  test('resuming answers the steps as they stand at once', async () => {
    answersForShowing()
    await showWorkspace(LOGIN_FORM)
    answers.set('preparation.resume', [step(1), step(2, { state: 'running' })])

    await resumePreparation('login-form')

    expect(workspacesSnapshot().shown?.steps.map((one) => one.state)).toEqual(['done', 'running'])
  })

  test('a service is stopped by its run, with the Project it belongs to', async () => {
    answersForShowing()
    await showWorkspace(LOGIN_FORM)
    selectRun('run-dev')
    answers.set('commands.stopService', run('run-dev', { state: 'stopped' }))
    answers.set('commands.services', [])

    await stopService('run-dev')

    expect(asked.find((one) => one.name === 'commands.stopService')?.argument).toEqual({
      projectId: 'atlas',
      runId: 'run-dev',
    })
    // The details stay on the run that was stopped, and the list no longer holds it.
    expect(workspacesSnapshot().shown?.run?.state).toBe('stopped')
    expect(workspacesSnapshot().shown?.services).toEqual([])
  })
})

describe('The store follows what the engine pushes', () => {
  test("a workspace event reads the list again, and the shown one's steps and Git state", async () => {
    answers.set('workspaces.list', [MAIN, LOGIN_FORM])
    await readWorkspaces('atlas')
    answersForShowing()
    await showWorkspace(LOGIN_FORM)
    asked = []

    push({ event: 'workspace', projectId: 'atlas', workspaceId: 'login-form' })
    await settled()

    expect(asked.map((one) => one.name).toSorted()).toEqual([
      'preparation.steps',
      'workspaces.list',
      'workspaces.status',
    ])
  })

  test('a preparation run that ended reads the steps again', async () => {
    answersForShowing()
    await showWorkspace(LOGIN_FORM)
    asked = []

    const install = run('run-install', {
      sessionId: null,
      name: 'install',
      type: 'script',
      url: null,
      readiness: null,
      state: 'failed',
      exitCode: 1,
    })
    push({ event: 'run', sessionId: null, run: install })
    await settled()

    expect(asked.map((one) => one.name)).toEqual(['preparation.steps'])
  })

  test('a line a service prints takes its place, keeping its holder side', async () => {
    const holder = run('run-dev', {
      heldAgainst: [
        { port: 3000, runId: 'run-main', workspaceId: null, workspaceName: 'main', name: 'dev' },
      ],
    })
    answersForShowing()
    answers.set('commands.services', [holder])
    await showWorkspace(LOGIN_FORM)
    asked = []

    push({ event: 'run', sessionId: 'session-1', run: run('run-dev', { output: 'more\n' }) })
    await settled()

    expect(asked).toEqual([])
    const [kept] = workspacesSnapshot().shown?.services ?? []
    expect(kept?.output).toBe('more\n')
    expect(kept?.heldAgainst).toHaveLength(1)
  })
})

describe('What a pushed run does to the services shown', () => {
  const shown: ShownWorkspace = {
    projectId: 'atlas',
    workspaceId: 'login-form',
    main: false,
    status: null,
    steps: [],
    variables: [],
    services: [run('run-dev')],
    run: null,
  }

  test('a service of the list that printed takes its place', () => {
    expect(serviceChange(shown.services, run('run-dev', { output: 'x' }), shown)).toBe('replace')
  })

  test('a service of the list that ended reads the list again', () => {
    expect(serviceChange(shown.services, run('run-dev', { state: 'stopped' }), shown)).toBe('read')
  })

  test('a new service of this Workspace reads the list again', () => {
    expect(serviceChange(shown.services, run('run-auth'), shown)).toBe('read')
  })

  test('a service elsewhere, or a run that is no service, changes nothing', () => {
    const elsewhere = run('run-other', { workspaceId: 'billing', workspaceName: 'billing' })
    expect(serviceChange(shown.services, elsewhere, shown)).toBe('none')
    expect(serviceChange(shown.services, run('run-test', { type: 'test' }), shown)).toBe('none')
  })

  // Scenario: "A port conflict names its holder" — the holder's side, derived when read (Decided 12).
  test('a run elsewhere that names one of these as its holder reads the list again', () => {
    const second = run('run-main', {
      workspaceId: null,
      workspaceName: 'main',
      portConflict: {
        port: 3000,
        runId: 'run-dev',
        workspaceId: 'login-form',
        workspaceName: 'login-form',
        name: 'dev',
      },
    })
    expect(serviceChange(shown.services, second, shown)).toBe('read')
    const counted = [
      run('run-dev', {
        heldAgainst: [
          { port: 3000, runId: 'run-main', workspaceId: null, workspaceName: 'main', name: 'dev' },
        ],
      }),
    ]
    // Already on the holder's side: its next line changes nothing; its end takes it off.
    expect(serviceChange(counted, second, shown)).toBe('none')
    expect(serviceChange(counted, { ...second, state: 'stopped' }, shown)).toBe('read')
  })

  test('main reads as its own the runs written without a Workspace', () => {
    const onMain = { ...shown, workspaceId: 'main', main: true, services: [] }
    expect(
      serviceChange([], run('run-dev', { workspaceId: null, workspaceName: 'main' }), onMain),
    ).toBe('read')
  })
})

describe("A refusal is the engine's sentence, said until the next act", () => {
  const cases: [string, string, () => Promise<void>][] = [
    [
      'a resume while the preparation runs',
      'preparation.resume',
      async () => await resumePreparation('login-form'),
    ],
    ['a recipe step moved', 'recipe.move', async () => await moveRecipeStep('atlas', 'r1', 'up')],
    ['a recipe step removed', 'recipe.remove', async () => await removeRecipeStep('atlas', 'r1')],
    ['a service stopped', 'commands.stopService', async () => await stopService('run-dev')],
    [
      'a variable removed',
      'variables.remove',
      async () => await removeVariable('atlas', 'login-form', 'PORT'),
    ],
    ['a list read', 'workspaces.list', async () => await readWorkspaces('atlas')],
  ]

  for (const [what, channel, act] of cases) {
    test(`${what} that the engine refuses is kept in its words`, async () => {
      answersForShowing()
      await showWorkspace(LOGIN_FORM)
      answers.set(channel, new Error('this Workspace is already being prepared'))

      await act()

      expect(workspacesSnapshot().refusal).toBe('this Workspace is already being prepared')
    })
  }

  test('the next act clears what the one before was refused with', async () => {
    answersForShowing()
    await showWorkspace(LOGIN_FORM)
    answers.set('recipe.remove', new Error('no step r1 in this recipe'))
    await removeRecipeStep('atlas', 'r1')
    expect(workspacesSnapshot().refusal).toBe('no step r1 in this recipe')

    answers.set('recipe.move', [])
    await moveRecipeStep('atlas', 'r2', 'down')

    expect(workspacesSnapshot().refusal).toBeNull()
  })
})

describe('An older answer never lands over a newer one', () => {
  test('a slow Git answer to an earlier event is dropped once a later one was written', async () => {
    answersForShowing()
    await showWorkspace(LOGIN_FORM)
    const slow = later<typeof STATUS>()
    const clean = STATUS.map((one) => ({
      relativePath: one.relativePath,
      git: {
        ok: true as const,
        branch: 'atlas/HEM-7-login-form',
        commit: 'd'.repeat(40),
        staged: 0,
        unstaged: 0,
        untracked: 0,
      },
    }))
    answers.set('workspaces.status', new InTurn([slow.answer, clean]))

    push({ event: 'workspace', projectId: 'atlas', workspaceId: 'login-form' })
    push({ event: 'workspace', projectId: 'atlas', workspaceId: 'login-form' })
    await settled()
    slow.arrive(STATUS)
    await settled()

    expect(workspacesSnapshot().shown?.status).toEqual(clean)
  })

  test('a slow step reading is dropped once a later one was written', async () => {
    answersForShowing()
    await showWorkspace(LOGIN_FORM)
    const slow = later<ReturnType<typeof step>[]>()
    answers.set('preparation.steps', new InTurn([slow.answer, [step(1, { state: 'done' })]]))

    push({ event: 'workspace', projectId: 'atlas', workspaceId: 'login-form' })
    push({ event: 'workspace', projectId: 'atlas', workspaceId: 'login-form' })
    await settled()
    slow.arrive([step(1, { state: 'running' })])
    await settled()

    expect(workspacesSnapshot().shown?.steps.map((one) => one.state)).toEqual(['done'])
  })

  test('the steps a resume answered do not replace newer ones the events brought', async () => {
    answersForShowing()
    await showWorkspace(LOGIN_FORM)
    const resumed = later<ReturnType<typeof step>[]>()
    answers.set('preparation.resume', resumed.answer)
    const resuming = resumePreparation('login-form')
    await settled()

    // The resumed preparation moves on, and its event is read before the resume's answer lands.
    answers.set('preparation.steps', [step(1, { state: 'done' }), step(2, { state: 'running' })])
    push({ event: 'workspace', projectId: 'atlas', workspaceId: 'login-form' })
    await settled()
    resumed.arrive([step(1, { state: 'pending' }), step(2, { state: 'failed' })])
    await resuming

    expect(workspacesSnapshot().shown?.steps.map((one) => one.state)).toEqual(['done', 'running'])
  })

  test('the services read again keep what a push brought of a run since they were asked', async () => {
    answersForShowing()
    await showWorkspace(LOGIN_FORM)
    const read = later<ReturnType<typeof run>[]>()
    answers.set('commands.services', read.answer)

    // A new service here: the list is asked again, and its answer is slow.
    push({ event: 'run', sessionId: 'session-1', run: run('run-auth', { name: 'auth' }) })
    await settled()
    // Meanwhile `dev` prints on and publishes that it answered.
    const pushed = run('run-dev', {
      output: 'ready on http://localhost:3000\nGET / 200\n',
      readyAt: '2026-09-24T08:00:02.000Z',
      readiness: 'ready',
    })
    push({ event: 'run', sessionId: 'session-1', run: pushed })
    await settled()
    const claim = {
      port: 3000,
      runId: 'run-x',
      workspaceId: null,
      workspaceName: 'main',
      name: 'dev',
    }
    read.arrive([run('run-dev', { heldAgainst: [claim] }), run('run-auth', { name: 'auth' })])
    await settled()

    const [dev, auth] = workspacesSnapshot().shown?.services ?? []
    expect(dev).toMatchObject({ output: pushed.output, readiness: 'ready', heldAgainst: [claim] })
    expect(auth?.name).toBe('auth')
  })
})

describe('The run a step started is shown and followed', () => {
  test('it is read by its id among the Project runs, and a push of it takes its place', async () => {
    answersForShowing()
    answers.set('preparation.steps', [
      step(1, { kind: 'run', target: 'install', runId: 'run-install' }),
    ])
    await showWorkspace(LOGIN_FORM)
    const install = run('run-install', {
      sessionId: null,
      name: 'install',
      type: 'script',
      url: null,
      readiness: null,
    })
    answers.set('commands.runOf', install)

    await showStepRun('run-install')

    expect(asked.find((one) => one.name === 'commands.runOf')?.argument).toEqual({
      projectId: 'atlas',
      runId: 'run-install',
    })
    expect(workspacesSnapshot().shown?.run?.id).toBe('run-install')

    const ended = { ...install, state: 'failed' as const, exitCode: 1, output: 'exit 1\n' }
    push({ event: 'run', sessionId: null, run: ended })
    await settled()
    expect(workspacesSnapshot().shown?.run).toMatchObject({ state: 'failed', exitCode: 1 })

    await showStepRun(null)
    expect(workspacesSnapshot().shown?.run).toBeNull()
  })
})
