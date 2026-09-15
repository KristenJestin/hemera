import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, test } from 'vite-plus/test'

import { analyze, refusalsOf, scalesOf } from './scales.ts'

const repository = resolve(import.meta.dirname, '..')
const scales = scalesOf(
  readFileSync(join(repository, 'packages', 'ui', 'src', 'theme.css'), 'utf8'),
)

describe('Valeur hors échelle refusée', () => {
  test('the scales are the ones the theme declares', () => {
    expect(scales.radius).toEqual(['sm', 'md', 'lg', 'xl', 'none', 'full'])
    expect(scales.duration).toEqual(['fast', 'base', 'slow', 'turn'])
    expect(scales.spacing).toContain('icon-md')
  })

  test.each([
    ['an arbitrary padding', 'p-[13px]', 'spacing'],
    ['a step the scale skips', 'p-7', 'spacing'],
    ['a duration off the scale', 'duration-333', 'duration'],
    ['a radius off the scale', 'rounded-3xl', 'radius'],
    ['a radius by no name at all', 'rounded', 'radius'],
  ])('%s is refused, naming the class and the steps available', (_case, className, family) => {
    const refusals = refusalsOf('packages/ui/src/components/card.tsx', `"${className}"`, scales)
    expect(refusals).toHaveLength(1)
    expect(refusals[0]!.className).toBe(className)
    expect(refusals[0]!.problem).toContain(`${family} scale`)
    expect(refusals[0]!.problem).toContain(scales[family === 'radius' ? 'radius' : family][0]!)
  })

  test.each([
    'p-4',
    'px-2',
    'gap-x-1.5',
    'space-y-2',
    '-mt-1',
    'hover:p-3',
    'w-full',
    'size-icon-md',
    'rounded-md',
    'rounded-tl-lg',
    'duration-base',
  ])('%s is a step of the scale and passes', (className) => {
    expect(refusalsOf('packages/ui/src/components/card.tsx', `"${className}"`, scales)).toEqual([])
  })

  test('a word a popup uses to name its side is not read as a class', () => {
    expect(refusalsOf('menu.tsx', '<Popup side="bottom" align="left" />', scales)).toEqual([])
  })

  test('the design system and the renderer of this lot stay on the scales', () => {
    for (const root of [
      join(repository, 'packages', 'ui', 'src'),
      join(repository, 'apps', 'desktop', 'src', 'renderer'),
    ]) {
      expect(analyze(root, repository, scales)).toEqual([])
    }
  })
})
