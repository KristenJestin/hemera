#!/usr/bin/env node
/**
 * Checks that everything that moves, moves by a kind of the preset (decision of 22 September
 * 2026, which replaces D0-06).
 *
 * D0-06 asked what property was being animated and allowed four of them. It is gone: motion
 * goes wherever the UX needs it, a height and a push on the neighbours included, and this
 * check no longer reads the targets at all. What it reads is where the movement was decided.
 *
 * Every animation is a named kind of `packages/ui/src/motion.ts`. A component that needs a
 * kind that is not there adds it there and reads it by name — it does not write a spring, a
 * duration, a curve or a keyframe of its own, because a personality written twice is no
 * longer one. And nothing moves without a transition from `useTransition`, which is what
 * answers a reader asking for less movement.
 *
 *   node tools/motion-presets.ts
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

/** The one file allowed to write motion values: the preset every animation reads. */
export const MOTION_PRESET = 'packages/ui/src/motion.ts'

/** The one file allowed to write durations in CSS: the theme they are a scale of (D1-01). */
export const MOTION_THEME = 'packages/ui/src/theme.css'

/** What a spring is made of. Written twice, a personality is no longer one. */
const SPRING_PARAMETER = /\b(stiffness|damping|mass|bounce|restDelta|restSpeed)\s*:\s*[-\d.]/g

/** Timings a component asks motion for in numbers instead of reading them off the scale. */
const LITERAL_TIMING = /\b(duration|delay|repeatDelay|staggerChildren|delayChildren)\s*:\s*[-\d.]/g

/** A curve, whichever way it is written: a name, a cubic bézier, a list of them. */
const LITERAL_EASING = /(?<![\w-])(ease|easings)\s*:/g

/** A time written in a stylesheet, which the theme's duration tokens exist to replace. */
const CSS_TIME = /(?<![\w-])\d+(?:\.\d+)?m?s(?![\w-])/g

/** Props of a motion component that carry what it animates towards. */
const ANIMATED_PROPS = ['initial', 'animate', 'exit', 'whileHover', 'whileTap', 'whileFocus']

/** A property given a list of values to pass through: a keyframe, which is a kind of its own. */
const KEYFRAME = /\b([A-Za-z][\w$]*)\s*:\s*\[\s*-?[\d.]/g

export interface Refusal {
  file: string
  property: string
  problem: string
}

/**
 * The kinds the preset publishes, read off the preset itself rather than listed here.
 *
 * A kind is added by writing it in `motion.ts`; a list kept in the lint beside it is a second
 * place to forget.
 */
export function presetKindsOf(source: string): string[] {
  return [...source.matchAll(/^export\s+(?:const|function)\s+([A-Za-z_$][\w$]*)/gm)].map(
    (match) => match[1]!,
  )
}

/** The kinds as they stand, for a caller with no preset to hand — the unit tests, mostly. */
export const PRESET_KINDS = [
  'press',
  'arrival',
  'morph',
  'reach',
  'lead',
  'trail',
  'settle',
  'instant',
  'slide',
  'expand',
  'collapse',
  'push',
  'crossfade',
  'ping',
  'pinging',
  'useTransition',
]

/** Everything written between `transition={` and the brace that closes it, one per prop. */
export function transitionsOf(source: string): string[] {
  const values: string[] = []
  const opening = /transition=\{/g
  let found = opening.exec(source)
  while (found !== null) {
    let depth = 1
    let index = found.index + found[0].length
    const start = index
    while (index < source.length && depth > 0) {
      if (source[index] === '{') depth += 1
      else if (source[index] === '}') depth -= 1
      index += 1
    }
    values.push(source.slice(start, index - 1).trim())
    opening.lastIndex = index
    found = opening.exec(source)
  }
  return values
}

const IDENTIFIER = /[A-Za-z_$][\w$]*/g

/**
 * The names a file bound to something that came out of the preset, so that the transition it
 * hands a motion element can be followed back to one.
 *
 * A component reads `useTransition` once and passes the answer around, sometimes through a
 * second name that delays it or swaps it for `instant` while a drag is on. Those are still the
 * preset; a fresh object literal is not, and is the whole point of the check.
 */
export function boundToPresetIn(source: string, kinds: readonly string[]): Set<string> {
  const bound = new Set<string>(kinds)
  for (const line of source.split('\n')) {
    const assignment = /^\s*(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(.*)$/.exec(line)
    if (assignment === null) continue
    const [, name, initializer] = assignment
    const names = initializer!.match(IDENTIFIER) ?? []
    if (names.some((one) => bound.has(one))) bound.add(name!)
  }
  return bound
}

/**
 * Transitions a file wrote itself instead of reading one off the preset.
 *
 * Refused two ways: an object literal, which is a kind nobody named, and a name that leads
 * back to neither `useTransition` nor an export of the preset.
 */
export function unpresetOf(
  file: string,
  source: string,
  kinds: readonly string[] = PRESET_KINDS,
): Refusal[] {
  if (file === MOTION_PRESET) return []
  const bound = boundToPresetIn(source, kinds)
  return transitionsOf(source).flatMap((value) => {
    if (value.startsWith('{')) {
      return [
        {
          file,
          property: 'transition',
          problem: `is a transition written here instead of a kind of ${MOTION_PRESET}`,
        },
      ]
    }
    const names = value.match(IDENTIFIER) ?? []
    if (names.some((one) => bound.has(one))) return []
    return [
      {
        file,
        property: value === '' ? 'transition' : value,
        problem: `is not a kind of ${MOTION_PRESET} and not read from useTransition`,
      },
    ]
  })
}

/** Keyframes a component writes into what it animates towards, list of values and all. */
export function keyframesOf(source: string): string[] {
  const properties: string[] = []
  for (const prop of ANIMATED_PROPS) {
    const block = new RegExp(`${prop}=\\{\\{([^}]*)\\}\\}`, 'g')
    let found = block.exec(source)
    while (found !== null) {
      KEYFRAME.lastIndex = 0
      let key = KEYFRAME.exec(found[1]!)
      while (key !== null) {
        properties.push(key[1]!)
        key = KEYFRAME.exec(found[1]!)
      }
      found = block.exec(source)
    }
  }
  return properties
}

/**
 * Motion values a file writes itself instead of reading them from the preset and the theme.
 *
 * The preset and the theme are where those numbers live; anywhere else they are a second
 * personality that nobody decided on. What is animated is free now; what it is animated *by*
 * is not.
 */
export function hardcodedOf(file: string, source: string): Refusal[] {
  const refusals: Refusal[] = []
  const inDesignSystem = file.startsWith('packages/ui/')

  if (file !== MOTION_PRESET) {
    for (const pattern of [SPRING_PARAMETER, LITERAL_TIMING, LITERAL_EASING]) {
      pattern.lastIndex = 0
      let found = pattern.exec(source)
      while (found !== null) {
        refusals.push({
          file,
          property: found[1]!,
          problem: `is a motion value written here instead of read from ${MOTION_PRESET}`,
        })
        found = pattern.exec(source)
      }
    }
    for (const property of keyframesOf(source)) {
      refusals.push({
        file,
        property,
        problem: `is a keyframe written here instead of read from ${MOTION_PRESET}`,
      })
    }
  }

  if (inDesignSystem && file !== MOTION_THEME && file.endsWith('.css')) {
    CSS_TIME.lastIndex = 0
    let time = CSS_TIME.exec(source)
    while (time !== null) {
      refusals.push({
        file,
        property: time[0],
        problem: `is a duration written here instead of read from ${MOTION_THEME}`,
      })
      time = CSS_TIME.exec(source)
    }
  }
  return refusals
}

/** An opening tag of a motion element, with everything written between its brackets. */
const MOTION_ELEMENT = /<motion\.\w+\b([\s\S]*?)\/?>/g

/** Props that set a motion element in motion; `initial` alone only places it. */
const MOVING_PROPS = ['animate', 'exit', 'whileHover', 'whileTap', 'whileFocus', 'layout']

/**
 * Motion elements that move without a transition read from `useTransition`.
 *
 * The hook is what answers the reduced-motion preference for the design system; an element
 * that animates on motion's default spring has both a second personality and no answer.
 */
export function unansweredOf(file: string, source: string): Refusal[] {
  const refusals: Refusal[] = []
  MOTION_ELEMENT.lastIndex = 0
  let element = MOTION_ELEMENT.exec(source)
  while (element !== null) {
    const props = element[1]!
    const moving = MOVING_PROPS.filter((prop) => new RegExp(`\\b${prop}(=|\\s|$)`).test(props))
    if (moving.length > 0 && !/\btransition=\{/.test(props)) {
      refusals.push({
        file,
        property: moving[0]!,
        problem: 'moves a motion element without a `transition` read from useTransition',
      })
    }
    element = MOTION_ELEMENT.exec(source)
  }
  if (refusals.length > 0 && !/\buseTransition\(/.test(source)) {
    refusals.push({
      file,
      property: 'useTransition',
      problem: 'animates without ever calling useTransition, which answers reduced motion',
    })
  }
  return refusals
}

export function refusalsOf(
  file: string,
  source: string,
  kinds: readonly string[] = PRESET_KINDS,
): Refusal[] {
  if (file.endsWith('.css')) return hardcodedOf(file, source)
  return [
    ...unansweredOf(file, source),
    ...unpresetOf(file, source, kinds),
    ...hardcodedOf(file, source),
  ]
}

function filesUnder(directory: string, keep: (path: string) => boolean): string[] {
  if (!existsSync(directory)) return []
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) return filesUnder(path, keep)
    return keep(path) ? [path] : []
  })
}

export function analyze(
  rendererRoot: string,
  repositoryRoot: string,
  kinds: readonly string[] = PRESET_KINDS,
): Refusal[] {
  return filesUnder(rendererRoot, (path) => /\.(tsx?|css)$/.test(path)).flatMap((file) =>
    refusalsOf(
      relative(repositoryRoot, file).replaceAll('\\', '/'),
      readFileSync(file, 'utf8'),
      kinds,
    ),
  )
}

if (import.meta.main) {
  const repository = resolve(import.meta.dirname, '..')
  const kinds = presetKindsOf(readFileSync(join(repository, MOTION_PRESET), 'utf8'))
  const refusals = [
    join(repository, 'apps', 'desktop', 'src', 'renderer'),
    join(repository, 'packages', 'ui', 'src'),
  ].flatMap((root) => analyze(root, repository, kinds))
  for (const refusal of refusals) {
    console.error(`${refusal.file}: "${refusal.property}" ${refusal.problem}`)
  }
  console.log(
    refusals.length === 0
      ? "the renderer and the design system move by the preset's kinds and nothing else"
      : `${refusals.length} movement(s) decided outside ${MOTION_PRESET}`,
  )
  if (refusals.length > 0) process.exit(1)
}
