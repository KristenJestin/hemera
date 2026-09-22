import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, test } from 'vite-plus/test'

import { MEASURE_EXCEPTIONS, analyze, refusalsOf } from './text-measure.ts'

const repository = resolve(import.meta.dirname, '..')
const designSystem = join(repository, 'packages', 'ui', 'src')
const renderer = join(repository, 'apps', 'desktop', 'src', 'renderer')

describe('Mesure de texte interdite', () => {
  test('nothing in the shell or the design system of this lot measures text', () => {
    expect(analyze(designSystem, repository)).toEqual([])
    expect(analyze(renderer, repository)).toEqual([])
  })

  test('a component that measures is refused, naming the component and the measure', () => {
    // A real file in a tree of its own, and not in this repository's: the checks of the other
    // tools walk the same folders at the same time, and a file that appears and disappears
    // under them is a failure in a test that has nothing to do with this one.
    const root = mkdtempSync(join(tmpdir(), 'hemera-text-measure-'))
    const shell = join(root, 'packages', 'ui', 'src', 'shell')
    mkdirSync(shell, { recursive: true })
    writeFileSync(
      join(shell, 'deliberate-measure.tsx'),
      'export const width = (node: HTMLElement) => node.offsetWidth\n',
    )
    try {
      const refusals = analyze(join(root, 'packages', 'ui', 'src'), root)
      expect(refusals.map((refusal) => refusal.file)).toEqual([
        'packages/ui/src/shell/deliberate-measure.tsx',
      ])
      expect(refusals[0]!.measure).toBe('offsetWidth')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test.each([
    ['a box read back', 'const box = node.getBoundingClientRect()', 'getBoundingClientRect'],
    ['a height read back', 'const tall = node.offsetHeight', 'offsetHeight'],
    ['a string measured on a canvas', 'context.measureText(label)', 'measureText'],
    [
      'a size asked of the styles',
      'const wide = getComputedStyle(node).width',
      'getComputedStyle(...).width',
    ],
  ])('%s is refused', (_case, source, measure) => {
    const file = 'packages/ui/src/shell/sidebar.tsx'
    const refusals = refusalsOf(file, source)
    expect(refusals.map((refusal) => refusal.measure)).toContain(measure)
    expect(refusals[0]!.file).toBe(file)
  })

  test('a test and a story may measure, because measuring is what they are for', () => {
    const source = 'expect(node.getBoundingClientRect().width).toBe(256)'
    expect(refusalsOf('packages/ui/src/shell/shell.stories.tsx', source)).toEqual([])
    expect(refusalsOf('apps/desktop/tests/shell.test.ts', source)).toEqual([])
  })

  test('the fixtures a story is shown may measure too, being the story itself', () => {
    const source = 'expect(panel.getBoundingClientRect().height).toBe(384)'
    expect(refusalsOf('packages/ui/src/composer/agent-model-menu-fixtures.tsx', source)).toEqual([])
    expect(refusalsOf('packages/ui/src/composer/agent-model-menu.tsx', source)).not.toEqual([])
  })

  test('the separator may ask where a pointer is, and nothing else may', () => {
    const source = 'const box = node.getBoundingClientRect()'
    expect(refusalsOf(MEASURE_EXCEPTIONS[0]!, source)).toEqual([])
    expect(refusalsOf('packages/ui/src/shell/shell.tsx', source)).not.toEqual([])
  })
})
