import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'

import { absent, testSupportBuilt } from './available.ts'
import { VENDOR_VERSION } from './build-native.ts'
import { FORK_BASE_COMMIT } from './rebuild-fork.ts'
import { platformNameOf } from './pack-vendor.ts'
import type { VendorManifest } from './pack-vendor.ts'
import { resolveFileSpecifier, verifyVendor } from './verify-vendor.ts'

const repository = resolve(import.meta.dir, '..', '..')
const vendorDirectory = join(repository, 'vendor', 'gpuix', VENDOR_VERSION)

function manifest(): VendorManifest {
  return JSON.parse(readFileSync(join(vendorDirectory, 'manifest.json'), 'utf8'))
}

/** A repository shaped like the monorepo, holding one vendored tarball. */
function vendorFixture(tarballBytes: string): { root: string; manifest: VendorManifest } {
  const root = mkdtempSync(join(tmpdir(), 'hemera-vendor-fixture-'))
  const directory = join(root, 'vendor', 'gpuix', VENDOR_VERSION)
  mkdirSync(directory, { recursive: true })
  mkdirSync(join(root, 'apps', 'desktop'), { recursive: true })

  const file = `gpuix-react-${VENDOR_VERSION}.tgz`
  writeFileSync(join(directory, file), tarballBytes)
  const written: VendorManifest = {
    version: VENDOR_VERSION,
    fork: { remote: 'r', baseCommit: 'b', headCommit: 'h', branch: 'x' },
    packages: [
      {
        name: '@gpuix/react',
        file,
        sha256: createHash('sha256').update('the expected bytes').digest('hex'),
        target: null,
      },
    ],
  }
  writeFileSync(join(directory, 'manifest.json'), JSON.stringify(written, null, 2))
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'fixture' }))
  writeFileSync(
    join(root, 'apps', 'desktop', 'package.json'),
    JSON.stringify({
      dependencies: { '@gpuix/react': `file:../../vendor/gpuix/${VENDOR_VERSION}/${file}` },
    }),
  )
  return { root, manifest: written }
}

describe('Installation propre', () => {
  test('the vendored packages are the react package, the loader and one platform package', () => {
    const names = manifest().packages.map((entry) => entry.name)
    expect(names).toContain('@gpuix/react')
    expect(names).toContain('@gpuix/native')
    expect(names.some((name) => name.startsWith('@gpuix/native-'))).toBe(true)
  })

  test('the manifest names the fork revision the tarballs were produced from', () => {
    const fork = manifest().fork
    expect(fork.headCommit).toMatch(/^[0-9a-f]{40}$/)
    expect(fork.baseCommit).toBe(FORK_BASE_COMMIT)
    expect(fork.branch).toBe(`hemera/${VENDOR_VERSION}`)
  })

  test('every tarball matches the fingerprint the manifest records', () => {
    expect(verifyVendor(repository)).toEqual({ ok: true, gaps: [] })
  })

  test('the desktop dependency and the root overrides resolve to the vendored tarballs', () => {
    const desktop = JSON.parse(
      readFileSync(join(repository, 'apps', 'desktop', 'package.json'), 'utf8'),
    ) as { dependencies: Record<string, string> }
    const declared = desktop.dependencies['@gpuix/react']!
    expect(declared.startsWith('file:../../vendor/')).toBe(true)
    expect(isAbsolute(declared.slice('file:'.length))).toBe(false)
    expect(existsSync(resolveFileSpecifier(join(repository, 'apps', 'desktop'), declared)!)).toBe(
      true,
    )

    const root = JSON.parse(readFileSync(join(repository, 'package.json'), 'utf8')) as {
      overrides: Record<string, string>
    }
    for (const [name, specifier] of Object.entries(root.overrides)) {
      expect(name.startsWith('@gpuix/native')).toBe(true)
      expect(specifier.startsWith('file:./vendor/')).toBe(true)
      expect(existsSync(resolveFileSpecifier(repository, specifier)!)).toBe(true)
    }
  })

  test('the integrity gate runs before the install', () => {
    const root = JSON.parse(readFileSync(join(repository, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>
    }
    expect(root.scripts.preinstall).toBe('bun tools/gpuix/verify-vendor.ts')
  })
})

describe('Empreinte non conforme', () => {
  test('a tampered tarball fails the install by naming the gap', () => {
    const { root } = vendorFixture('tampered bytes')
    try {
      const report = verifyVendor(root)
      expect(report.ok).toBe(false)
      expect(report.gaps).toHaveLength(1)
      expect(report.gaps[0]).toContain('@gpuix/react')
      expect(report.gaps[0]).toContain('has fingerprint')
      expect(report.gaps[0]).toContain('manifest records')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('a matching tarball passes the gate', () => {
    const { root } = vendorFixture('the expected bytes')
    try {
      expect(verifyVendor(root)).toEqual({ ok: true, gaps: [] })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('a declared path outside the manifest is refused', () => {
    const { root } = vendorFixture('the expected bytes')
    try {
      const desktop = join(root, 'apps', 'desktop', 'package.json')
      const stray = join(root, 'vendor', 'gpuix', VENDOR_VERSION, 'stray.tgz')
      writeFileSync(stray, 'stray')
      writeFileSync(
        desktop,
        JSON.stringify({
          dependencies: { '@gpuix/react': `file:../../vendor/gpuix/${VENDOR_VERSION}/stray.tgz` },
        }),
      )
      const report = verifyVendor(root)
      expect(report.ok).toBe(false)
      expect(report.gaps.join('\n')).toContain('the vendor manifest does not list')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

/** The test renderer is a build artefact too, and gitignored for the same reason. */
const hasTestSupport = testSupportBuilt()
if (!hasTestSupport) {
  absent('the test-support addon', 'bun tools/gpuix/build-native.ts --test-support')
}

describe('Test renderer vendu à part', () => {
  test.skipIf(!hasTestSupport)('a test-support addon is vendored for the host target', () => {
    const addons = manifest().testSupport
    expect(addons.length).toBeGreaterThan(0)
    for (const addon of addons) {
      expect(addon.file).toContain('.node')
      expect(addon.sha256).toMatch(/^[0-9a-f]{64}$/)
      expect(existsSync(join(vendorDirectory, 'test-support', addon.file))).toBe(true)
    }
  })

  test('the test renderer is never an installed package', () => {
    const names = manifest().packages.map((entry) => entry.name)
    expect(names.some((name) => name.includes('test-support'))).toBe(false)
  })
})

describe('Paquet incompatible', () => {
  test('each platform package names the target it was built for', () => {
    const platformPackages = manifest().packages.filter((entry) => entry.target !== null)
    expect(platformPackages.length).toBeGreaterThan(0)
    for (const entry of platformPackages) {
      const platform = entry.name.replace('@gpuix/native-', '')
      expect(platformNameOf(`gpuix-native.${platform}.node`)).toBe(platform)
      expect(entry.target).toMatch(/^(x86_64|aarch64)-/)
    }
  })

  test('the portable packages carry no target', () => {
    const portable = manifest().packages.filter((entry) => entry.target === null)
    expect(portable.map((entry) => entry.name).toSorted()).toEqual([
      '@gpuix/native',
      '@gpuix/react',
    ])
  })
})

describe('Aucune dépendance aux spikes', () => {
  test('nothing the product installs points at the spikes or the fork checkout', () => {
    const declarations = [
      readFileSync(join(repository, 'package.json'), 'utf8'),
      readFileSync(join(repository, 'apps', 'desktop', 'package.json'), 'utf8'),
      readFileSync(join(repository, 'bun.lock'), 'utf8'),
    ].join('\n')
    expect(declarations).not.toContain('spikes')
    expect(declarations).not.toContain('sources/gpuix')
    expect(declarations).not.toContain('../gpuix/packages')
  })
})
