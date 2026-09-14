import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'

import { absent, testSupportBuilt } from './available.ts'
import { VENDOR_VERSION } from './build-native.ts'
import { FORK_BASE_COMMIT } from './rebuild-fork.ts'
import { carriedOver, platformNameOf, revisionOf, sameRevision } from './pack-vendor.ts'
import type { Revision, VendorManifest } from './pack-vendor.ts'
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
    const report = verifyVendor(repository)
    expect(report.gaps).toEqual([])
    expect(report.ok).toBe(true)
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
      const report = verifyVendor(root)
      expect(report.gaps).toEqual([])
      expect(report.ok).toBe(true)
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

/** A vendor holding two platform tarballs, each with the revision it was built from. */
function multiTargetFixture(revisions: { windows: Revision; linux: Revision }): string {
  const root = mkdtempSync(join(tmpdir(), 'hemera-vendor-mixed-'))
  const directory = join(root, 'vendor', 'gpuix', VENDOR_VERSION)
  mkdirSync(directory, { recursive: true })
  mkdirSync(join(root, 'apps', 'desktop'), { recursive: true })
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'fixture' }))
  writeFileSync(join(root, 'apps', 'desktop', 'package.json'), JSON.stringify({}))

  const packages = (
    [
      ['@gpuix/native-win32-x64-msvc', 'x86_64-pc-windows-msvc', revisions.windows],
      ['@gpuix/native-linux-x64-gnu', 'x86_64-unknown-linux-gnu', revisions.linux],
    ] as const
  ).map(([name, target, revision]) => {
    const file = `${name.replace('@gpuix/', 'gpuix-')}-${VENDOR_VERSION}.tgz`
    writeFileSync(join(directory, file), name)
    return {
      name,
      file,
      sha256: createHash('sha256').update(name).digest('hex'),
      target,
      revision,
    }
  })

  writeFileSync(
    join(directory, 'manifest.json'),
    JSON.stringify(
      {
        version: VENDOR_VERSION,
        fork: { remote: 'r', baseCommit: 'b', headCommit: 'h', branch: 'x' },
        packages,
        testSupport: [],
      },
      null,
      2,
    ),
  )
  return root
}

const A: Revision = { baseCommit: 'base', gpuiBaseCommit: 'gpui', queue: 'a'.repeat(64) }
const B: Revision = { baseCommit: 'base', gpuiBaseCommit: 'gpui', queue: 'b'.repeat(64) }

describe('Révision comparable entre machines', () => {
  test('the same applied queue gives the same revision, whatever the commit it produced', () => {
    const queue = {
      gpuix: [{ file: '0001.patch', sha256: 'aa', applied: true }],
      hemera: [{ file: '0001.patch', sha256: 'bb', applied: true }],
      gpui: [{ file: '0001.patch', sha256: 'cc', applied: true }],
    }
    const windows = revisionOf({
      fork: { remote: 'r', baseCommit: 'base', headCommit: 'commit-on-windows', branch: 'x' },
      gpui: { baseCommit: 'gpui' },
      patches: queue,
    })
    const linux = revisionOf({
      fork: { remote: 'r', baseCommit: 'base', headCommit: 'commit-on-linux', branch: 'x' },
      gpui: { baseCommit: 'gpui' },
      patches: queue,
    })

    // The commits differ by construction; the revision does not.
    expect(windows).toEqual(linux)
    expect(sameRevision(windows, linux)).toBe(true)
  })

  test('a patch added to the queue changes the revision', () => {
    const before = revisionOf({
      fork: { remote: 'r', baseCommit: 'base', headCommit: 'h', branch: 'x' },
      gpui: { baseCommit: 'gpui' },
      patches: { hemera: [{ file: '0001.patch', sha256: 'bb', applied: true }] },
    })
    const after = revisionOf({
      fork: { remote: 'r', baseCommit: 'base', headCommit: 'h', branch: 'x' },
      gpui: { baseCommit: 'gpui' },
      patches: {
        hemera: [
          { file: '0001.patch', sha256: 'bb', applied: true },
          { file: '0002.patch', sha256: 'dd', applied: true },
        ],
      },
    })
    expect(sameRevision(before, after)).toBe(false)
  })

  test('a patch of the queue that is not applied does not count', () => {
    const applied = revisionOf({
      fork: { remote: 'r', baseCommit: 'base', headCommit: 'h', branch: 'x' },
      gpui: { baseCommit: 'gpui' },
      patches: { gpuix: [{ file: '0001.patch', sha256: 'aa', applied: true }] },
    })
    const withReference = revisionOf({
      fork: { remote: 'r', baseCommit: 'base', headCommit: 'h', branch: 'x' },
      gpui: { baseCommit: 'gpui' },
      patches: {
        gpuix: [
          { file: '0001.patch', sha256: 'aa', applied: true },
          { file: '0026.patch', sha256: 'zz', applied: false },
        ],
      },
    })
    expect(sameRevision(applied, withReference)).toBe(true)
  })
})

describe('Vendor mixte entre deux cibles', () => {
  test('two targets from the same queue install together', () => {
    const root = multiTargetFixture({ windows: A, linux: A })
    try {
      expect(verifyVendor(root).gaps).toEqual([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('two targets from different queues are refused, naming both', () => {
    const root = multiTargetFixture({ windows: A, linux: B })
    try {
      const report = verifyVendor(root)
      expect(report.ok).toBe(false)
      expect(report.gaps.join(' ')).toContain('@gpuix/native-linux-x64-gnu')
      expect(report.gaps.join(' ')).toContain('rebuild the targets that lag behind')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('a tarball packed before the record is a note, not a refusal', () => {
    const report = verifyVendor(repository)
    expect(report.ok).toBe(true)
  })
})

describe('Cible packée ailleurs conservée', () => {
  test('a run keeps the entries whose tarball is still there', () => {
    const root = multiTargetFixture({ windows: A, linux: A })
    const directory = join(root, 'vendor', 'gpuix', VENDOR_VERSION)
    try {
      // This run repacks Linux only; Windows was packed on the machine that can build it.
      const packed = [
        {
          name: '@gpuix/native-linux-x64-gnu',
          file: 'gpuix-native-linux-x64-gnu-rebuilt.tgz',
          sha256: 'x',
          target: 'x86_64-unknown-linux-gnu',
          revision: B,
        },
      ]
      const kept = carriedOver(directory, packed)
      expect(kept.map((entry) => entry.name)).toEqual(['@gpuix/native-win32-x64-msvc'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('an entry whose tarball disappeared is not carried over', () => {
    const root = multiTargetFixture({ windows: A, linux: A })
    const directory = join(root, 'vendor', 'gpuix', VENDOR_VERSION)
    try {
      rmSync(join(directory, `gpuix-native-win32-x64-msvc-${VENDOR_VERSION}.tgz`))
      expect(carriedOver(directory, []).map((entry) => entry.name)).toEqual([
        '@gpuix/native-linux-x64-gnu',
      ])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe("Cible d'avant l'enregistrement conservée", () => {
  test('an entry packed before the revision existed survives a run that repacks another', () => {
    const root = multiTargetFixture({ windows: A, linux: A })
    const directory = join(root, 'vendor', 'gpuix', VENDOR_VERSION)
    try {
      // The vendor as it was committed: tarballs, no revision recorded for any of them.
      const previous = JSON.parse(
        readFileSync(join(directory, 'manifest.json'), 'utf8'),
      ) as VendorManifest
      writeFileSync(
        join(directory, 'manifest.json'),
        JSON.stringify(
          {
            ...previous,
            packages: previous.packages.map(({ revision: _dropped, ...entry }) => entry),
          },
          null,
          2,
        ),
      )

      // Linux is repacked here; Windows was packed on the machine that builds it, before the
      // record existed. Dropping it would uninstall a target nobody can rebuild from here.
      const kept = carriedOver(directory, [
        {
          name: '@gpuix/native-linux-x64-gnu',
          file: 'gpuix-native-linux-x64-gnu-rebuilt.tgz',
          sha256: 'x',
          target: 'x86_64-unknown-linux-gnu',
          revision: B,
        },
      ])

      expect(kept.map((entry) => entry.name)).toEqual(['@gpuix/native-win32-x64-msvc'])
      expect(kept[0]?.revision).toBeUndefined()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('the vendor that keeps it installs, and says what it cannot answer', () => {
    const root = multiTargetFixture({ windows: A, linux: A })
    const directory = join(root, 'vendor', 'gpuix', VENDOR_VERSION)
    try {
      const previous = JSON.parse(
        readFileSync(join(directory, 'manifest.json'), 'utf8'),
      ) as VendorManifest
      writeFileSync(
        join(directory, 'manifest.json'),
        JSON.stringify(
          {
            ...previous,
            packages: [
              previous.packages[0]!,
              (({ revision: _dropped, ...entry }) => entry)(previous.packages[1]!),
            ],
          },
          null,
          2,
        ),
      )

      const report = verifyVendor(root)
      expect(report.gaps).toEqual([])
      expect(report.ok).toBe(true)
      expect(report.notes.join(' ')).toContain('packed before the revision was recorded')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
