import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, test } from 'vite-plus/test'

import {
  MOTION_PRESET,
  MOTION_THEME,
  analyze,
  boundToPresetIn,
  hardcodedOf,
  keyframesOf,
  presetKindsOf,
  refusalsOf,
  transitionsOf,
  unansweredOf,
  unpresetOf,
} from './motion-presets.ts'

const repository = resolve(import.meta.dirname, '..')
const renderer = join(repository, 'apps', 'desktop', 'src', 'renderer')
const designSystem = join(repository, 'packages', 'ui', 'src')
const kinds = presetKindsOf(readFileSync(join(repository, MOTION_PRESET), 'utf8'))

describe('Les kinds du preset', () => {
  test('the kinds are read off the preset itself, not listed beside it', () => {
    expect(kinds).toContain('arrival')
    expect(kinds).toContain('slide')
    expect(kinds).toContain('expand')
    expect(kinds).toContain('collapse')
    expect(kinds).toContain('push')
    expect(kinds).toContain('crossfade')
    expect(kinds).toContain('useTransition')
  })

  test('the renderer of this lot moves by the preset and nothing else', () => {
    expect(analyze(renderer, repository, kinds)).toEqual([])
  })

  test('the design system of this lot moves by the preset and nothing else', () => {
    expect(analyze(designSystem, repository, kinds)).toEqual([])
  })
})

describe('Une transition lue sur le preset, et pas une autre', () => {
  test('what a transition prop was handed is read whole, braces and all', () => {
    const source = '<motion.div transition={transition} /><motion.p transition={{ delay: 1 }} />'
    expect(transitionsOf(source)).toEqual(['transition', '{ delay: 1 }'])
  })

  test('a transition read from the hook passes', () => {
    const source = [
      'const transition = useTransition(arrival)',
      '<motion.div animate={{ height: "auto" }} transition={transition} />',
    ].join('\n')
    expect(unpresetOf('packages/ui/src/panel.tsx', source, kinds)).toEqual([])
  })

  test('a kind of the preset named directly passes', () => {
    expect(unpresetOf('panel.tsx', '<motion.div transition={instant} />', kinds)).toEqual([])
  })

  test('a transition written inline is refused, naming the file', () => {
    const file = 'packages/ui/src/components/badge/badge.tsx'
    const refusals = unpresetOf(file, '<motion.div transition={{ type: "spring" }} />', kinds)
    expect(refusals.map((refusal) => refusal.property)).toEqual(['transition'])
    expect(refusals[0]!.file).toBe(file)
    expect(refusals[0]!.problem).toContain(MOTION_PRESET)
  })

  test('a transition that leads back to neither the hook nor a kind is refused', () => {
    const source = ['const own = makeSpring()', '<motion.div transition={own} />'].join('\n')
    const refusals = unpresetOf('panel.tsx', source, kinds)
    expect(refusals.map((refusal) => refusal.property)).toEqual(['own'])
  })

  test('a name the file bound to the hook is followed back to it, through a second one', () => {
    const source = [
      'const transition = useTransition(arrival)',
      'const labels = still ? transition : { ...transition, delay: LABEL_DELAY }',
    ].join('\n')
    expect(boundToPresetIn(source, kinds).has('labels')).toBe(true)
    expect(
      unpresetOf('panel.tsx', `${source}\n<motion.span transition={labels} />`, kinds),
    ).toEqual([])
  })

  test('a transition chosen between two kinds by a condition passes', () => {
    const source = [
      'const transition = useTransition(morph)',
      '<motion.div transition={dragging ? instant : transition} />',
    ].join('\n')
    expect(unpresetOf('packages/ui/src/shell/sidebar.tsx', source, kinds)).toEqual([])
  })

  test('the preset is free to write its own transitions, being the one that holds them', () => {
    const source = "export const own: Transition = { type: 'spring', stiffness: 170 }"
    expect(unpresetOf(MOTION_PRESET, source, kinds)).toEqual([])
  })
})

describe('Aucune valeur de mouvement hors du preset', () => {
  test('the preset is the file the numbers are allowed to be in', () => {
    const source = [
      "export const spring = { type: 'spring', stiffness: 170, damping: 26 }",
      'export const reach = { duration: 0.19, ease: [0.23, 1, 0.32, 1] }',
    ].join('\n')
    expect(hardcodedOf(MOTION_PRESET, source)).toEqual([])
  })

  test.each([
    ['a spring of its own', 'transition={{ stiffness: 200, damping: 10 }}', 'stiffness'],
    ['a damping of its own', 'transition={{ type: "spring", damping: 12 }}', 'damping'],
    ['a duration of its own', 'transition={{ duration: 0.4 }}', 'duration'],
    ['a delay of its own', 'transition={{ delay: 0.12 }}', 'delay'],
    ['a curve of its own', 'const curve = { ease: [0.4, 0, 0.2, 1] }', 'ease'],
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

  test('a keyframe written into what a component animates towards is refused', () => {
    const source = '<motion.div animate={{ opacity: [0, 1, 0] }} transition={transition} />'
    expect(keyframesOf(source)).toEqual(['opacity'])
    const refusals = hardcodedOf('packages/ui/src/message/bubble.tsx', source)
    expect(refusals.map((refusal) => refusal.problem)).toEqual([
      `is a keyframe written here instead of read from ${MOTION_PRESET}`,
    ])
  })

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

describe('Ce qui bouge, sans plus demander quelle propriété', () => {
  test.each([
    ['a height', '<motion.div animate={{ height: "auto" }} transition={transition} />'],
    ['a width', '<motion.aside animate={{ width: 256 }} transition={transition} />'],
    ['a push on the neighbours', '<motion.li layout="position" transition={transition} />'],
    ['a colour', '<motion.div animate={{ backgroundColor: "var(--primary)" }} transition={t} />'],
  ])('%s is a movement like any other now, in any file', (_case, body) => {
    const source = `const transition = useTransition(push)\nconst t = transition\n${body}`
    expect(refusalsOf('packages/ui/src/activity/tool-call-card.tsx', source, kinds)).toEqual([])
  })
})

describe('Réponse au mouvement réduit', () => {
  test('a motion element that moves on a transition from the hook passes', () => {
    const source = [
      'const transition = useTransition(press)',
      '<motion.button whileTap={{ scale: PRESSED }} transition={transition} />',
    ].join('\n')
    expect(unansweredOf('packages/ui/src/components/button/button.tsx', source)).toEqual([])
  })

  test('a motion element that moves without a transition is refused, naming the prop', () => {
    const source = '<motion.div animate={{ opacity: 1, y: 0 }} />'
    const refusals = unansweredOf('apps/desktop/src/renderer/panel.tsx', source)
    expect(refusals.map((refusal) => refusal.property)).toEqual(['animate', 'useTransition'])
    expect(refusals[0]!.problem).toContain('useTransition')
  })

  test('a motion element that is only placed does not have to answer', () => {
    expect(unansweredOf('panel.tsx', '<motion.div initial={false} />')).toEqual([])
  })

  test('the renderer and the design system of this lot answer reduced motion everywhere', () => {
    expect(analyze(renderer, repository, kinds)).toEqual([])
    expect(analyze(designSystem, repository, kinds)).toEqual([])
  })
})
