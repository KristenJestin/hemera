import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

// The leaf modules, not the barrel: the barrel re-exports the components, which load the
// renderer and its native addon on a machine that may have none.
import { control, row, shell } from '#tokens/components.ts'
import { fontSize, lineHeight, radius, space } from '#tokens/primitives.ts'
import { COLOR_ROLES } from '#tokens/semantic.ts'
import type { Theme } from '#tokens/semantic.ts'
import { dark } from '#theme/dark.ts'
import { light } from '#theme/light.ts'

const repository = resolve(import.meta.dir, '..', '..', '..')
const ui = resolve(import.meta.dir, '..')

describe('Tokens en trois couches', () => {
  test('the three layers are separate files', () => {
    for (const layer of ['primitives.ts', 'semantic.ts', 'components.ts']) {
      expect(readFileSync(join(ui, 'src', 'tokens', layer), 'utf8').length).toBeGreaterThan(0)
    }
  })

  test('the raw palette is not part of the public surface', () => {
    const surface = readFileSync(join(ui, 'src', 'index.ts'), 'utf8')
    expect(surface).not.toContain('palette')
  })

  test('the scales are closed and match the documented steps', () => {
    expect(Object.values(space)).toEqual([0, 2, 4, 6, 8, 12, 16, 24, 32, 40])
    expect(Object.values(radius)).toEqual([4, 6, 8, 12, 16, 999])
    expect(Object.values(fontSize)).toEqual([11, 12, 13, 14, 16, 20, 26])
  })
})

describe('Clé sémantique manquante dans un thème', () => {
  test('both themes expose exactly the same colour roles', () => {
    expect(Object.keys(light.colors).toSorted()).toEqual([...COLOR_ROLES].toSorted())
    expect(Object.keys(dark.colors).toSorted()).toEqual([...COLOR_ROLES].toSorted())
  })

  test('both themes expose the same elevation roles', () => {
    expect(Object.keys(light.shadows).toSorted()).toEqual(['lg', 'md', 'sm'])
    expect(Object.keys(dark.shadows).toSorted()).toEqual(['lg', 'md', 'sm'])
  })

  test('a theme missing a role fails the typecheck before anything runs', () => {
    const directory = mkdtempSync(join(tmpdir(), 'hemera-theme-'))
    try {
      const file = join(directory, 'incomplete.ts')
      writeFileSync(
        file,
        [
          `import type { Theme } from '${join(ui, 'src', 'index.ts').replaceAll('\\', '/')}'`,
          `import { dark } from '${join(ui, 'src', 'index.ts').replaceAll('\\', '/')}'`,
          '',
          'const { bg, ...withoutBg } = dark.colors',
          'export const incomplete: Theme = { ...dark, colors: withoutBg }',
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
      expect(output).toContain("Property 'bg' is missing")
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})

describe('Ombre multi-couche refusée', () => {
  test('an elevation token declares a single painted layer', () => {
    for (const theme of [light, dark] as Theme[]) {
      for (const shadow of Object.values(theme.shadows)) {
        expect(Object.keys(shadow).toSorted()).toEqual([
          'blurRadius',
          'color',
          'offsetX',
          'offsetY',
          'spreadRadius',
        ])
      }
    }
  })
})

describe('Densité et échelle', () => {
  test('the base text size is 14 and the control heights are 28, 32 and 40', () => {
    expect(fontSize.base).toBe(14)
    expect(control.height).toEqual({ sm: 28, md: 32, lg: 40 })
  })

  test('a list row and a navigation entry share the standard control height', () => {
    expect(row.height).toBe(control.height.md)
  })

  test('the shell geometry comes from tokens, never from a density', () => {
    expect(shell.topbar.height).toBe(44)
    expect(shell.sidebar).toEqual({
      width: 248,
      minWidth: 180,
      maxWidth: 420,
      collapsedWidth: 0,
    })
    expect(shell.gutter).toEqual({ size: 6, rule: 1 })
  })
})

describe('Taille de texte hors échelle', () => {
  test('every line height is a length in pixels, never a ratio', () => {
    // A ratio is read by the renderer as a height of a couple of pixels: wrapped lines land
    // on top of each other and a field paints its text above its own box.
    for (const [scale, height] of Object.entries(lineHeight)) {
      const size = fontSize[scale as keyof typeof fontSize]
      expect(Number.isInteger(height)).toBe(true)
      expect(height).toBeGreaterThan(size)
      expect(height).toBeLessThanOrEqual(size * 2)
    }
  })

  test('the line height scale covers exactly the text scale', () => {
    expect(Object.keys(lineHeight)).toEqual(Object.keys(fontSize))
  })
})
