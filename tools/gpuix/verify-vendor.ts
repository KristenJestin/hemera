#!/usr/bin/env bun
/**
 * Integrity gate run before installing the fork dependency: every vendored tarball must
 * match the fingerprint its manifest records, and the paths that declare them must resolve
 * to those tarballs. A gap fails the install by naming it.
 *
 *   bun tools/gpuix/verify-vendor.ts
 */

import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'

import { VENDOR_VERSION } from './build-native.ts'
import { sameRevision } from './pack-vendor.ts'
import type { VendorManifest } from './pack-vendor.ts'

export interface IntegrityReport {
  ok: boolean
  /** What refuses the install. */
  gaps: string[]
  /** What the vendor cannot answer, without being wrong about it. */
  notes: string[]
}

function sha256Of(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

/** Resolves a `file:` specifier against the manifest that declares it. */
export function resolveFileSpecifier(manifestDirectory: string, specifier: string): string | null {
  if (!specifier.startsWith('file:')) return null
  const target = specifier.slice('file:'.length)
  return isAbsolute(target) ? target : resolve(manifestDirectory, target)
}

function declaredPaths(repositoryRoot: string): { origin: string; path: string }[] {
  const found: { origin: string; path: string }[] = []
  const root = JSON.parse(readFileSync(join(repositoryRoot, 'package.json'), 'utf8')) as {
    overrides?: Record<string, string>
  }
  for (const [name, specifier] of Object.entries(root.overrides ?? {})) {
    const path = resolveFileSpecifier(repositoryRoot, specifier)
    if (path !== null) found.push({ origin: `root override ${name}`, path })
  }
  const desktopDirectory = join(repositoryRoot, 'apps', 'desktop')
  const desktop = JSON.parse(readFileSync(join(desktopDirectory, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>
  }
  for (const [name, specifier] of Object.entries(desktop.dependencies ?? {})) {
    const path = resolveFileSpecifier(desktopDirectory, specifier)
    if (path !== null) found.push({ origin: `desktop dependency ${name}`, path })
  }
  return found
}

export function verifyVendor(repositoryRoot: string): IntegrityReport {
  const gaps: string[] = []
  const notes: string[] = []
  const vendorDirectory = join(repositoryRoot, 'vendor', 'gpuix', VENDOR_VERSION)
  const manifestPath = join(vendorDirectory, 'manifest.json')
  if (!existsSync(manifestPath)) {
    return { ok: false, gaps: [`no vendor manifest at ${manifestPath}`], notes }
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as VendorManifest

  if (manifest.version !== VENDOR_VERSION) {
    gaps.push(`the manifest declares version ${manifest.version}, expected ${VENDOR_VERSION}`)
  }
  if (manifest.fork.headCommit.length === 0) {
    gaps.push('the manifest names no fork revision')
  }

  const known = new Set<string>()
  for (const entry of manifest.packages) {
    const tarball = join(vendorDirectory, entry.file)
    if (!existsSync(tarball)) {
      gaps.push(`${entry.name}: ${entry.file} is missing from ${vendorDirectory}`)
      continue
    }
    known.add(resolve(tarball))
    const digest = sha256Of(tarball)
    if (digest !== entry.sha256) {
      gaps.push(
        `${entry.name}: ${entry.file} has fingerprint ${digest}, manifest records ${entry.sha256}`,
      )
    }
  }

  // Each target is built where it can be built, so the tarballs are packed by different
  // machines at different times. They are only interchangeable while they come from the same
  // base and the same patch queue; a mix is named here rather than shipped quietly.
  const revisions = manifest.packages.flatMap((entry) =>
    entry.revision === undefined ? [] : [{ name: entry.name, revision: entry.revision }],
  )
  const reference = revisions[0]
  if (reference !== undefined) {
    for (const entry of revisions) {
      if (sameRevision(entry.revision, reference.revision)) continue
      gaps.push(
        `${entry.name}: built from queue ${entry.revision.queue.slice(0, 12)} ` +
          `while ${reference.name} comes from ${reference.revision.queue.slice(0, 12)}; ` +
          'rebuild the targets that lag behind before shipping them together',
      )
    }
  }
  for (const entry of manifest.packages) {
    // A tarball packed before the record existed is not wrong, it is unanswered: it says
    // nothing about what it was built from, so nothing can be compared to it either.
    if (entry.revision === undefined) {
      notes.push(
        `${entry.name}: packed before the revision was recorded, so it cannot be compared; ` +
          'repack it on the machine that builds its target',
      )
    }
  }

  for (const addon of manifest.testSupport ?? []) {
    const path = join(vendorDirectory, 'test-support', addon.file)
    // The test renderer is a development artefact, built locally rather than committed: it
    // is checked when present and never required to install the product.
    if (!existsSync(path)) continue
    const digest = sha256Of(path)
    if (digest !== addon.sha256) {
      gaps.push(
        `test-support addon ${addon.file} has fingerprint ${digest}, ` +
          `manifest records ${addon.sha256}`,
      )
    }
  }

  for (const declared of declaredPaths(repositoryRoot)) {
    if (!existsSync(declared.path)) {
      gaps.push(`${declared.origin} points at ${declared.path}, which does not exist`)
      continue
    }
    if (!known.has(resolve(declared.path))) {
      gaps.push(
        `${declared.origin} points at ${relative(repositoryRoot, declared.path)}, ` +
          'which the vendor manifest does not list',
      )
    }
  }

  return { ok: gaps.length === 0, gaps, notes }
}

if (import.meta.main) {
  const repositoryRoot = resolve(import.meta.dir, '..', '..')
  const report = verifyVendor(repositoryRoot)
  for (const note of report.notes) console.error(`vendor: ${note}`)
  for (const gap of report.gaps) console.error(`vendor integrity: ${gap}`)
  if (!report.ok) {
    console.error('refusing to install the fork dependency until these gaps are resolved')
    process.exit(1)
  }
  console.log(`vendor integrity verified for ${VENDOR_VERSION}`)
}
