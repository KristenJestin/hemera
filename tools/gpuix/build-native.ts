#!/usr/bin/env bun
/**
 * Builds the GPUiX native addon for the host target, from the fork checked out beside this
 * repository, checks that generating the bindings did not truncate the product-facing type
 * surface, loads the addon on the host, and reports the toolchain that produced it.
 *
 *   bun tools/gpuix/build-native.ts                 release build, what ships
 *   bun tools/gpuix/build-native.ts --test-support  build carrying the GPUI test renderer
 *
 * The addon stays where it was built: the product depends on the fork by path, so there is
 * nothing to copy anywhere and no artefact to keep in step with a manifest.
 */

import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { platform, release, version } from 'node:os'
import { join, resolve } from 'node:path'

/** Build variants of the addon. */
export type Variant = 'release' | 'test-support'

/** Names the product itself calls; losing one of them is a truncated generation. */
const PRODUCT_SURFACE = 'GpuixRenderer'

export interface NativeBuildRecord {
  target: string
  variant: Variant
  addon: { file: string; sha256: string; bytes: number }
  /** Names present in the tracked bindings but absent from the generated ones. */
  truncatedNames: string[]
  load: { ok: boolean; exports: string[]; error: string | null }
  environment: {
    os: { platform: string; release: string; version: string }
    toolchain: { rustc: string; cargo: string; bun: string; napi: string }
  }
}
interface CommandResult {
  ok: boolean
  stdout: string
  stderr: string
}

function run(command: string[], cwd: string): CommandResult {
  const result = Bun.spawnSync(command, { cwd, stdout: 'pipe', stderr: 'pipe' })
  const decoder = new TextDecoder()
  return {
    ok: result.exitCode === 0,
    stdout: decoder.decode(result.stdout).trim(),
    stderr: decoder.decode(result.stderr).trim(),
  }
}

function versionOf(command: string[], cwd: string): string {
  const result = run(command, cwd)
  return result.ok ? result.stdout.split('\n')[0]! : `unavailable: ${result.stderr}`
}

/** Top-level declarations and class members declared by generated NAPI bindings. */
export function declaredNames(bindings: string): string[] {
  const names: string[] = []
  let currentClass: string | null = null
  for (const raw of bindings.split('\n')) {
    const line = raw.trim()
    const declaration = /^export declare (?:class|function|const|enum) ([A-Za-z0-9_]+)/.exec(line)
    if (declaration !== null) {
      names.push(declaration[1]!)
      currentClass = line.startsWith('export declare class') ? declaration[1]! : null
      continue
    }
    const type = /^export (?:interface|type) ([A-Za-z0-9_]+)/.exec(line)
    if (type !== null) {
      names.push(type[1]!)
      currentClass = null
      continue
    }
    if (line === '}') {
      currentClass = null
      continue
    }
    if (currentClass !== null) {
      const member = /^([A-Za-z0-9_]+)\s*\(/.exec(line)
      if (member !== null) names.push(`${currentClass}.${member[1]!}`)
    }
  }
  return names
}

/** Names the tracked bindings declare and the generated ones no longer declare. */
export function truncatedNames(tracked: string, generated: string): string[] {
  const produced = new Set(declaredNames(generated))
  return declaredNames(tracked).filter((name) => !produced.has(name))
}

function sha256Of(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function addonFileOf(nativePackage: string): string {
  const found = readdirSync(nativePackage).find((entry) => entry.endsWith('.node'))
  if (found === undefined) throw new Error(`no .node addon produced in ${nativePackage}`)
  return found
}

/**
 * Builds the addon in place and reports what came out of it.
 *
 * `build:release` leaves `gpui/test-support` out — upstream turns it on by default, and a
 * `gpui` built with it draws two to three frames per input event instead of one.
 */
export function buildNative(forkPath: string, variant: Variant): NativeBuildRecord {
  const nativePackage = join(forkPath, 'packages', 'native')
  const tracked = run(['git', 'show', 'HEAD:packages/native/index.d.ts'], forkPath)
  if (!tracked.ok) throw new Error('the fork does not track packages/native/index.d.ts')

  const script = variant === 'test-support' ? 'build' : 'build:release'
  const build = run(['bun', 'run', script], nativePackage)
  if (!build.ok) {
    throw new Error(`the ${variant} native build failed: ${build.stderr || build.stdout}`)
  }

  const target = run(['rustc', '-vV'], nativePackage)
    .stdout.split('\n')
    .find((line) => line.startsWith('host: '))
    ?.slice('host: '.length)
  if (target === undefined) throw new Error('could not determine the host target triple')

  const addon = addonFileOf(nativePackage)
  const generated = readFileSync(join(nativePackage, 'index.d.ts'), 'utf8')
  const truncated = truncatedNames(tracked.stdout, generated)
  const lostProductNames = truncated.filter(
    (name) => name === PRODUCT_SURFACE || name.startsWith(`${PRODUCT_SURFACE}.`),
  )
  if (lostProductNames.length > 0) {
    throw new Error(
      `generating the bindings truncated the product surface: ${lostProductNames.join(', ')}`,
    )
  }

  const load = run(
    ['bun', '-e', 'console.log(Object.keys(require("./index.js")).toSorted().join(","))'],
    nativePackage,
  )

  return {
    target,
    variant,
    addon: {
      file: addon,
      sha256: sha256Of(join(nativePackage, addon)),
      bytes: statSync(join(nativePackage, addon)).size,
    },
    truncatedNames: truncated,
    load: {
      ok: load.ok,
      exports: load.ok ? load.stdout.split(',') : [],
      error: load.ok ? null : load.stderr,
    },
    environment: {
      os: { platform: platform(), release: release(), version: version() },
      toolchain: {
        rustc: versionOf(['rustc', '--version'], nativePackage),
        cargo: versionOf(['cargo', '--version'], nativePackage),
        bun: versionOf(['bun', '--version'], nativePackage),
        napi: versionOf(['bun', 'x', 'napi', '--version'], nativePackage),
      },
    },
  }
}

if (import.meta.main) {
  const repository = resolve(import.meta.dir, '..', '..')
  const forkPath = resolve(repository, '..', 'gpuix')
  const variant: Variant = process.argv.includes('--test-support') ? 'test-support' : 'release'
  const record = buildNative(forkPath, variant)

  console.log(`${record.variant} addon for ${record.target}: ${record.addon.file}`)
  console.log(`  sha256 ${record.addon.sha256}`)
  console.log(`  loaded: ${record.load.ok ? record.load.exports.join(', ') : record.load.error}`)
  if (record.truncatedNames.length > 0) {
    console.log(`  names absent from this variant: ${record.truncatedNames.length}`)
  }
  if (!record.load.ok) process.exit(1)
}
