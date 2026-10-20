import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, test } from 'vite-plus/test'

const repository = resolve(import.meta.dirname, '..')
const read = (path: string): string => readFileSync(join(repository, path), 'utf8')

/** The sha256 of the LICENSE as `dev` holds it: gnu.org's `agpl-3.0.txt`, its indentation stripped. */
const AGPL_SHA256 = 'd8a6cc31abc16b6748c7a21f21611f5a1ec33f67d22ca23d7da1c19b95496bee'

/** The workspace's own manifests: `apps/*` and `packages/*` of pnpm-workspace.yaml. */
const workspaceManifests = ['apps', 'packages'].flatMap((folder) =>
  readdirSync(join(repository, folder), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `${folder}/${entry.name}/package.json`),
)

/** The `license` field of a manifest, or undefined when it has none. */
function licenceOf(manifest: string): string | undefined {
  // SAFETY: a package.json of this repository, read for one string field.
  return (JSON.parse(read(manifest)) as { license?: string }).license
}

describe('Hemera is published under the AGPL-3.0-only', () => {
  test('the LICENSE at the root is the text of the GNU AGPL v3 that dev holds', () => {
    const text = readFileSync(join(repository, 'LICENSE'))
    expect(text.toString('utf8').split('\n').slice(0, 2)).toEqual([
      'GNU AFFERO GENERAL PUBLIC LICENSE',
      'Version 3, 19 November 2007',
    ])
    expect(createHash('sha256').update(text).digest('hex')).toBe(AGPL_SHA256)
  })

  test('the workspace has a manifest per application and per package', () => {
    expect(workspaceManifests.toSorted()).toEqual([
      'apps/desktop/package.json',
      'packages/core/package.json',
      'packages/ipc/package.json',
      'packages/ui/package.json',
    ])
  })

  test.each(workspaceManifests)('%s says AGPL-3.0-only', (manifest) => {
    expect(licenceOf(manifest)).toBe('AGPL-3.0-only')
  })

  test('the root manifest, which is private, says nothing else when it says anything', () => {
    expect([undefined, 'AGPL-3.0-only']).toContain(licenceOf('package.json'))
  })

  test('the README names the licence', () => {
    expect(read('README.md')).toMatch(/^## Licen[cs]e$/m)
    expect(read('README.md')).toContain('[AGPL-3.0](LICENSE)')
  })
})

describe('The vendored lint rules keep their own licence', () => {
  test.each(['anti-slop', 'anti-slop-effect'])('%s stays MIT, with its own file', (folder) => {
    const text = read(`tools/oxlint/${folder}/LICENSE`)
    expect(text).toMatch(/^MIT License$/m)
    expect(text).not.toContain('AFFERO')
  })
})
