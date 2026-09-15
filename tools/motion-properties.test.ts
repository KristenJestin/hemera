import { join, resolve } from 'node:path'
import { describe, expect, test } from 'vite-plus/test'

import { analyze, animatedPropertiesOf, animatedStyleOf, refusalsOf } from './motion-properties.ts'

const repository = resolve(import.meta.dirname, '..')
const renderer = join(repository, 'apps', 'desktop', 'src', 'renderer')

describe('Propriétés autorisées seules', () => {
  test('the renderer of this lot animates composited properties only', () => {
    expect(analyze(renderer, repository)).toEqual([])
  })

  test('a transform and an opacity are read as what motion animates', () => {
    const source = '<motion.section animate={{ opacity: 1, y: 0, scale: 1 }} transition={CALM} />'
    expect(animatedPropertiesOf(source).toSorted()).toEqual(['opacity', 'scale', 'y'])
    expect(refusalsOf('panel.tsx', source)).toEqual([])
  })

  test.each([
    ['a width', '<motion.div animate={{ width: 320 }} />', 'width'],
    ['a height', '<motion.div animate={{ height: 48 }} />', 'height'],
    ['a position', '<motion.div animate={{ top: 0, left: 12 }} />', 'top'],
    ['a margin', '<motion.div animate={{ marginTop: 8 }} />', 'marginTop'],
    ['a padding', '<motion.div animate={{ padding: 8 }} />', 'padding'],
    ['a colour', '<motion.div animate={{ backgroundColor: "#fff" }} />', 'backgroundColor'],
  ])(
    '%s asked of motion is refused, naming the file and the property',
    (_case, source, property) => {
      const refusals = refusalsOf('apps/desktop/src/renderer/panel.tsx', source)
      expect(refusals.map((refusal) => refusal.property)).toContain(property)
      expect(refusals[0]!.file).toBe('apps/desktop/src/renderer/panel.tsx')
    },
  )

  test('a stylesheet that transitions a composited property passes', () => {
    expect(animatedStyleOf('.a { transition: opacity 120ms, transform 120ms; }')).toEqual([
      'opacity',
      'transform',
    ])
    expect(refusalsOf('panel.css', '.a { transition: opacity 120ms; }')).toEqual([])
  })

  test.each([
    ['a transition on a width', '.a { transition: width 120ms; }', 'width'],
    [
      'a transition on a colour',
      '.a { transition-property: background-color; }',
      'background-color',
    ],
    ['a blanket transition', '.a { transition: all 120ms; }', 'all'],
    [
      'a keyframe that moves a box',
      '@keyframes grow {\n  from { width: 0; }\n  to { width: 100%; }\n}',
      'width',
    ],
  ])('%s is refused', (_case, source, property) => {
    expect(refusalsOf('panel.css', source).map((refusal) => refusal.property)).toContain(property)
  })
})
