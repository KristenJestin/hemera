/**
 * Which keyring Linux protects the Jev key with.
 *
 * Electron picks a keyring from the desktop it recognises; on any other (Hyprland, Sway…) it falls
 * back to `basic_text`, which protects nothing and is refused, even when a Secret Service
 * (gnome-keyring, KeePassXC) is on the session bus. Hemera then asks for libsecret itself, before
 * the application is ready, and never over a `--password-store` the user passed. The decisions
 * are pure; only `readBusNames` asks the machine, in one bounded round trip.
 */

import { execFile } from 'node:child_process'

/** The name a Secret Service owns on the session bus. */
export const SECRET_SERVICE = 'org.freedesktop.secrets'

/** The switch Chromium reads its keyring from. */
export const PASSWORD_STORE = 'password-store'

/** The desktops Electron chooses a keyring for on its own, as Chromium names them. */
const KEYRING_DESKTOPS = [
  'gnome',
  'unity',
  'x-cinnamon',
  'cinnamon',
  'kde',
  'xfce',
  'pantheon',
  'deepin',
  'ukui',
  'mate',
]

function keyringDesktop(env: Readonly<Record<string, string | undefined>>): boolean {
  const named = env['XDG_CURRENT_DESKTOP'] || env['DESKTOP_SESSION'] || ''
  return named
    .toLowerCase()
    .split(':')
    .some((desktop) => KEYRING_DESKTOPS.some((known) => desktop.startsWith(known)))
}

/**
 * The keyring to ask for before the application is ready, or null to leave Electron's choice:
 * only on Linux, only when the user passed no `--password-store`, only on a desktop Electron does
 * not pick a keyring for, and only when a Secret Service is on the bus. `busNames` is null when
 * the session bus could not be asked.
 */
export function passwordStoreSwitch(start: {
  readonly platform: string
  readonly env: Readonly<Record<string, string | undefined>>
  readonly argv: ReadonlyArray<string>
  readonly busNames: ReadonlyArray<string> | null
}): 'gnome-libsecret' | null {
  if (start.platform !== 'linux') return null
  if (start.argv.some((argument) => argument.startsWith(`--${PASSWORD_STORE}`))) return null
  if (keyringDesktop(start.env)) return null
  return start.busNames?.includes(SECRET_SERVICE) === true ? 'gnome-libsecret' : null
}

/** What the settings say is missing when Linux has no protected storage, or null. */
export function missingSecretService(state: {
  readonly platform: string
  readonly ready: boolean
  readonly busNames: ReadonlyArray<string> | null
}): string | null {
  if (state.platform !== 'linux' || state.ready) return null
  if (state.busNames === null) {
    return 'No session bus was found. Start one with a Secret Service, then restart Hemera.'
  }
  if (state.busNames.includes(SECRET_SERVICE)) return null
  return 'No Secret Service is running. Install and start gnome-keyring or KeePassXC, then restart Hemera.'
}

/** The quoted names `dbus-send --print-reply` lists. */
export function busNamesFrom(printed: string): string[] {
  return [...printed.matchAll(/^\s*string "([^"]*)"$/gm)].map(([, name]) => name ?? '')
}

const ask = (method: 'ListNames' | 'ListActivatableNames') =>
  new Promise<string[]>((done, fail) => {
    execFile(
      'dbus-send',
      [
        '--session',
        '--print-reply',
        '--dest=org.freedesktop.DBus',
        '/org/freedesktop/DBus',
        `org.freedesktop.DBus.${method}`,
      ],
      { encoding: 'utf8', timeout: 1000 },
      (error, printed) => (error === null ? done(busNamesFrom(printed)) : fail(error)),
    )
  })

/**
 * The names on the session bus, owned or activatable, or null when it cannot be asked (no bus,
 * no `dbus-send`, or no answer within a second).
 */
export async function readBusNames(): Promise<string[] | null> {
  try {
    const [owned, activatable] = await Promise.all([ask('ListNames'), ask('ListActivatableNames')])
    return [...owned, ...activatable]
  } catch {
    return null
  }
}
