import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

// The leaf modules, not the barrel: the barrel re-exports the components, which load the
// renderer and its native addon on a machine that may have none.
import { ICONS } from '#icons/catalog.ts'
import type { IconName } from '#icons/catalog.ts'
import { iconSize } from '#tokens/primitives.ts'

const repository = resolve(import.meta.dir, '..', '..', '..')
const catalogue = join(repository, 'packages', 'ui', 'src', 'icons', 'catalog.ts')

describe("Icônes vectorielles issues d'un catalogue unique", () => {
  test('every icon is SVG markup declared in code', () => {
    const names = Object.keys(ICONS) as IconName[]
    expect(names.length).toBeGreaterThan(0)
    for (const name of names) {
      expect(ICONS[name].startsWith('<svg')).toBe(true)
      expect(ICONS[name].endsWith('</svg>')).toBe(true)
    }
  })

  test('nothing is read from a file or fetched at run time', () => {
    // The doc comment names the generator; only the code is under this rule.
    const code = readFileSync(catalogue, 'utf8').replaceAll(/\/\*[\s\S]*?\*\//g, '')
    expect(code).not.toMatch(/^\s*import\s/m)
    expect(code).not.toMatch(/require\(|readFileSync|fetch\(|XMLHttpRequest/)
    expect(code).not.toContain('lucide-static')
  })

  test('the icon package never enters the bundle', async () => {
    const build = await Bun.build({
      entrypoints: [join(repository, 'packages', 'ui', 'src', 'index.ts')],
      target: 'bun',
    })
    expect(build.success).toBe(true)
    const code = (await Promise.all(build.outputs.map((output) => output.text()))).join('\n')
    expect(code).not.toContain('lucide-static')
    expect(code).not.toContain('node_modules/lucide')
    // The markup itself is inlined, so the catalogue is present without its source package.
    expect(code).toContain('<svg')
  })

  test('an icon carries no colour of its own', () => {
    for (const markup of Object.values(ICONS)) {
      // GPUI recolours the monochrome sprite from the element's `color`; the stroke written
      // here is the placeholder the renderer replaces.
      expect(markup.match(/#[0-9a-f]{3,6}/gi)?.every((colour) => colour === '#000')).toBe(true)
      expect(markup).not.toContain('currentColor')
    }
  })

  test('icon sizes belong to the closed scale', () => {
    expect(Object.values(iconSize)).toEqual([14, 16, 18, 20])
  })
})

describe('Icône absente du catalogue', () => {
  test('asking for an icon the catalogue does not declare fails the typecheck by name', () => {
    const directory = mkdtempSync(join(tmpdir(), 'hemera-icons-'))
    try {
      const surface = join(repository, 'packages', 'ui', 'src', 'index.ts').replaceAll('\\', '/')
      const file = join(directory, 'unknown-icon.ts')
      writeFileSync(
        file,
        [
          `import { ICONS } from '${surface}'`,
          `import type { IconName } from '${surface}'`,
          '',
          "const missing: IconName = 'rocket-ship'",
          'export const markup = ICONS[missing]',
          '',
        ].join('\n'),
      )
      const result = Bun.spawnSync(
        [
          join(repository, 'node_modules', '.bin', 'tsc'),
          '--noEmit',
          '--strict',
          '--target',
          'esnext',
          '--module',
          'preserve',
          '--moduleResolution',
          'bundler',
          '--allowImportingTsExtensions',
          '--skipLibCheck',
          file,
        ],
        { cwd: repository, stdout: 'pipe', stderr: 'pipe' },
      )
      const output = new TextDecoder().decode(result.stdout)
      expect(result.exitCode).not.toBe(0)
      expect(output).toContain('rocket-ship')
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
