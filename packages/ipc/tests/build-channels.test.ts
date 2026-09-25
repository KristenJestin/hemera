/**
 * What the window sends about a build and a Project's checks, and what the engine pushes when a
 * build changes (design D10-04, D10-06, D10-12).
 *
 * The window says what the user did — Done, Skip with its reason, a blocker dismissed, pause,
 * resume, accept, stop — and never a task's state: the declaration is where that is held, so it
 * is what is under test here.
 */

import { describe, expect, test } from 'vite-plus/test'

import { CHANNELS, ENGINE_EVENTS, ENGINE_REQUESTS, checkDraftSchema } from '#index.ts'

const DRAFT = {
  name: 'Coverage',
  commandId: null,
  line: 'pnpm test --coverage',
  where: 'root',
  repository: null,
  when: 'end',
  expect: { pattern: 'All files\\s+\\|\\s+([0-9.]+)', minimum: 70 },
  files: null,
}

describe('The window reaches the build and the checks by name', () => {
  test('every build and check use case is a channel, read through the very same schema', () => {
    const names = Object.keys(ENGINE_REQUESTS).filter(
      (name) => name.startsWith('build.') || name.startsWith('checks.'),
    )
    expect(names).toEqual([
      'build.read',
      'build.pause',
      'build.resume',
      'build.accept',
      'build.stop',
      'build.taskDone',
      'build.taskSkip',
      'build.dismissBlocker',
      'checks.list',
      'checks.save',
      'checks.remove',
      'checks.acceptProposed',
    ])
    for (const name of names) {
      expect(Object.hasOwn(CHANNELS, name)).toBe(true)
    }
    expect(CHANNELS['build.taskSkip'].arguments).toBe(ENGINE_REQUESTS['build.taskSkip'].arguments)
  })

  test('a task is never set to a state: the window sends what the user did', () => {
    const skip = ENGINE_REQUESTS['build.taskSkip'].arguments
    expect(
      skip.safeParse({ sessionId: 's', taskId: 't', reason: 'Done by hand.', unblock: true })
        .success,
    ).toBe(true)
    expect(skip.safeParse({ sessionId: 's', taskId: 't', reason: 'Done by hand.' }).success).toBe(
      false,
    )
    expect(
      ENGINE_REQUESTS['build.taskDone'].arguments.safeParse({
        sessionId: 's',
        taskId: 't',
        state: 'done',
      }).data,
    ).toEqual({ sessionId: 's', taskId: 't' })
  })

  test('a check is a command or a line, with where, when, its expected number and its files', () => {
    expect(checkDraftSchema.parse(DRAFT)).toEqual(DRAFT)
    expect(checkDraftSchema.safeParse({ ...DRAFT, when: 'nightly' }).success).toBe(false)
    expect(checkDraftSchema.safeParse({ ...DRAFT, where: 'somewhere' }).success).toBe(false)
    expect(
      ENGINE_REQUESTS['checks.save'].arguments.safeParse({
        projectId: 'atlas',
        id: null,
        draft: DRAFT,
      }).success,
    ).toBe(true)
  })
})

describe('A build change is pushed about its Session', () => {
  test('a change names the build Session and nothing else', () => {
    expect(
      ENGINE_EVENTS.build_changed.safeParse({ event: 'build.changed', sessionId: 'build-1' })
        .success,
    ).toBe(true)
    expect(
      ENGINE_EVENTS.build_changed.safeParse({ event: 'build.changed', projectId: 'atlas' }).success,
    ).toBe(false)
  })
})
