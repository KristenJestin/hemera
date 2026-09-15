import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { allowedDimensions, analyzeTokens, withoutComments } from './design-tokens.ts'
import { dark, light } from '../packages/ui/src/index.ts'

const repository = resolve(import.meta.dir, '..')

function scanned(relativePath: string, content: string): string {
  const root = mkdtempSync(join(tmpdir(), 'hemera-tokens-'))
  const full = join(root, relativePath)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, content)
  return root
}

describe('Couleur en dur détectée', () => {
  test('the monorepo holds no raw visual value', () => {
    expect(analyzeTokens(repository)).toEqual([])
  })

  test('a hexadecimal colour in a component is reported with file, line and expected token', () => {
    const root = scanned(
      'packages/ui/src/components/card/card.tsx',
      ['export const Card = () => (', "  <div style={{ backgroundColor: '#18181e' }} />", ')'].join(
        '\n',
      ),
    )
    try {
      const violations = analyzeTokens(root)
      expect(violations).toHaveLength(1)
      expect(violations[0]!.file).toBe('packages/ui/src/components/card/card.tsx')
      expect(violations[0]!.line).toBe(2)
      expect(violations[0]!.value).toBe('#18181e')
      expect(violations[0]!.problem).toContain('theme.colors')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('an rgba colour in a screen is reported', () => {
    const root = scanned(
      'apps/desktop/src/ui/page.tsx',
      "const style = { borderColor: 'rgba(0,0,0,.5)' }\n",
    )
    try {
      const violations = analyzeTokens(root)
      expect(violations).toHaveLength(1)
      expect(violations[0]!.value).toBe('rgba(')
      expect(violations[0]!.problem).toContain('literal colour')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('the primitive layer is the only exempt file', () => {
    const root = scanned('packages/ui/src/tokens/primitives.ts', "export const c = '#18181e'\n")
    try {
      expect(analyzeTokens(root)).toEqual([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('Dimension hors échelle détectée', () => {
  test('a padding of five pixels names the neighbouring steps', () => {
    const root = scanned('packages/ui/src/primitives/box.tsx', 'const style = { padding: 5 }\n')
    try {
      const violations = analyzeTokens(root)
      expect(violations).toHaveLength(1)
      expect(violations[0]!.value).toBe('padding: 5')
      expect(violations[0]!.problem).toContain('the spacing scale; nearest steps are 4 and 6')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('a text size outside the scale is reported', () => {
    const root = scanned('apps/desktop/src/ui/page.tsx', 'const style = { fontSize: 13.5 }\n')
    try {
      const violations = analyzeTokens(root)
      expect(violations).toHaveLength(1)
      expect(violations[0]!.value).toBe('fontSize: 13.5')
      expect(violations[0]!.problem).toContain('the text size scale; nearest steps are 13 and 14')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('a radius of nine pixels is reported', () => {
    const root = scanned('packages/ui/src/components/button/button.tsx', '({ borderRadius: 9 })\n')
    try {
      const violations = analyzeTokens(root)
      expect(violations).toHaveLength(1)
      expect(violations[0]!.problem).toContain('the radius scale; nearest steps are 8 and 12')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('a dimension that a scale expresses passes', () => {
    const root = scanned(
      'packages/ui/src/components/button/button.tsx',
      'const style = { padding: 8, borderRadius: 8, fontSize: 14, height: 32, borderWidth: 1 }\n',
    )
    try {
      expect(analyzeTokens(root)).toEqual([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('the allowed dimensions are the union of the closed scales', () => {
    const allowed = allowedDimensions()
    expect(allowed).toContain(0)
    expect(allowed).toContain(999)
    expect(allowed).not.toContain(5)
    expect(allowed).not.toContain(9)
    expect(allowed.toSorted((a, b) => a - b)).toEqual(allowed)
  })
})

describe('Valeur citée en commentaire', () => {
  test('a colour quoted in a comment is not reported as code', () => {
    const root = scanned(
      'packages/ui/src/components/card/card.tsx',
      ['// the prototype used #18181e here', 'export const Card = () => null', ''].join('\n'),
    )
    try {
      expect(analyzeTokens(root)).toEqual([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('block and line comments are dropped before scanning', () => {
    expect(withoutComments('/* #ffffff */ const a = 1 // #000000')).not.toContain('#')
  })
})

describe('Mesure de texte interdite', () => {
  test('measuring text in JavaScript is refused', () => {
    const root = scanned(
      'packages/ui/src/components/card/card.tsx',
      'const width = context.measureText(label).width\n',
    )
    try {
      const violations = analyzeTokens(root)
      expect(violations).toHaveLength(1)
      expect(violations[0]!.problem).toContain('exposes no measurement')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('reading the screen density is refused', () => {
    const root = scanned('apps/desktop/src/ui/page.tsx', 'const scale = devicePixelRatio\n')
    try {
      const violations = analyzeTokens(root)
      expect(violations).toHaveLength(1)
      expect(violations[0]!.problem).toContain('applies the system scale itself')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('Espacement hors échelle', () => {
  test('a padding of 5 pixels is refused, naming the value and its neighbours', () => {
    const root = scanned(
      'packages/ui/src/components/button/button.tsx',
      'const surface = { padding: 5 }\n',
    )
    try {
      const violation = analyzeTokens(root)[0]!
      expect(violation.value).toBe('padding: 5')
      expect(violation.problem).toContain('the spacing scale')
      // The neighbouring steps are named, so the value to use is obvious.
      expect(violation.problem).toContain('4')
      expect(violation.problem).toContain('6')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('Valeur intermédiaire normalisée', () => {
  test('an intermediate size or radius of the prototype never reaches the code', () => {
    const root = scanned(
      'packages/ui/src/components/card/card.tsx',
      'const surface = { fontSize: 12.5, borderRadius: 9 }\n',
    )
    try {
      const values = analyzeTokens(root).map((violation) => violation.value)
      expect(values).toContain('fontSize: 12.5')
      expect(values).toContain('borderRadius: 9')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('no intermediate value of the prototype exists in this monorepo', () => {
    expect(analyzeTokens(repository)).toEqual([])
  })
})

describe('Style visuel dans un écran', () => {
  test('a screen applying its own background or radius is refused', () => {
    const root = scanned(
      'apps/desktop/src/ui/sessions/sessions-page.tsx',
      "const surface = { backgroundColor: '#18181e', borderRadius: 9 }\n",
    )
    try {
      const found = analyzeTokens(root)
      expect(found.map((violation) => violation.value)).toContain('#18181e')
      expect(found.map((violation) => violation.problem).join(' ')).toContain('the radius scale')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('Token manquant pour un besoin réel', () => {
  test('a value no token expresses is added to the scale, never written in the component', () => {
    // The rule scale is a token because a component needed it; it lives in the token layer.
    const primitives = readFileSync(
      join(repository, 'packages', 'ui', 'src', 'tokens', 'primitives.ts'),
      'utf8',
    )
    const components = readFileSync(
      join(repository, 'packages', 'ui', 'src', 'tokens', 'components.ts'),
      'utf8',
    )
    expect(primitives).toContain('lineHeight')
    expect(components).toContain('rule')
    expect(components).toContain('badge')

    // Both themes carry the same roles, so a token added to one is added to the other.
    expect(Object.keys(dark.colors).toSorted()).toEqual(Object.keys(light.colors).toSorted())

    // And nothing of the monorepo writes a raw value while waiting for a token.
    expect(analyzeTokens(repository)).toEqual([])
  })
})
