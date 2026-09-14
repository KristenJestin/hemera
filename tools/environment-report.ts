#!/usr/bin/env bun
/**
 * Environment report of the target this machine is, as decided in D02.
 *
 * A report describes the machine it was produced on and nothing else: a field that cannot be
 * read is reported as unknown rather than guessed, and no result is carried from one target to
 * another. A target is only ever declared verified with its own report beside it.
 *
 *   bun tools/environment-report.ts            print the report
 *   bun tools/environment-report.ts --write    write reports/environment-<target>.md
 *   bun tools/environment-report.ts --window   also launch the window and observe it
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { arch, platform, release, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

/** Value used when a field cannot be read; never replaced by a plausible one. */
export const UNKNOWN = 'unknown'

/** Targets the lot compiles for. */
export const TARGETS = {
  'win32-x64': 'x86_64-pc-windows-msvc',
  'linux-x64': 'x86_64-unknown-linux-gnu',
} as const

export type Target = (typeof TARGETS)[keyof typeof TARGETS]

export interface EnvironmentReport {
  target: Target
  producedAt: string
  system: { name: string; version: string }
  graphics: { session: string; compositor: string }
  gpu: { model: string; driver: string }
  toolchain: { bun: string; rust: string; compiler: string }
  artefacts: { fork: string; head: string; packages: { name: string; sha256: string }[] }
  observation: { window: string; errors: string[] }
}

/** The target this machine is, refusing to report about one it is not. */
export function targetOfHost(hostPlatform: string = platform(), hostArch: string = arch()): Target {
  const target = TARGETS[`${hostPlatform}-${hostArch}` as keyof typeof TARGETS]
  if (target === undefined) {
    throw new Error(`no target of the lot matches ${hostPlatform}/${hostArch}`)
  }
  return target
}

/** Runs a command and gives its first line, or `unknown` when it cannot be read. */
function readCommand(command: string[]): string {
  try {
    const run = Bun.spawnSync(command, { stdout: 'pipe', stderr: 'pipe' })
    if (run.exitCode !== 0) return UNKNOWN
    const line = new TextDecoder()
      .decode(run.stdout)
      .split('\n')
      .map((candidate) => candidate.trim())
      .find((candidate) => candidate.length > 0)
    return line ?? UNKNOWN
  } catch {
    return UNKNOWN
  }
}

function windowsGpu(): { model: string; driver: string } {
  const read = (property: string) =>
    readCommand([
      'powershell',
      '-NoProfile',
      '-Command',
      `(Get-CimInstance Win32_VideoController | Select-Object -First 1).${property}`,
    ])
  return { model: read('Name'), driver: read('DriverVersion') }
}

function linuxGpu(): { model: string; driver: string } {
  const renderer = readCommand(['sh', '-c', "glxinfo -B 2>/dev/null | grep -i 'OpenGL renderer'"])
  const mesa = readCommand(['sh', '-c', "glxinfo -B 2>/dev/null | grep -i 'OpenGL version'"])
  return { model: renderer, driver: mesa }
}

function systemOf(target: Target): { name: string; version: string } {
  if (target === TARGETS['win32-x64']) {
    return {
      name: readCommand([
        'powershell',
        '-NoProfile',
        '-Command',
        '(Get-CimInstance Win32_OperatingSystem).Caption',
      ]),
      version: release(),
    }
  }
  const description = readCommand([
    'sh',
    '-c',
    'lsb_release -ds 2>/dev/null || cat /etc/os-release',
  ])
  return { name: description, version: release() }
}

function graphicsOf(target: Target): { session: string; compositor: string } {
  if (target === TARGETS['win32-x64']) {
    // Windows composes the desktop itself; there is no session type to choose from.
    return { session: 'Windows Desktop Window Manager', compositor: 'DWM' }
  }
  const session = process.env.XDG_SESSION_TYPE ?? UNKNOWN
  const compositor =
    process.env.WAYLAND_DISPLAY !== undefined
      ? `Wayland (${process.env.WAYLAND_DISPLAY})`
      : process.env.DISPLAY !== undefined
        ? `X11 (${process.env.DISPLAY})`
        : UNKNOWN
  return { session, compositor }
}

/** Path the Visual Studio installer records its own inventory at. */
const VSWHERE = 'C:/Program Files (x86)/Microsoft Visual Studio/Installer/vswhere.exe'

function compilerOf(target: Target): string {
  if (target !== TARGETS['win32-x64']) return readCommand(['sh', '-c', 'gcc --version'])
  // `cl` only exists inside a developer prompt; the installer knows what is installed.
  const onPath = readCommand(['cmd', '/c', 'cl'])
  if (onPath !== UNKNOWN) return onPath
  if (!existsSync(VSWHERE)) return UNKNOWN
  const version = readCommand([
    VSWHERE,
    '-products',
    '*',
    '-latest',
    '-property',
    'installationVersion',
  ])
  const edition = readCommand([VSWHERE, '-products', '*', '-latest', '-property', 'displayName'])
  return version === UNKNOWN ? UNKNOWN : `MSVC ${version} (${edition})`
}

interface VendorManifest {
  version: string
  fork: { headCommit: string }
  packages: { name: string; sha256: string; target: string | null }[]
}

function artefactsOf(repositoryRoot: string, target: Target): EnvironmentReport['artefacts'] {
  const root = join(repositoryRoot, 'vendor', 'gpuix')
  const version = existsSync(root) ? (readdirSync(root)[0] ?? null) : null
  const manifestPath = version === null ? null : join(root, version, 'manifest.json')
  if (manifestPath === null || !existsSync(manifestPath)) {
    return { fork: UNKNOWN, head: UNKNOWN, packages: [] }
  }

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as VendorManifest
  return {
    fork: manifest.version,
    head: manifest.fork.headCommit,
    // Only the packages of this target: a report never names an artefact it cannot load.
    packages: manifest.packages
      .filter((entry) => entry.target === null || entry.target === target)
      .map((entry) => ({ name: entry.name, sha256: entry.sha256 })),
  }
}

/**
 * Launches the desktop entry on a temporary profile and reports what the window did.
 *
 * Nothing here is inferred: the observation is what the process printed, and a launch that
 * printed nothing is reported as such.
 */
export async function observeWindow(
  repositoryRoot: string,
  timeoutMs = 60_000,
): Promise<{
  window: string
  errors: string[]
}> {
  const profile = mkdtempSync(join(tmpdir(), 'hemera-report-'))
  const child = Bun.spawn(['bun', 'src/entry/main.tsx'], {
    cwd: join(repositoryRoot, 'apps', 'desktop'),
    env: { ...process.env, HEMERA_PROFILE_DIR: profile },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const lines: string[] = []
  const deadline = Date.now() + timeoutMs
  try {
    const reader = child.stdout.getReader()
    const decoder = new TextDecoder()
    let buffered = ''
    while (Date.now() < deadline) {
      // oxlint-disable-next-line no-await-in-loop
      const { value, done } = await reader.read()
      if (done) break
      buffered += decoder.decode(value, { stream: true })
      const parts = buffered.split('\n')
      buffered = parts.pop() ?? ''
      lines.push(...parts.map((line) => line.trim()).filter((line) => line.length > 0))
      if (lines.some((line) => line.startsWith('window opened'))) break
    }
  } finally {
    child.kill()
    await child.exited
    rmSync(profile, { recursive: true, force: true })
  }

  const errors = (await new Response(child.stderr).text())
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  // Two different statements, and only one of them is proof. The size the application reports
  // comes from its own gate, and the headless client of GPUI hands it the nominal size of a
  // window it never created: dimensions alone say nothing. What says something is the renderer
  // announcing the native window it made.
  const measured = lines.find((line) => line.startsWith('window opened'))
  const created = lines.includes('[gpuix] created native window')
  if (created && measured !== undefined) {
    return { window: `native window created, ${measured}`, errors }
  }
  if (measured !== undefined) {
    return {
      window: `${measured}, but the renderer announced no native window: it ran headless`,
      errors,
    }
  }
  return { window: 'no window announced itself', errors }
}

export interface ReportOptions {
  repositoryRoot: string
  /** Observation of the window, when the run is allowed to open one. */
  observation?: EnvironmentReport['observation']
}

export function collectReport({ repositoryRoot, observation }: ReportOptions): EnvironmentReport {
  const target = targetOfHost()
  return {
    target,
    producedAt: new Date().toISOString(),
    system: systemOf(target),
    graphics: graphicsOf(target),
    gpu: target === TARGETS['win32-x64'] ? windowsGpu() : linuxGpu(),
    toolchain: {
      bun: readCommand(['bun', '--version']),
      rust: readCommand(['rustc', '--version']),
      compiler: compilerOf(target),
    },
    artefacts: artefactsOf(repositoryRoot, target),
    observation: observation ?? { window: 'not observed in this run', errors: [] },
  }
}

/** The report as the document joined to the result of the lot. */
export function renderReport(report: EnvironmentReport): string {
  const rows = [
    ['System and version', `${report.system.name} — ${report.system.version}`],
    ['Graphical session', `${report.graphics.session} — ${report.graphics.compositor}`],
    ['GPU and driver', `${report.gpu.model} — ${report.gpu.driver}`],
    [
      'Toolchain',
      `Bun ${report.toolchain.bun}, ${report.toolchain.rust}, ${report.toolchain.compiler}`,
    ],
    [
      'Artefacts',
      `fork ${report.artefacts.fork} (${report.artefacts.head}), ${report.artefacts.packages
        .map((entry) => `${entry.name} ${entry.sha256.slice(0, 12)}`)
        .join(', ')}`,
    ],
    [
      'Observation',
      report.observation.errors.length === 0
        ? report.observation.window
        : `${report.observation.window}; errors: ${report.observation.errors.join(' | ')}`,
    ],
  ]

  return [
    `# Environment report — ${report.target}`,
    '',
    `Produced on ${report.producedAt}. This report describes this machine only: nothing here`,
    'is carried over to another target, and a field that could not be read says so.',
    '',
    '| Field | Value |',
    '|---|---|',
    ...rows.map(([field, value]) => `| ${field} | ${value} |`),
    '',
  ].join('\n')
}

export function reportPathOf(repositoryRoot: string, target: Target): string {
  return join(repositoryRoot, 'reports', `environment-${target}.md`)
}

if (import.meta.main) {
  const repositoryRoot = resolve(import.meta.dir, '..')
  const observation = process.argv.includes('--window')
    ? await observeWindow(repositoryRoot)
    : undefined
  const report = collectReport(
    observation === undefined ? { repositoryRoot } : { repositoryRoot, observation },
  )
  const document = renderReport(report)

  if (process.argv.includes('--write')) {
    const path = reportPathOf(repositoryRoot, report.target)
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, document)
    console.log(`written ${path}`)
  } else {
    console.log(document)
  }
}
