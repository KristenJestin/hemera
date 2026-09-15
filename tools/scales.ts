#!/usr/bin/env node
/**
 * Checks that every size, radius and duration a class asks for is a step of the scale
 * (design D1-07).
 *
 * Tailwind will happily generate `p-7`, `p-[13px]` and `duration-333`: its spacing scale is a
 * multiplication, not a list, and an arbitrary value bypasses it altogether. A design system
 * whose spacing is a continuum has no spacing. So the steps are written down here, the radii
 * and the durations are read off the theme that declares them, and anything else is refused
 * with the list of what was available instead.
 *
 *   node tools/scales.ts
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

/**
 * The steps of the spacing scale Hemera kept, in `--spacing` units of 0.25rem. Sparse on
 * purpose: the gaps are what make two paddings chosen a week apart line up.
 */
export const SPACING_STEPS = [
  '0',
  '0.5',
  '1',
  '1.5',
  '2',
  '2.5',
  '3',
  '4',
  '5',
  '6',
  '8',
  '10',
  '12',
  '16',
  '20',
  '24',
] as const

/** Values that name an intent rather than a step, and so are not on the scale to begin with. */
export const SPACING_KEYWORDS = ['auto', 'full', 'fit', 'min', 'max', 'screen'] as const

/** Radii and durations that mean "none" or "all the way round", outside the theme's steps. */
export const RADIUS_KEYWORDS = ['none', 'full'] as const

const SPACING_UTILITIES = [
  'p',
  'px',
  'py',
  'pt',
  'pr',
  'pb',
  'pl',
  'm',
  'mx',
  'my',
  'mt',
  'mr',
  'mb',
  'ml',
  'gap',
  'gap-x',
  'gap-y',
  'space-x',
  'space-y',
  'size',
  'w',
  'h',
  'top',
  'right',
  'bottom',
  'left',
  'inset',
  'inset-x',
  'inset-y',
]

const RADIUS_UTILITIES = [
  'rounded',
  'rounded-t',
  'rounded-r',
  'rounded-b',
  'rounded-l',
  'rounded-tl',
  'rounded-tr',
  'rounded-br',
  'rounded-bl',
]

const DURATION_UTILITIES = ['duration']

export interface Scales {
  spacing: string[]
  radius: string[]
  duration: string[]
}

/** The steps the theme and this file agree on, read from the file the theme is declared in. */
export function scalesOf(theme: string): Scales {
  const named = (prefix: string): string[] =>
    [...theme.matchAll(new RegExp(`^\\s*--${prefix}-([\\w-]+)\\s*:`, 'gm'))].map(
      (match) => match[1]!,
    )
  return {
    spacing: [...SPACING_STEPS, ...SPACING_KEYWORDS, ...named('spacing')],
    radius: [...named('radius'), ...RADIUS_KEYWORDS],
    duration: named('duration'),
  }
}

export interface Refusal {
  file: string
  className: string
  problem: string
}

/** The utility a class name asks for and the value it asks it for, variants and sign removed. */
function readClass(token: string): { utility: string; value: string } | null {
  const bare = token.slice(token.lastIndexOf(':') + 1).replace(/^-/, '')
  // A bare `rounded` is a class that rounds by an amount nobody named; a bare `top` or
  // `bottom` is the word a popup uses to say which side it opens on, and not a class at all.
  if (RADIUS_UTILITIES.includes(bare)) return { utility: bare, value: '' }
  for (const utility of [...SPACING_UTILITIES, ...RADIUS_UTILITIES, ...DURATION_UTILITIES]) {
    if (bare.startsWith(`${utility}-`)) {
      const value = bare.slice(utility.length + 1)
      // `gap-x-2` is `gap-x`, not `gap` asked for `x-2`: the longer utility wins, and the
      // list is walked in a fixed order, so the short one has to hand the name back.
      if (/^(x|y|t|r|b|l|tl|tr|br|bl)-/.test(value)) continue
      return { utility, value }
    }
  }
  return null
}

/** Every whitespace-separated word of every quoted string of a source file. */
function wordsOf(source: string): string[] {
  return [...source.matchAll(/'([^'\n]*)'|"([^"\n]*)"/g)]
    .map((match) => match[1] ?? match[2] ?? '')
    .flatMap((literal) => literal.split(/\s+/))
    .filter((word) => word !== '')
}

export function refusalsOf(file: string, source: string, scales: Scales): Refusal[] {
  const refusals: Refusal[] = []
  for (const word of wordsOf(source)) {
    const asked = readClass(word)
    if (asked === null) continue
    const family = RADIUS_UTILITIES.includes(asked.utility)
      ? ('radius' as const)
      : DURATION_UTILITIES.includes(asked.utility)
        ? ('duration' as const)
        : ('spacing' as const)
    const allowed = scales[family]
    if (allowed.includes(asked.value)) continue
    refusals.push({
      file,
      className: word,
      problem:
        asked.value === ''
          ? `names no step of the ${family} scale; the steps are ${allowed.join(', ')}`
          : `is not a step of the ${family} scale; the steps are ${allowed.join(', ')}`,
    })
  }
  return refusals
}

function sourceFilesOf(directory: string): string[] {
  if (!existsSync(directory)) return []
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) return sourceFilesOf(path)
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [path] : []
  })
}

export function analyze(root: string, repositoryRoot: string, scales: Scales): Refusal[] {
  return sourceFilesOf(root).flatMap((file) =>
    refusalsOf(
      relative(repositoryRoot, file).replaceAll('\\', '/'),
      readFileSync(file, 'utf8'),
      scales,
    ),
  )
}

if (import.meta.main) {
  const repository = resolve(import.meta.dirname, '..')
  const scales = scalesOf(
    readFileSync(join(repository, 'packages', 'ui', 'src', 'theme.css'), 'utf8'),
  )
  const refusals = [
    join(repository, 'packages', 'ui', 'src'),
    join(repository, 'apps', 'desktop', 'src', 'renderer'),
  ].flatMap((root) => analyze(root, repository, scales))
  for (const refusal of refusals) {
    console.error(`${refusal.file}: "${refusal.className}" ${refusal.problem}`)
  }
  console.log(
    refusals.length === 0
      ? 'every size, radius and duration is a step of the scale'
      : `${refusals.length} class(es) outside the scales`,
  )
  if (refusals.length > 0) process.exit(1)
}
