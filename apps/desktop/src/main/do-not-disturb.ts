/**
 * Do Not Disturb, read through a port per system, at the moment a notification is about to go.
 *
 * - **Linux**: what the session offers. On GNOME, its `show-banners` setting (off means Do Not
 *   Disturb); elsewhere the `Inhibited` property of `org.freedesktop.Notifications`, which KDE's
 *   server keeps; then mako's modes, on a wlroots desktop (`do-not-disturb` among them means on).
 * - **Windows**: the user notification state (`SHQueryUserNotificationState`): quiet hours,
 *   presentation mode, a full-screen application, a locked session.
 *
 * A desktop that answers none of these is unreadable: the system notification is still sent and
 * its server applies its own Do Not Disturb. Nothing here is guessed.
 */

import { execFile } from 'node:child_process'

import type { DoNotDisturb } from './notifications.ts'

/** What a program printed, or null when it could not be run or failed. */
export type Asker = (program: string, args: ReadonlyArray<string>) => Promise<string | null>

type Read = 'on' | 'off' | null

/** `busctl get-property` of a boolean: `b true`. */
export function fromInhibited(said: string): Read {
  const value = said.trim()
  if (value === 'b true') return 'on'
  if (value === 'b false') return 'off'
  return null
}

/** `gsettings get org.gnome.desktop.notifications show-banners`: no banners is Do Not Disturb. */
export function fromShowBanners(said: string): Read {
  const value = said.trim()
  if (value === 'false') return 'on'
  if (value === 'true') return 'off'
  return null
}

/** `makoctl mode`: the modes set, one per line. */
export function fromMakoModes(said: string): Read {
  return said.split(/\r?\n/).some((mode) => mode.trim() === 'do-not-disturb') ? 'on' : 'off'
}

/**
 * The `QUERY_USER_NOTIFICATION_STATE`: 5 accepts notifications; 1 (locked, screen saver), 2
 * (busy), 3 (a full-screen Direct3D application), 4 (presentation mode), 6 (quiet time) and 7 (a
 * full-screen application) do not.
 */
export function fromUserNotificationState(said: string): Read {
  const state = Number.parseInt(said.trim(), 10)
  if (state === 5) return 'off'
  if ([1, 2, 3, 4, 6, 7].includes(state)) return 'on'
  return null
}

const DBUS = [
  '--user',
  'get-property',
  'org.freedesktop.Notifications',
  '/org/freedesktop/Notifications',
  'org.freedesktop.Notifications',
  'Inhibited',
]

const GNOME_BANNERS = ['get', 'org.gnome.desktop.notifications', 'show-banners']

/** Asks the shell for the state through a declaration of the function, then prints it. */
const WINDOWS_STATE = [
  '-NoProfile',
  '-NonInteractive',
  '-Command',
  [
    'Add-Type -Namespace Hemera -Name Shell -MemberDefinition \'[DllImport("shell32.dll")] public static extern int SHQueryUserNotificationState(out int state);\'',
    '$state = 0',
    '[void][Hemera.Shell]::SHQueryUserNotificationState([ref]$state)',
    '$state',
  ].join('; '),
]

interface Probe {
  readonly program: string
  readonly args: ReadonlyArray<string>
  readonly read: (said: string) => Read
}

/** What to ask, in order, on this system and session. */
function probesOf(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): ReadonlyArray<Probe> {
  if (platform === 'win32') {
    return [{ program: 'powershell.exe', args: WINDOWS_STATE, read: fromUserNotificationState }]
  }
  if (platform !== 'linux') return []
  const gnome = (env['XDG_CURRENT_DESKTOP'] ?? '').split(':').includes('GNOME')
  return [
    ...(gnome ? [{ program: 'gsettings', args: GNOME_BANNERS, read: fromShowBanners }] : []),
    { program: 'busctl', args: DBUS, read: fromInhibited },
    { program: 'makoctl', args: ['mode'], read: fromMakoModes },
  ]
}

/** Do Not Disturb as this desktop says it: the first answer that reads, or unreadable. */
export async function readDoNotDisturb(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  ask: Asker,
): Promise<DoNotDisturb> {
  for (const probe of probesOf(platform, env)) {
    // oxlint-disable-next-line no-await-in-loop -- in order: the first answer that reads wins
    const said = await ask(probe.program, probe.args)
    const read = said === null ? null : probe.read(said)
    if (read !== null) return read
  }
  return 'unknown'
}

/** How long a probe may take before it counts as no answer. */
const PROBE_LIMIT_MILLIS = 3000

/** The machine's own programs, run without a shell or a window, bounded in time. */
export const systemAsker: Asker = (program, args) =>
  new Promise((resolve) => {
    execFile(
      program,
      [...args],
      { timeout: PROBE_LIMIT_MILLIS, windowsHide: true, encoding: 'utf8' },
      (error, stdout) => resolve(error === null ? stdout : null),
    )
  })
