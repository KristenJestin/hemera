/**
 * What the window holds about the build a `build` Session shows, and what it tells the OS
 * (design D10-04, D10-08, D10-12).
 *
 * The bridge is replaced by one that answers from a script and pushes what the engine would push,
 * because what is under test is the store and its mapping: which use case it asks, what it keeps
 * of an answer, what it does with a refusal, and when a notification is raised. The use cases
 * themselves are tested in the engine.
 */

import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import type { BuildTaskView, BuildView, EngineEvent, SpecSnapshot } from '@hemera/ipc'
import {
  acceptBuild,
  buildSnapshot,
  closeBuild,
  dismissBlocker,
  doneTask,
  listenToBuilds,
  openBuild,
  pauseBuild,
  resumeBuild,
  skipTask,
  stopBuild,
} from '#renderer/build-store.ts'
import { attentionOf, buildViewDataOf } from '#renderer/build-views.ts'
import { specViewOf } from '#renderer/spec-views.ts'

/** Long after the window began to listen, so whatever waits at that time is news. */
const LATER = '2999-01-01T10:00:00.000Z'

/** Long before it, so whatever waited then is not. */
const EARLIER = '2000-01-01T10:00:00.000Z'

function task(label: string, state: BuildTaskView['state'], more: Partial<BuildTaskView> = {}) {
  return {
    id: `bt-${label}`,
    taskId: `task-${label}`,
    label,
    title: `Task ${label}`,
    result: 'It works.',
    criteria: 'A test says so.',
    type: 'code',
    executor: 'agent' as const,
    state,
    dependsOn: [],
    storyIds: ['story-1'],
    handedAt: null,
    startedAt: null,
    finishedAt: null,
    endedAt: null,
    updatedAt: EARLIER,
    skipReason: null,
    skipUnblocks: false,
    attempts: [],
    ...more,
  } satisfies BuildTaskView
}

/** The build of `ATL-7`: three dependent tasks, as they stand in a given moment. */
function build(sessionId = 'build', more: Partial<BuildView> = {}): BuildView {
  return {
    sessionId,
    specId: 'spec-7',
    specKey: 'ATL-7',
    specTitle: 'CSV invoice export',
    revision: 2,
    phase: 'execute',
    pausedAt: null,
    detail: null,
    note: 'T1 first: the query. Then the CSV, then the sign-off.',
    tasks: [
      task('T1', 'done', {
        startedAt: EARLIER,
        endedAt: EARLIER,
        attempts: [
          {
            id: 'a-1',
            scope: 'task',
            number: 1,
            startedAt: EARLIER,
            endedAt: EARLIER,
            result: 'green',
            checks: [
              {
                id: 'c-1',
                name: 'lint',
                place: 'api',
                line: 'pnpm lint',
                verdict: 'green',
                exitCode: 0,
                value: null,
                detail: null,
                outputTail: 'Found 0 errors.',
                runId: 'run-1',
                ranAt: EARLIER,
              },
            ],
            files: [
              { repository: 'api', path: 'src/query.ts', status: 'A', added: 40, removed: 0 },
            ],
          },
        ],
      }),
      task('T2', 'in_progress', { dependsOn: ['T1'], startedAt: EARLIER }),
      task('T3', 'waiting', { dependsOn: ['T2'], executor: 'human' }),
    ],
    blockers: [],
    stories: [
      { id: 'story-1', title: 'Export', labels: ['T1', 'T2', 'T3'], state: 'open', attempts: [] },
    ],
    endAttempts: [],
    canAccept: false,
    ...more,
  }
}

/** The frozen revision 2 of `ATL-7`, which the Spec has moved past `ready` on. */
function frozen(): SpecSnapshot {
  return {
    spec: {
      id: 'spec-7',
      projectId: 'atlas',
      key: 'ATL-7',
      slug: 'csv-invoice-export',
      status: 'in_progress',
      priority: null,
      workspaceId: 'ws-1',
      currentRevisionId: 'rev-2',
      writerSessionId: null,
      contentVersion: 12,
      createdAt: 0,
      updatedAt: 0,
    },
    revision: {
      id: 'rev-2',
      specId: 'spec-7',
      number: 2,
      title: 'CSV invoice export',
      type: 'feature',
      changeSummary: null,
      changeReason: null,
      createdBy: 'human',
      attestedContentVersion: 12,
      createdAt: 0,
    },
    sections: [],
    stories: [],
    criteria: [],
    tasks: [],
    dependencies: [],
    taskStories: [],
    questions: [],
    phases: [],
    briefedAt: null,
  }
}

/** What was asked of the bridge, in the order it was asked. */
let asked: { name: string; argument: object }[] = []

/** What the bridge answers, per channel and per build: a value, or an error to throw. */
let answers: Map<string, BuildView | SpecSnapshot | object[] | Error>

/** What the engine would push; set once the store listens. */
let push: (event: EngineEvent) => void = () => undefined

/** What the OS was told, in order. */
let notified: { title: string; body: string }[] = []

let stop: () => void = () => undefined

const names = (): string[] => asked.map((one) => one.name)

/** The build a session reads as, and what each action answers with: the same build. */
function reads(view: BuildView): void {
  answers.set(`build.read:${view.sessionId}`, view)
}

/** Lets a read started by a pushed event come back. */
async function settled(): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
}

beforeEach(() => {
  asked = []
  notified = []
  answers = new Map()
  answers.set('specs.read', frozen())
  answers.set('specs.revisions', [frozen().revision])
  // The one place a test reaches into the page: the preload is not there, so the bridge is.
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      hemera: {
        invoke: async (name: string, argument: { sessionId?: string }) => {
          asked.push({ name, argument })
          const answer = name.startsWith('build.')
            ? (answers.get(`${name}:${argument.sessionId ?? ''}`) ??
              answers.get(`build.read:${argument.sessionId ?? ''}`))
            : answers.get(name)
          if (answer instanceof Error) throw answer
          return await Promise.resolve(answer)
        },
        on: (listener: (event: EngineEvent) => void) => {
          push = listener
          return () => undefined
        },
      },
    },
  })
  stop = listenToBuilds((title, body) => notified.push({ title, body }))
})

afterEach(() => {
  stop()
  closeBuild()
})

describe('The build view shows the tasks by state', () => {
  test('a build is opened with the frozen revision it works from', async () => {
    reads(build())

    await openBuild('build')

    expect(names().toSorted()).toEqual(['build.read', 'specs.read', 'specs.revisions'])
    expect(asked.find((one) => one.name === 'specs.read')?.argument).toEqual({
      specId: 'spec-7',
      revision: 2,
    })
    expect(buildSnapshot().view?.tasks.map((one) => one.state)).toEqual([
      'done',
      'in_progress',
      'waiting',
    ])
  })

  test('the view is handed each task with its state, its times and its tries, and the stories keyed', () => {
    const data = buildViewDataOf(build())
    expect(data.tasks.map((one) => [one.label, one.state, one.startedAt])).toEqual([
      ['T1', 'done', EARLIER],
      ['T2', 'in_progress', EARLIER],
      ['T3', 'waiting', null],
    ])
    expect(data.tasks[0]?.attempts[0]?.checks[0]?.outputTail).toBe('Found 0 errors.')
    expect(data.tasks[0]?.attempts[0]?.files[0]?.path).toBe('src/query.ts')
    expect(data.stories.map((one) => [one.key, one.title])).toEqual([['S1', 'Export']])
    expect(data.note).toBe('T1 first: the query. Then the CSV, then the sign-off.')
  })

  test('a change of the build on screen is read again; a revision already read is not', async () => {
    reads(build())
    await openBuild('build')
    asked = []

    reads(
      build('build', {
        tasks: [task('T1', 'done'), task('T2', 'checking'), task('T3', 'waiting')],
      }),
    )
    push({ event: 'build.changed', sessionId: 'build' })
    await settled()

    expect(names()).toEqual(['build.read'])
    expect(buildSnapshot().view?.tasks[1]?.state).toBe('checking')
  })
})

describe('The Spec is read only in a build', () => {
  test('the frozen revision is drawn as frozen, with nothing to edit', async () => {
    reads(build())
    await openBuild('build')
    const { spec, revisions } = buildSnapshot()
    if (spec === null) throw new Error('the frozen revision was not read')

    const view = specViewOf({
      snapshot: spec,
      revisions,
      buffers: [],
      journal: [],
      readyRefused: null,
    })

    // The panel carries core's own status since #84: a Spec being built is `in_progress`, still frozen.
    expect(view.status).toBe('in_progress')
    expect(view.revision).toBe(2)
  })
})

describe('A human task waits for the user', () => {
  test('its becoming the user’s raises one notification; Done and Skip say what the user did', async () => {
    reads(build())
    await openBuild('build')
    expect(notified).toEqual([])

    const yours = task('T3', 'yours', { executor: 'human', endedAt: LATER, updatedAt: LATER })
    reads(build('build', { tasks: [task('T1', 'done'), task('T2', 'done'), yours] }))
    push({ event: 'build.changed', sessionId: 'build' })
    await settled()
    expect(notified).toEqual([{ title: 'T3 is yours · ATL-7', body: 'Task T3' }])

    // Read again with nothing new: nothing is told twice.
    push({ event: 'build.changed', sessionId: 'build' })
    await settled()
    expect(notified).toHaveLength(1)

    asked = []
    expect(await doneTask('bt-T3')).toBe(true)
    expect(await skipTask('bt-T3', 'Signed off on paper.', true)).toBe(true)
    expect(asked.filter((one) => one.name !== 'build.read')).toEqual([
      { name: 'build.taskDone', argument: { sessionId: 'build', taskId: 'bt-T3' } },
      {
        name: 'build.taskSkip',
        argument: {
          sessionId: 'build',
          taskId: 'bt-T3',
          reason: 'Signed off on paper.',
          unblock: true,
        },
      },
    ])
  })

  test('a build not on screen tells the OS too, and a task that was the user’s before is not news', async () => {
    const yours = task('T3', 'yours', { executor: 'human', endedAt: LATER, updatedAt: LATER })
    const old = task('T2', 'yours', { endedAt: EARLIER, updatedAt: EARLIER })
    reads(build('elsewhere', { tasks: [task('T1', 'done'), old, yours] }))

    push({ event: 'build.changed', sessionId: 'elsewhere' })
    await settled()

    expect(notified.map((one) => one.title)).toEqual(['T3 is yours · ATL-7'])
    expect(buildSnapshot().view).toBeNull()
  })

  test('a read overtaken by a later one tells the OS nothing again', async () => {
    const before = build('elsewhere', { tasks: [task('T1', 'done'), task('T2', 'waiting')] })
    const after = build('elsewhere', {
      tasks: [task('T1', 'done'), task('T2', 'yours', { endedAt: LATER, updatedAt: LATER })],
    })
    // The reads of this build come back when the test says, not in the order they were asked.
    const held: ((view: BuildView) => void)[] = []
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        hemera: {
          invoke: async () =>
            await new Promise<BuildView>((resolve) => {
              held.push(resolve)
            }),
          on: () => () => undefined,
        },
      },
    })

    push({ event: 'build.changed', sessionId: 'elsewhere' })
    push({ event: 'build.changed', sessionId: 'elsewhere' })
    held[1]?.(after)
    await settled()
    held[0]?.(before)
    await settled()
    push({ event: 'build.changed', sessionId: 'elsewhere' })
    held[2]?.(after)
    await settled()

    expect(notified.map((one) => one.title)).toEqual(['T2 is yours · ATL-7'])
  })
})

describe('A blocker suspends the task and its dependants only', () => {
  test('a blocker raised is told to the OS with its reason, and dismissing it names it', async () => {
    reads(build())
    await openBuild('build')

    const blocker = {
      id: 'blocker-1',
      taskId: 'bt-T2',
      label: 'T2',
      reason: 'The Spec asks for two formats and one column order.',
      raisedAt: LATER,
      dismissedAt: null,
    }
    reads(
      build('build', {
        tasks: [task('T1', 'done'), task('T2', 'blocked'), task('T3', 'blocked')],
        blockers: [blocker],
      }),
    )
    push({ event: 'build.changed', sessionId: 'build' })
    await settled()

    expect(notified).toEqual([
      {
        title: 'The agent says T2 contradicts the Spec · ATL-7',
        body: 'The Spec asks for two formats and one column order.',
      },
    ])
    asked = []
    await dismissBlocker('blocker-1', 'The exporter takes the CSV header from the Spec.')
    expect(asked[0]).toEqual({
      name: 'build.dismissBlocker',
      argument: {
        sessionId: 'build',
        blockerId: 'blocker-1',
        note: 'The exporter takes the CSV header from the Spec.',
      },
    })
  })

  test('nothing waits for the user in a build accepted or stopped', () => {
    const yours = task('T3', 'yours', { endedAt: LATER })
    expect(attentionOf(build('build', { tasks: [yours] }))).toHaveLength(1)
    expect(attentionOf(build('build', { tasks: [yours], phase: 'stopped' }))).toEqual([])
  })
})

describe('The user pauses, resumes, accepts and stops a build', () => {
  test('each act names the build, and what it answers is what is shown', async () => {
    reads(build())
    await openBuild('build')
    asked = []
    answers.set('build.pause:build', build('build', { pausedAt: LATER }))

    await pauseBuild()
    expect(buildSnapshot().view?.pausedAt).toBe(LATER)

    await resumeBuild()
    await acceptBuild()
    await stopBuild()
    expect(asked.map((one) => one.name)).toEqual([
      'build.pause',
      'build.resume',
      'build.accept',
      'build.stop',
    ])
    expect(asked.every((one) => JSON.stringify(one.argument) === '{"sessionId":"build"}')).toBe(
      true,
    )
  })

  test('a refused act is kept in the engine’s words, and the build is read again under it', async () => {
    reads(build())
    await openBuild('build')
    answers.set('build.accept:build', new Error('The final checks are not green yet.'))

    expect(await acceptBuild()).toBe(false)

    expect(buildSnapshot().refusal).toBe('The final checks are not green yet.')
    expect(buildSnapshot().view?.phase).toBe('execute')
  })
})
