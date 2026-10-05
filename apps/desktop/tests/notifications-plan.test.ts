/**
 * Where the notices that arrive together show, in which words, with which sound, and where a
 * click leads: pure rules, from the notices, the focus, the settings and Do Not Disturb.
 */

import {
  HomeTarget,
  NeedTarget,
  type Notice,
  type NotificationSettings,
  SOUNDS,
  type Sound,
} from '@hemera/ipc'
import { describe, expect, test } from 'vite-plus/test'

import {
  type Delivery,
  type Situation,
  deliveryOf,
  withoutNeed,
} from '../src/main/notifications.ts'

const ACME = { id: 'p-acme', name: 'Acme' }
const GLOBEX = { id: 'p-globex', name: 'Globex' }

let made = 0

const need = (overrides: Partial<Notice> = {}): Notice => {
  made += 1
  const needId = `need-${String(made)}`
  return {
    id: `need:${String(made)}`,
    kind: 'need',
    sound: 'needs-you',
    importance: 2,
    tone: 'you',
    project: ACME,
    missionKey: 'ACME-12',
    subject: 'Add roles',
    what: 'a decision waits for you',
    target: NeedTarget.make({ projectId: ACME.id, missionKey: 'ACME-12', needId }),
    needId,
    ...overrides,
  }
}

const failure = (overrides: Partial<Notice> = {}) =>
  need({ kind: 'failure', sound: 'error', importance: 3, tone: 'failed', ...overrides })

const finished = (overrides: Partial<Notice> = {}) =>
  need({ kind: 'mission-done', sound: 'done', importance: 1, tone: 'done', ...overrides })

/** Every kind and every sound on, but those named. */
const settingsWith = (
  off: { readonly kinds?: ReadonlyArray<string>; readonly sounds?: ReadonlyArray<Sound> } = {},
): NotificationSettings => ({
  kinds: ['need', 'failure', 'mission-done'].map((id) => ({
    id,
    label: id,
    on: !(off.kinds ?? []).includes(id),
    byDefault: true,
    sound: null,
  })),
  sounds: SOUNDS.map((sound) => ({ sound, label: sound, on: !(off.sounds ?? []).includes(sound) })),
})

const SETTINGS = settingsWith()

const away: Situation = { focused: false, settings: SETTINGS, doNotDisturb: 'off' }
const here: Situation = { ...away, focused: true }

const kindOff = (id: string) => settingsWith({ kinds: [id] })

const soundOff = (sound: Sound) => settingsWith({ sounds: [sound] })

const shown = (notices: ReadonlyArray<Notice>, situation: Situation): Delivery => {
  const delivery = deliveryOf(notices, situation)
  if (delivery === null) throw new Error('nothing was delivered')
  return delivery
}

describe('Grouping: what arrives together is one notification', () => {
  test('one event keeps its own words', () => {
    const delivery = shown([need()], away)
    expect(delivery.body).toBe('ACME-12 · Add roles: a decision waits for you')
    expect(delivery.title).toBe('Acme')
  })

  test('three needs in one Project are one notification, with one sound', () => {
    const delivery = shown([need(), need(), need()], away)
    expect(delivery.body).toBe('3 things wait for you in Acme')
    expect(delivery.sound).toBe('needs-you')
    expect(delivery.needIds).toHaveLength(3)
  })

  test('needs in two Projects are one notification: N things wait for you', () => {
    const delivery = shown([need(), need({ project: GLOBEX }), need()], away)
    expect(delivery.body).toBe('3 things wait for you')
    expect(delivery.title).toBe('Hemera')
  })

  test('an application need beside a Project’s counts apart from the Project', () => {
    const delivery = shown([need(), need({ project: null, missionKey: null })], away)
    expect(delivery.body).toBe('2 things wait for you')
  })

  test.each([
    ['error over needs you and done', [finished(), need(), failure()], 'error'],
    ['needs you over done', [finished(), need()], 'needs-you'],
    ['done alone', [finished(), finished()], 'done'],
  ] as const)('a mixed group plays one sound: %s', (_, notices, sound) => {
    expect(shown(notices, away).sound).toBe(sound)
  })

  test('a group leans on its most important tone', () => {
    expect(shown([need(), failure()], here).tone).toBe('failed')
  })
})

describe('Routing: a click goes where the notification is about', () => {
  test('one need leads to its mission and the need', () => {
    const one = need()
    expect(shown([one], away).target).toEqual(one.target)
  })

  test('a group in one Project leads to Home filtered to it', () => {
    expect(shown([need(), need()], away).target).toEqual(HomeTarget.make({ projectId: ACME.id }))
  })

  test('a group across Projects leads to Home', () => {
    expect(shown([need(), need({ project: GLOBEX })], away).target).toEqual(
      HomeTarget.make({ projectId: null }),
    )
  })

  test('an application need leads to Home', () => {
    const app = need({
      project: null,
      missionKey: null,
      subject: 'Hemera needs you',
      what: 'Git is missing',
      target: HomeTarget.make({ projectId: null }),
    })
    const delivery = shown([app], away)
    expect(delivery.target).toEqual(HomeTarget.make({ projectId: null }))
    expect(delivery.body).toBe('Hemera needs you: Git is missing')
  })
})

describe('Focus: in the window when it has it, the system’s otherwise', () => {
  test('focused gives the in-app notification only, in the design’s words', () => {
    const delivery = shown([need()], here)
    expect(delivery.where).toBe('in-app')
    expect(delivery).toMatchObject({
      project: 'Acme',
      missionKey: 'ACME-12',
      heading: 'Add roles',
      detail: 'A decision waits for you',
    })
  })

  test('unfocused gives a system notification', () => {
    expect(shown([need()], away).where).toBe('system')
  })
})

describe('The switches', () => {
  test('a kind turned off sends nothing', () => {
    expect(deliveryOf([need()], { ...away, settings: kindOff('need') })).toBeNull()
  })

  test('a kind turned off leaves the others of a group', () => {
    const delivery = shown([need(), failure()], { ...away, settings: kindOff('need') })
    expect(delivery.needIds).toHaveLength(1)
    expect(delivery.sound).toBe('error')
  })

  test('a sound turned off is not played while the notification is shown', () => {
    const delivery = shown([need()], { ...away, settings: soundOff('needs-you') })
    expect(delivery.where).toBe('system')
    expect(delivery.sound).toBeNull()
  })

  test('the error sound turned off: a mixed group plays the next one that is on', () => {
    expect(shown([need(), failure()], { ...away, settings: soundOff('error') }).sound).toBe(
      'needs-you',
    )
  })

  test('a kind with no sound plays none', () => {
    expect(shown([need({ sound: null, importance: 0 })], away).sound).toBeNull()
  })
})

describe('Do Not Disturb', () => {
  test('on: no system notification, no sound', () => {
    expect(deliveryOf([need(), failure()], { ...away, doNotDisturb: 'on' })).toBeNull()
  })

  test('on, the window focused: the in-app notification still appears, silently', () => {
    const delivery = shown([need()], { ...here, doNotDisturb: 'on' })
    expect(delivery.where).toBe('in-app')
    expect(delivery.sound).toBeNull()
  })

  test('unreadable: the system notification is sent, Hemera plays no sound of its own', () => {
    const delivery = shown([need()], { ...away, doNotDisturb: 'unknown' })
    expect(delivery.where).toBe('system')
    expect(delivery.sound).toBeNull()
  })

  test('unreadable, the window focused: the in-app one keeps its sound', () => {
    expect(shown([need()], { ...here, doNotDisturb: 'unknown' }).sound).toBe('needs-you')
  })
})

describe('A need that ends takes its notification away', () => {
  test('the last need of a notification closes it; one of several only shrinks it', () => {
    const [first, second] = [need(), need()]
    const one = shown([first!], away)
    const group = shown([first!, second!], away)
    expect(withoutNeed(one, first!.needId!)).toEqual({ closed: true, delivery: one })
    const shrunk = withoutNeed(group, first!.needId!)
    expect(shrunk.closed).toBe(false)
    expect(shrunk.delivery.needIds).toEqual([second!.needId])
  })

  test('a notification about no need is never closed by one', () => {
    const delivery = shown([need({ needId: null })], away)
    expect(withoutNeed(delivery, 'need-x').closed).toBe(false)
  })
})
