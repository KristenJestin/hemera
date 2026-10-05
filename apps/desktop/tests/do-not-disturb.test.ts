/**
 * Do Not Disturb, read through what each desktop offers: the notification server's `Inhibited`
 * property, GNOME's banners, mako's modes, and Windows' user notification state. A desktop that
 * answers none of them is unreadable, never guessed.
 */

import { describe, expect, test } from 'vite-plus/test'

import {
  type Asker,
  fromInhibited,
  fromMakoModes,
  fromShowBanners,
  fromUserNotificationState,
  readDoNotDisturb,
} from '../src/main/do-not-disturb.ts'

/** A machine that answers some commands, by their program, and fails every other. */
const answering =
  (answers: Record<string, string>): Asker =>
  (program) =>
    Promise.resolve(answers[program] ?? null)

describe('What each desktop says', () => {
  test.each([
    ['b true\n', 'on'],
    ['b false\n', 'off'],
    ['', null],
  ] as const)('the Inhibited property %j reads %s', (said, read) => {
    expect(fromInhibited(said)).toBe(read)
  })

  test.each([
    ['false\n', 'on'],
    ['true\n', 'off'],
    ['No such key', null],
  ] as const)('GNOME’s show-banners %j reads %s', (said, read) => {
    expect(fromShowBanners(said)).toBe(read)
  })

  test.each([
    ['default\ndo-not-disturb\n', 'on'],
    ['default\n', 'off'],
  ] as const)('mako’s modes %j read %s', (said, read) => {
    expect(fromMakoModes(said)).toBe(read)
  })

  test.each([
    ['5\n', 'off'],
    ['2', 'on'],
    ['3', 'on'],
    ['4', 'on'],
    ['6', 'on'],
    ['7', 'on'],
    ['1', 'on'],
    ['nothing', null],
  ] as const)('Windows’ user notification state %j reads %s', (said, read) => {
    expect(fromUserNotificationState(said)).toBe(read)
  })
})

describe('Reading it on a desktop', () => {
  test('GNOME: its banners setting', async () => {
    const read = await readDoNotDisturb(
      'linux',
      { XDG_CURRENT_DESKTOP: 'ubuntu:GNOME' },
      answering({ gsettings: 'false\n', busctl: 'b false\n' }),
    )
    expect(read).toBe('on')
  })

  test('a server that keeps the Inhibited property: that property', async () => {
    const read = await readDoNotDisturb(
      'linux',
      { XDG_CURRENT_DESKTOP: 'KDE' },
      answering({ busctl: 'b true\n' }),
    )
    expect(read).toBe('on')
  })

  test('Hyprland with mako, which keeps no such property: mako’s mode', async () => {
    const read = await readDoNotDisturb(
      'linux',
      { XDG_CURRENT_DESKTOP: 'Hyprland' },
      answering({ makoctl: 'default\ndo-not-disturb\n' }),
    )
    expect(read).toBe('on')
  })

  test('a desktop that answers nothing: unreadable', async () => {
    expect(await readDoNotDisturb('linux', {}, answering({}))).toBe('unknown')
  })

  test('Windows: the user notification state', async () => {
    expect(await readDoNotDisturb('win32', {}, answering({ 'powershell.exe': '6\n' }))).toBe('on')
    expect(await readDoNotDisturb('win32', {}, answering({ 'powershell.exe': '5\n' }))).toBe('off')
  })

  test('another system: unreadable', async () => {
    expect(await readDoNotDisturb('darwin', {}, answering({}))).toBe('unknown')
  })
})
