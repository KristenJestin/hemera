/**
 * The environment report: what this machine says about itself, read by `--report` and by the
 * window. A field that cannot be read is null rather than guessed, and a report never speaks for
 * a target it was not produced on.
 */

import { readFileSync } from 'node:fs'
import { release, version } from 'node:os'

import type { EnvironmentReport } from '@hemera/ipc'
import type { Screen } from 'electron/main'

import type { Identity } from './identity.ts'

/** What a report produced on one target leaves to the others. */
const OTHER_TARGETS = new Map([
  ['linux', ['windows: not verified by this report']],
  ['win32', ['linux: not verified by this report']],
])

/** The distribution named by an `os-release` file, or null when it names none. */
export function distributionOf(osRelease: string): string | null {
  return /^PRETTY_NAME="?(.+?)"?$/m.exec(osRelease)?.[1] ?? null
}

function readDistribution(): string | null {
  if (process.platform !== 'linux') return null
  try {
    return distributionOf(readFileSync('/etc/os-release', 'utf8'))
  } catch {
    return null
  }
}

/** The report of this run; `screen` is Electron's, which only exists once the application is ready. */
export function collectReport(
  identity: Identity,
  dataFolder: string,
  screen: Pick<Screen, 'getPrimaryDisplay' | 'getAllDisplays'>,
): EnvironmentReport {
  const primary = screen.getPrimaryDisplay().id
  return {
    version: identity.version,
    channel: identity.channel,
    platform: process.platform,
    osVersion: `${version()} (${release()})`,
    distribution: readDistribution(),
    session: process.platform === 'linux' ? (process.env.XDG_SESSION_TYPE ?? null) : null,
    displays: screen.getAllDisplays().map((display) => ({
      width: display.size.width,
      height: display.size.height,
      scaleFactor: display.scaleFactor,
      refreshRate: display.displayFrequency,
      primary: display.id === primary,
    })),
    versions: {
      electron: process.versions.electron ?? 'unknown',
      chrome: process.versions.chrome ?? 'unknown',
      node: process.versions.node,
    },
    dataFolder,
    notVerified: OTHER_TARGETS.get(process.platform) ?? [],
    producedAt: new Date().toISOString(),
  }
}
