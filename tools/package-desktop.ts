#!/usr/bin/env bun
/**
 * Assembles the portable desktop package of the target this machine is.
 *
 * The executable carries the Bun runtime, the sources of the internal packages, the
 * statically imported migrations, the fonts and the native addon of its target. It starts
 * outside the sources, from a folder whose path has spaces, with no `node_modules` of the
 * monorepo beside it and with nothing of a spike in it.
 *
 * An update is a replacement of the package: there is no auto-updater in this delivery.
 *
 *   bun tools/package-desktop.ts              assemble the dev package
 *   bun tools/package-desktop.ts --prod       assemble the prod package
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { TARGETS, targetOfHost } from './environment-report.ts'
import type { Target } from './environment-report.ts'

/** Name the executable carries in the package. */
export function executableNameOf(target: Target): string {
  return target === TARGETS['win32-x64'] ? 'hemera.exe' : 'hemera'
}

/** Bun target the assembler compiles for. */
function bunTargetOf(target: Target): string {
  return target === TARGETS['win32-x64'] ? 'bun-windows-x64' : 'bun-linux-x64'
}

export function packageNameOf(channel: string, target: Target): string {
  return `hemera-${channel}-${target}`
}

/**
 * System prerequisites of a package, per target.
 *
 * Windows has no documented prerequisite to this day; that is an open point of the lot and is
 * written as such rather than filled in with a guess.
 */
export const SYSTEM_REQUIREMENTS: Record<Target, string[]> = {
  [TARGETS['win32-x64']]: [
    'Windows 10 or 11, x64.',
    'A GPU and driver supporting DirectX 12.',
    'No further prerequisite is documented to this day: this is an open point of the lot,',
    'to be established by running the package on a machine that never built it.',
  ],
  [TARGETS['linux-x64']]: [
    'Linux x64 with glibc.',
    'A Wayland compositor, or X11.',
    'libxkbcommon.',
    'A Vulkan loader and a driver (Mesa/EGL).',
    'Neither fontconfig nor freetype is needed: the fonts are embedded in the executable.',
  ],
}

function requirementsDocument(target: Target, channel: string): string {
  return [
    `# System prerequisites — ${target}`,
    '',
    `Channel of this package: \`${channel}\`.`,
    '',
    ...SYSTEM_REQUIREMENTS[target].map((line) => `- ${line}`),
    '',
    '## Updating',
    '',
    'Replace the whole package folder with the new one. Hemera downloads nothing and installs',
    'nothing on its own at start-up, and there is no auto-updater in this delivery. The profile',
    'lives outside the package, so a replacement finds the same projects and sessions again.',
    '',
  ].join('\n')
}

function sha256Of(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

interface VendorManifest {
  version: string
  fork: { headCommit: string }
}

function forkOf(repositoryRoot: string): { version: string; head: string } {
  const root = join(repositoryRoot, 'vendor', 'gpuix')
  const version = existsSync(root) ? (readdirSync(root)[0] ?? null) : null
  if (version === null) return { version: 'unknown', head: 'unknown' }
  const manifest = JSON.parse(
    readFileSync(join(root, version, 'manifest.json'), 'utf8'),
  ) as VendorManifest
  return { version: manifest.version, head: manifest.fork.headCommit }
}

export interface AssembledPackage {
  directory: string
  executable: string
  channel: string
  target: Target
  sha256: string
}

export async function assemblePackage(
  repositoryRoot: string,
  channel: 'prod' | 'dev',
  outputRoot = join(repositoryRoot, 'dist'),
): Promise<AssembledPackage> {
  const target = targetOfHost()
  const directory = join(outputRoot, packageNameOf(channel, target))
  rmSync(directory, { recursive: true, force: true })
  mkdirSync(directory, { recursive: true })

  const executable = join(directory, executableNameOf(target))
  const build = Bun.spawnSync(
    [
      'bun',
      'build',
      '--compile',
      `--target=${bunTargetOf(target)}`,
      // The channel becomes a literal of the bundle: a package cannot be told it is another.
      '--define',
      `HEMERA_PACKAGED_CHANNEL="${channel}"`,
      join(repositoryRoot, 'apps', 'desktop', 'src', 'entry', 'main.tsx'),
      '--outfile',
      executable,
    ],
    { cwd: repositoryRoot, stdout: 'pipe', stderr: 'pipe' },
  )
  if (build.exitCode !== 0) {
    throw new Error(`the assembly failed: ${new TextDecoder().decode(build.stderr)}`)
  }

  const fork = forkOf(repositoryRoot)
  writeFileSync(join(directory, 'SYSTEM-REQUIREMENTS.md'), requirementsDocument(target, channel))
  writeFileSync(
    join(directory, 'manifest.json'),
    `${JSON.stringify(
      {
        channel,
        target,
        executable: executableNameOf(target),
        sha256: sha256Of(executable),
        fork,
        assembledAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  )

  return { directory, executable, channel, target, sha256: sha256Of(executable) }
}

if (import.meta.main) {
  const repositoryRoot = resolve(import.meta.dir, '..')
  const channel = process.argv.includes('--prod') ? 'prod' : 'dev'
  const assembled = await assemblePackage(repositoryRoot, channel)
  console.log(`assembled ${assembled.directory}`)
  console.log(`${assembled.executable} ${assembled.sha256}`)
}
