import { join, resolve } from 'node:path'
import { describe, expect, test } from 'vite-plus/test'

import {
  MOTION_PRESET,
  MOTION_THEME,
  analyze,
  animatedPropertiesOf,
  animatedStyleOf,
  hardcodedOf,
  refusalsOf,
} from './motion-properties.ts'

const repository = resolve(import.meta.dirname, '..')
const renderer = join(repository, 'apps', 'desktop', 'src', 'renderer')
const designSystem = join(repository, 'packages', 'ui', 'src')

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

describe('Preset partagé', () => {
  test('the design system writes its spring numbers in the preset and nowhere else', () => {
    expect(analyze(designSystem, repository).map((refusal) => refusal.file)).toEqual([])
  })

  test('the preset is the file the numbers are allowed to be in', () => {
    const source = "export const spring = { type: 'spring', stiffness: 170, damping: 26 }\n"
    expect(hardcodedOf(MOTION_PRESET, source)).toEqual([])
  })

  test.each([
    ['a spring of its own', 'transition={{ stiffness: 200, damping: 10 }}', 'stiffness'],
    ['a damping of its own', 'transition={{ type: "spring", damping: 12 }}', 'damping'],
    ['a duration of its own', 'transition={{ duration: 0.4 }}', 'duration'],
    ['a delay of its own', 'transition={{ delay: 0.12 }}', 'delay'],
  ])(
    'a component that writes %s is refused, naming the file and the value',
    (_case, source, property) => {
      const file = 'packages/ui/src/components/button/button.tsx'
      const refusals = hardcodedOf(file, source)
      expect(refusals.map((refusal) => refusal.property)).toContain(property)
      expect(refusals[0]!.file).toBe(file)
      expect(refusals[0]!.problem).toContain(MOTION_PRESET)
    },
  )

  test('a duration written in a stylesheet of the design system is refused', () => {
    const refusals = hardcodedOf(
      'packages/ui/src/components/menu/menu.css',
      '.a { transition: opacity 120ms; }',
    )
    expect(refusals.map((refusal) => refusal.property)).toContain('120ms')
    expect(refusals[0]!.problem).toContain(MOTION_THEME)
  })

  test('the theme is the file the durations are allowed to be in', () => {
    expect(hardcodedOf(MOTION_THEME, '@theme { --duration-base: 260ms; }')).toEqual([])
  })
})

describe('Propriétés autorisées seules dans le design system', () => {
  test('the design system of this lot animates composited properties only', () => {
    expect(analyze(designSystem, repository)).toEqual([])
  })

  test.each([
    ['a width', '<motion.div animate={{ width: 320 }} />', 'width'],
    [
      'a colour',
      '<motion.div animate={{ backgroundColor: "var(--primary)" }} />',
      'backgroundColor',
    ],
  ])(
    '%s asked of motion by a component is refused, naming the component and the property',
    (_case, source, property) => {
      const file = 'packages/ui/src/components/badge/badge.tsx'
      const refusals = refusalsOf(file, source)
      expect(refusals.map((refusal) => refusal.property)).toContain(property)
      expect(refusals[0]!.file).toBe(file)
    },
  )
})
