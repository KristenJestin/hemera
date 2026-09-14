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

/**
 * The revision a tarball was built from, in a form two machines can compare.
 *
 * The fork is reconstructed on each machine, and `git am` stamps a committer date, so the
 * same tree gets a different commit on every checkout. A commit therefore identifies a run,
 * never a revision. What identifies a revision is the base it applies onto and the queue of
 * patches applied to it, both of which are recorded by fingerprint.
 */
export interface Revision {
  /** Commit of the upstream renderer the queue applies onto. */
  baseCommit: string
  /** Commit of the GPUI base the submodule queue applies onto. */
  gpuiBaseCommit: string
  /** Digest of the applied patch queue; the same patches give the same digest. */
  queue: string
}

export interface PackagedTarball {
  /** Package name as installed. */
  name: string
  /** Tarball file name inside the vendor directory. */
  file: string
  sha256: string
  /** Target triple for a platform package, null for a portable one. */
  target: string | null
  /**
   * What this tarball was built from; a vendor holding two of them is a mixed one.
   *
   * Absent on a tarball packed before the record existed. Such an entry is carried over as it
   * is and reported as unanswered: dropping it would uninstall a target nobody rebuilt.
   */
  revision?: Revision
}

export interface TestSupportAddon {
  /** Addon file name inside the vendor `test-support/` directory. */
  file: string
  sha256: string
  target: string
}

export interface VendorManifest {
  version: string
  /**
   * The fork the most recent run packed from.
   *
   * `headCommit` identifies that run, not the revision: a reconstruction of the same tree on
   * another machine gives another commit. Compare `packages[].revision` instead.
   */
  fork: { remote: string; baseCommit: string; headCommit: string; branch: string }
  packages: PackagedTarball[]
  /**
   * Addons carrying the GPUI test renderer. They are never installed: the component test
   * harness points the napi loader at one of them, so the shipped build keeps the test
   * support out (fork patch 0007).
   */
  testSupport: TestSupportAddon[]
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

function stagedBuilds(vendorRoot: string, variant: string): NativeBuildRecord[] {
  const nativeRoot = join(vendorRoot, VENDOR_VERSION, 'native')
  if (!existsSync(nativeRoot)) return []
  return readdirSync(nativeRoot)
    .filter((directory) => directory.endsWith(`-${variant}`))
    .map((directory) => join(nativeRoot, directory, 'build.json'))
    .filter((path) => existsSync(path))
    .map((path) => JSON.parse(readFileSync(path, 'utf8')) as NativeBuildRecord)
}

/** Default-variant build records staged by `build-native.ts`. */
export function productBuilds(vendorRoot: string): NativeBuildRecord[] {
  return stagedBuilds(vendorRoot, 'default')
}

interface Provenance {
  fork: { remote: string; baseCommit: string; headCommit: string; branch: string }
  gpui: { baseCommit: string }
  patches: Record<string, { file: string; sha256: string; applied: boolean }[]>
}

/** The revision a reconstruction produced, as two machines can compare it. */
export function revisionOf(provenance: Provenance): Revision {
  const applied = Object.entries(provenance.patches)
    .toSorted(([left], [right]) => left.localeCompare(right))
    .flatMap(([queue, patches]) =>
      patches.filter((patch) => patch.applied).map((patch) => `${queue}:${patch.sha256}`),
    )
  return {
    baseCommit: provenance.fork.baseCommit,
    gpuiBaseCommit: provenance.gpui.baseCommit,
    queue: createHash('sha256').update(applied.join('\n')).digest('hex'),
  }
}

/** Whether two tarballs were built from the same base and the same queue. */
export function sameRevision(left: Revision, right: Revision): boolean {
  return (
    left.baseCommit === right.baseCommit &&
    left.gpuiBaseCommit === right.gpuiBaseCommit &&
    left.queue === right.queue
  )
}

/**
 * Entries of a previous run this one must not drop.
 *
 * Each target is built on the machine that can build it, and the staging directory is not
 * versioned: a run only ever sees its own. What the vendor already carries is therefore read
 * from the manifest beside the tarballs, and kept whenever its tarball is still there.
 */
export function carriedOver(destination: string, packed: PackagedTarball[]): PackagedTarball[] {
  const manifestPath = join(destination, 'manifest.json')
  if (!existsSync(manifestPath)) return []
  const previous = JSON.parse(readFileSync(manifestPath, 'utf8')) as VendorManifest
  const replaced = new Set(packed.map((entry) => entry.name))
  return (previous.packages ?? []).filter(
    (entry) => !replaced.has(entry.name) && existsSync(join(destination, entry.file)),
  )
}

/** Directory holding the addons that carry the GPUI test renderer. */
export function testSupportDirectory(vendorRoot: string): string {
  return join(vendorRoot, VENDOR_VERSION, 'test-support')
}

export function packVendor(forkPath: string, vendorRoot: string): VendorManifest {
  const provenance = JSON.parse(
    readFileSync(join(forkPath, 'PROVENANCE.json'), 'utf8'),
  ) as Provenance
  const revision = revisionOf(provenance)
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
      revision,
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
    // Dropping a target another machine packed would uninstall it on the next install.
    const platforms = new Set(
      builds.map((build) => `@gpuix/native-${platformNameOf(build.addon.file)}`),
    )
    for (const entry of carriedOver(destination, [])) {
      if (entry.target !== null) platforms.add(entry.name)
    }
    loaderManifest.optionalDependencies = Object.fromEntries(
      [...platforms].toSorted().map((name) => [name, VENDOR_VERSION]),
    )
    writeJson(join(loaderStage, 'package.json'), loaderManifest)
    packages.push({
      name: '@gpuix/native',
      file: pack(loaderStage, destination),
      sha256: '',
      target: null,
      revision,
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
        revision,
      })
    }
  } finally {
    rmSync(stageRoot, { recursive: true, force: true })
  }

  for (const entry of packages) {
    entry.sha256 = sha256Of(join(destination, entry.file))
  }

  const testSupportRoot = testSupportDirectory(vendorRoot)
  const testSupport: TestSupportAddon[] = []
  for (const build of stagedBuilds(vendorRoot, 'test-support')) {
    mkdirSync(testSupportRoot, { recursive: true })
    const source = join(
      vendorRoot,
      VENDOR_VERSION,
      'native',
      `${build.target}-test-support`,
      build.addon.file,
    )
    const copy = join(testSupportRoot, build.addon.file)
    copyFileSync(source, copy)
    testSupport.push({ file: build.addon.file, sha256: sha256Of(copy), target: build.target })
  }

  const kept = carriedOver(destination, packages)
  const manifest: VendorManifest = {
    version: VENDOR_VERSION,
    fork: {
      remote: provenance.fork.remote,
      baseCommit: provenance.fork.baseCommit,
      headCommit: provenance.fork.headCommit,
      branch: provenance.fork.branch,
    },
    packages: [...packages, ...kept].toSorted((left, right) => left.name.localeCompare(right.name)),
    testSupport,
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
  // The lockfile pins the tarball by its path, and the install cache keys on that path: a
  // freshly packed archive at the same path is served from the cache as the old one.
  console.log('\nthe lockfile still points at the archives installed before this run:')
  console.log('  rm bun.lock && bun install')
}
