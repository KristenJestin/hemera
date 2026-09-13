#!/usr/bin/env bun
/**
 * Packs the GPUiX fork into the versioned tarballs the product consumes (design D01):
 * the React package, the native loader and one platform package per built target, plus a
 * provenance manifest naming the revision, the target and the fingerprint of each tarball.
 *
 * Replaces the fork's Linux-only shell packer; nothing here writes into the fork's tree.
 *
 *   bun tools/gpuix/pack-vendor.ts
 */

import { createHash } from 'node:crypto'
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve, sep } from 'node:path'

import { VENDOR_VERSION } from './build-native.ts'
import type { NativeBuildRecord } from './build-native.ts'

export interface PackagedTarball {
  /** Package name as installed. */
  name: string
  /** Tarball file name inside the vendor directory. */
  file: string
  sha256: string
  /** Target triple for a platform package, null for a portable one. */
  target: string | null
}

export interface VendorManifest {
  version: string
  fork: { remote: string; baseCommit: string; headCommit: string; branch: string }
  packages: PackagedTarball[]
}

/** Operating system and CPU a napi platform name stands for. */
const PLATFORM_CONSTRAINTS: Record<string, { os: string; cpu: string; libc?: string }> = {
  'win32-x64-msvc': { os: 'win32', cpu: 'x64' },
  'linux-x64-gnu': { os: 'linux', cpu: 'x64', libc: 'glibc' },
}

function run(command: string[], cwd: string): { ok: boolean; output: string } {
  const result = Bun.spawnSync(command, { cwd, stdout: 'pipe', stderr: 'pipe' })
  const decoder = new TextDecoder()
  return {
    ok: result.exitCode === 0,
    output: `${decoder.decode(result.stdout)}${decoder.decode(result.stderr)}`.trim(),
  }
}

function mustRun(command: string[], cwd: string): string {
  const result = run(command, cwd)
  if (!result.ok) throw new Error(`${command.join(' ')} failed in ${cwd}: ${result.output}`)
  return result.output
}

function sha256Of(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

/** Napi platform name carried by an addon file, such as `win32-x64-msvc`. */
export function platformNameOf(addonFile: string): string {
  const match = /^gpuix-native\.(.+)\.node$/.exec(addonFile)
  if (match === null) throw new Error(`${addonFile} is not a napi addon file name`)
  return match[1]!
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

/** Packs a staged directory and returns the tarball file name. */
function pack(stage: string, destination: string): string {
  const output = mustRun(
    ['bun', 'pm', 'pack', '--ignore-scripts', '--quiet', '--destination', destination],
    stage,
  )
  const file = basename(output.split('\n').at(-1)!.trim())
  if (!existsSync(join(destination, file))) {
    throw new Error(`bun pm pack reported ${file} but it is absent from ${destination}`)
  }
  return file
}

/** Default-variant build records staged by `build-native.ts`. */
export function productBuilds(vendorRoot: string): NativeBuildRecord[] {
  const nativeRoot = join(vendorRoot, VENDOR_VERSION, 'native')
  if (!existsSync(nativeRoot)) return []
  return readdirSync(nativeRoot)
    .filter((directory) => directory.endsWith('-default'))
    .map((directory) => join(nativeRoot, directory, 'build.json'))
    .filter((path) => existsSync(path))
    .map((path) => JSON.parse(readFileSync(path, 'utf8')) as NativeBuildRecord)
}

export function packVendor(forkPath: string, vendorRoot: string): VendorManifest {
  const provenance = JSON.parse(readFileSync(join(forkPath, 'PROVENANCE.json'), 'utf8')) as {
    fork: { remote: string; baseCommit: string; headCommit: string; branch: string }
  }
  const builds = productBuilds(vendorRoot)
  if (builds.length === 0) {
    throw new Error('no native build staged; run tools/gpuix/build-native.ts first')
  }

  const destination = join(vendorRoot, VENDOR_VERSION)
  mkdirSync(destination, { recursive: true })
  const stageRoot = mkdtempSync(join(tmpdir(), 'hemera-vendor-'))
  const packages: PackagedTarball[] = []

  try {
    // The published React package ships dist/, so its compiler has to have run.
    mustRun(['bun', 'run', 'build'], join(forkPath, 'packages', 'react'))

    const reactStage = join(stageRoot, 'react')
    // node_modules holds workspace symlinks that no consumer can resolve.
    cpSync(join(forkPath, 'packages', 'react'), reactStage, {
      recursive: true,
      filter: (source) => !source.includes(`${sep}node_modules`),
    })
    const reactManifest = JSON.parse(readFileSync(join(reactStage, 'package.json'), 'utf8'))
    reactManifest.version = VENDOR_VERSION
    reactManifest.dependencies['@gpuix/native'] = VENDOR_VERSION
    delete reactManifest.scripts.prepublishOnly
    writeJson(join(reactStage, 'package.json'), reactManifest)
    packages.push({
      name: '@gpuix/react',
      file: pack(reactStage, destination),
      sha256: '',
      target: null,
    })

    // One loader for every target; its bindings come from the build that was staged.
    const reference = builds[0]!
    const referenceDirectory = join(
      vendorRoot,
      VENDOR_VERSION,
      'native',
      `${reference.target}-${reference.variant}`,
    )
    const loaderStage = join(stageRoot, 'native')
    mkdirSync(loaderStage, { recursive: true })
    copyFileSync(join(forkPath, 'packages', 'native', 'LICENSE'), join(loaderStage, 'LICENSE'))
    copyFileSync(
      join(forkPath, 'packages', 'native', 'browser.mjs'),
      join(loaderStage, 'browser.mjs'),
    )
    for (const file of ['index.js', 'index.d.ts']) {
      copyFileSync(join(referenceDirectory, file), join(loaderStage, file))
    }
    const loaderManifest = JSON.parse(
      readFileSync(join(forkPath, 'packages', 'native', 'package.json'), 'utf8'),
    )
    loaderManifest.version = VENDOR_VERSION
    delete loaderManifest.scripts
    delete loaderManifest.devDependencies
    loaderManifest.optionalDependencies = Object.fromEntries(
      builds.map((build) => [`@gpuix/native-${platformNameOf(build.addon.file)}`, VENDOR_VERSION]),
    )
    writeJson(join(loaderStage, 'package.json'), loaderManifest)
    packages.push({
      name: '@gpuix/native',
      file: pack(loaderStage, destination),
      sha256: '',
      target: null,
    })

    for (const build of builds) {
      const platform = platformNameOf(build.addon.file)
      const constraints = PLATFORM_CONSTRAINTS[platform]
      if (constraints === undefined) {
        throw new Error(`no os/cpu constraints known for the platform ${platform}`)
      }
      const stage = join(stageRoot, `platform-${platform}`)
      mkdirSync(stage, { recursive: true })
      copyFileSync(
        join(vendorRoot, VENDOR_VERSION, 'native', `${build.target}-default`, build.addon.file),
        join(stage, build.addon.file),
      )
      copyFileSync(join(forkPath, 'packages', 'native', 'LICENSE'), join(stage, 'LICENSE'))
      writeJson(join(stage, 'package.json'), {
        name: `@gpuix/native-${platform}`,
        version: VENDOR_VERSION,
        license: 'Apache-2.0',
        os: [constraints.os],
        cpu: [constraints.cpu],
        ...(constraints.libc === undefined ? {} : { libc: [constraints.libc] }),
        main: build.addon.file,
        files: [build.addon.file, 'LICENSE'],
      })
      packages.push({
        name: `@gpuix/native-${platform}`,
        file: pack(stage, destination),
        sha256: '',
        target: build.target,
      })
    }
  } finally {
    rmSync(stageRoot, { recursive: true, force: true })
  }

  for (const entry of packages) {
    entry.sha256 = sha256Of(join(destination, entry.file))
  }

  const manifest: VendorManifest = {
    version: VENDOR_VERSION,
    fork: {
      remote: provenance.fork.remote,
      baseCommit: provenance.fork.baseCommit,
      headCommit: provenance.fork.headCommit,
      branch: provenance.fork.branch,
    },
    packages,
  }
  writeJson(join(destination, 'manifest.json'), manifest)
  return manifest
}

if (import.meta.main) {
  const repository = resolve(import.meta.dir, '..', '..')
  const manifest = packVendor(
    resolve(repository, '..', 'gpuix'),
    join(repository, 'vendor', 'gpuix'),
  )
  console.log(`vendored ${manifest.version} from ${manifest.fork.headCommit}`)
  for (const entry of manifest.packages) {
    console.log(
      `  ${entry.name}${entry.target === null ? '' : ` (${entry.target})`}: ${entry.file}`,
    )
  }
}
