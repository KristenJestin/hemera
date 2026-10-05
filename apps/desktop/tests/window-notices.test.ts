/**
 * The window's side of notifications: the in-app notifications main tells it, drawn until they
 * are pressed, dismissed or their need ends, and where a notification leads.
 */

import {
  HomeTarget,
  InAppNotice,
  MissionTarget,
  NeedTarget,
  NoticeGone,
  type NotificationTarget,
  ProjectTarget,
} from '@hemera/ipc'
import { describe, expect, test } from 'vite-plus/test'

import { routeOf } from '../src/renderer/navigation.ts'
import { noticesAfter, withoutNotice } from '../src/renderer/notices.ts'

const notice = (id: string) =>
  InAppNotice.make({
    id,
    tone: 'you',
    project: 'Acme',
    missionKey: 'ACME-12',
    title: 'Add roles',
    detail: 'A decision waits for you',
    target: NeedTarget.make({ projectId: 'acme', missionKey: 'ACME-12', needId: 'need-1' }),
  })

describe('The in-app notifications', () => {
  test('one told is drawn after those already there, in the design’s words', () => {
    const shown = noticesAfter(noticesAfter([], notice('a')), notice('b'))
    expect(shown.map((one) => one.id)).toEqual(['a', 'b'])
    expect(shown[0]).toMatchObject({
      tone: 'you',
      project: 'Acme',
      missionKey: 'ACME-12',
      title: 'Add roles',
      detail: 'A decision waits for you',
    })
  })

  test('one whose need ended goes away; one unknown changes nothing', () => {
    const shown = noticesAfter(noticesAfter([], notice('a')), notice('b'))
    expect(noticesAfter(shown, NoticeGone.make({ id: 'a' })).map((one) => one.id)).toEqual(['b'])
    expect(noticesAfter(shown, NoticeGone.make({ id: 'x' }))).toBe(shown)
  })

  test('one told twice is drawn once', () => {
    expect(noticesAfter(noticesAfter([], notice('a')), notice('a'))).toHaveLength(1)
  })

  test('pressed or dismissed, it goes away', () => {
    expect(withoutNotice(noticesAfter([], notice('a')), 'a')).toEqual([])
  })
})

describe('Where a notification leads', () => {
  test.each<[string, NotificationTarget, ReturnType<typeof routeOf>]>([
    [
      'a need: Home, that Project’s needs, with that need unfolded',
      NeedTarget.make({ projectId: 'acme', missionKey: 'ACME-12', needId: 'n' }),
      { kind: 'home', projectId: 'acme', need: 'n' },
    ],
    [
      'a mission: the mission',
      MissionTarget.make({ projectId: 'acme', missionKey: 'ACME-12' }),
      { kind: 'mission', projectId: 'acme', key: 'ACME-12' },
    ],
    [
      'a Project: its page',
      ProjectTarget.make({ projectId: 'acme' }),
      { kind: 'project', id: 'acme' },
    ],
    [
      'a Project’s group: Home, that Project’s needs',
      HomeTarget.make({ projectId: 'acme' }),
      { kind: 'home', projectId: 'acme' },
    ],
    ['a group across Projects: Home', HomeTarget.make({ projectId: null }), { kind: 'home' }],
  ])('%s', (_, target, route) => {
    expect(routeOf(target)).toEqual(route)
  })
})
