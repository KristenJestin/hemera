/**
 * The environment report of the target this machine is (design D0-07).
 *
 * A report describes the machine it was produced on and nothing else. A field that cannot be
 * read is reported as unknown or null rather than guessed, and what this target cannot speak
 * for is named in `notVerified` instead of being left out. A target counts as verified only
 * with its own report beside it.
 */

import { readFileSync } from 'node:fs'
import { release, version } from 'node:os'

import type { Display, EnvironmentReport, Graphics } from '@hemera/ipc'
import { app, screen } from 'electron/main'

import type { ApplicationIdentity } from './channel.ts'

/** Value used when a field exists but could not be read. */
export const UNKNOWN = 'unknown'

/** What a report produced on one target never claims about the others. */
export const OTHER_TARGETS = new Map<string, string[]>([
  ['windows', ['linux/wayland: not verified by this report']],
  ['linux', ['windows: not verified by this report']],
])

function distributionOf(): string | null {
  if (process.platform !== 'linux') return null
  try {
    const described = readFileSync('/etc/os-release', 'utf8')
    return /^PRETTY_NAME="?(.+?)"?$/m.exec(described)?.[1] ?? UNKNOWN
  } catch {
    return UNKNOWN
  }
}

/**
 * The backend the GPU process actually runs on, read from its own command line.
 *
 * It is read rather than assumed because the application passes no platform flag: what
 * Chromium picked is the only answer worth reporting, and the question the Linux target asks.
 */
export function gpuBackendOf(commandLine: string): string | null {
  return /--ozone-platform(?:-hint)?=([\w-]+)/.exec(commandLine)?.[1] ?? null
}

function gpuCommandLine(): string | null {
  if (process.platform !== 'linux') return null
  const gpu = app.getAppMetrics().find((metric) => metric.type === 'GPU')
  if (gpu === undefined) return null
  try {
    return readFileSync(`/proc/${gpu.pid}/cmdline`, 'utf8').replaceAll('\0', ' ')
  } catch {
    return null
  }
}

async function graphicsOf(environment = process.env): Promise<Graphics> {
  const onLinux = process.platform === 'linux'
  const commandLine = gpuCommandLine()
  // Asked for before the feature status is read, and awaited: until the GPU process has
  // answered, Electron reports every feature as software and the report would name a
  // degradation that is only the question arriving too early.
  // SAFETY: Electron types `getGPUInfo` as `unknown`; the `complete` form is documented to
  // carry `gpuDevice[]` with `active` and `deviceString`, and every field is read optionally.
  const info = (await app.getGPUInfo('complete')) as {
    gpuDevice?: { active?: boolean; deviceString?: string }[]
  }
  const active = info.gpuDevice?.find((device) => device.active === true)
  return {
    device: active?.deviceString ?? null,
    session: onLinux ? (environment.XDG_SESSION_TYPE ?? UNKNOWN) : process.platform,
    compositor: onLinux
      ? (environment.XDG_CURRENT_DESKTOP ?? environment.DESKTOP_SESSION ?? UNKNOWN)
      : null,
    gpuBackend: commandLine === null ? null : gpuBackendOf(commandLine),
    features: Object.fromEntries(Object.entries(app.getGPUFeatureStatus())),
  }
}

function displaysOf(): Display[] {
  const primary = screen.getPrimaryDisplay().id
  return screen.getAllDisplays().map((display) => ({
    id: display.id,
    width: display.size.width,
    height: display.size.height,
    scaleFactor: display.scaleFactor,
    refreshRate: display.displayFrequency,
    primary: display.id === primary,
  }))
}

/** The name this target is filed under, and the one the other targets are named against. */
export function targetOf(platform: string = process.platform): string {
  if (platform === 'win32') return 'windows'
  if (platform === 'linux') return 'linux'
  return platform
}

export async function collectReport(identity: ApplicationIdentity): Promise<EnvironmentReport> {
  const target = targetOf()
  const graphics = await graphicsOf()
  return {
    version: identity.version,
    channel: identity.channel,
    platform: target,
    osVersion: `${version()} (${release()})`,
    distribution: distributionOf(),
    graphics,
    displays: displaysOf(),
    versions: {
      electron: process.versions.electron ?? UNKNOWN,
      chrome: process.versions.chrome ?? UNKNOWN,
      node: process.versions.node,
    },
    motion: null,
    notVerified: OTHER_TARGETS.get(target) ?? [],
    producedAt: new Date().toISOString(),
  }
}
