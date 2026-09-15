#!/usr/bin/env node
/**
 * Checks what the renderer animates (design D0-06).
 *
 * Only the four properties a compositor can animate on its own are allowed: transform (and
 * the shorthands motion gives it), opacity, filter and clip-path. Animating a width, a margin
 * or a colour asks the main thread to lay the page out again on every frame, which is the
 * difference between a transition at the refresh rate and one that misses.
 *
 *   node tools/motion-properties.ts
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

/** What a compositor animates without laying the page out again. */
export const ALLOWED_PROPERTIES = [
  'opacity',
  'filter',
  'backdropFilter',
  'backdrop-filter',
  'clipPath',
  'clip-path',
  'transform',
  // `translate` beside the shorthand: Tailwind 4 writes its transform utilities as the
  // individual properties, and a compositor carries those exactly as it carries `transform`.
  // `scale` and `rotate` are already below, where motion's own names are.
  'translate',
  'x',
  'y',
  'z',
  'rotate',
  'rotateX',
  'rotateY',
  'rotateZ',
  'scale',
  'scaleX',
  'scaleY',
  'skew',
  'skewX',
  'skewY',
  'translateX',
  'translateY',
  'translateZ',
  'transformPerspective',
  'originX',
  'originY',
  'originZ',
  'transition',
] as const

/** Props of a motion component that carry the properties it animates. */
const ANIMATED_PROPS = ['initial', 'animate', 'exit', 'whileHover', 'whileTap', 'whileFocus']

/** The one file allowed to write spring numbers: the preset every animation reads (D1-04). */
export const MOTION_PRESET = 'packages/ui/src/motion.ts'

/** The one file allowed to write durations in CSS: the theme they are a scale of (D1-01). */
export const MOTION_THEME = 'packages/ui/src/theme.css'

/** What a spring is made of. Written twice, a personality is no longer one. */
const SPRING_PARAMETER = /\b(stiffness|damping|mass|bounce|restDelta|restSpeed)\s*:\s*[-\d.]/g

/** Timings a component asks motion for in numbers instead of reading them off the scale. */
const LITERAL_TIMING = /\b(duration|delay|repeatDelay|staggerChildren|delayChildren)\s*:\s*[-\d.]/g

/** A time written in a stylesheet, which the theme's duration tokens exist to replace. */
const CSS_TIME = /(?<![\w-])\d+(?:\.\d+)?m?s(?![\w-])/g

export interface Refusal {
  file: string
  property: string
  problem: string
}

/**
 * Motion values a file of the design system writes itself instead of reading them from the
 * preset and the theme. The preset and the theme are where those numbers live; anywhere else
 * they are a second personality that nobody decided on.
 */
export function hardcodedOf(file: string, source: string): Refusal[] {
  const refusals: Refusal[] = []
  const inDesignSystem = file.startsWith('packages/ui/')

  if (file !== MOTION_PRESET) {
    for (const pattern of [SPRING_PARAMETER, LITERAL_TIMING]) {
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

function filesUnder(directory: string, keep: (path: string) => boolean): string[] {
  if (!existsSync(directory)) return []
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) return filesUnder(path, keep)
    return keep(path) ? [path] : []
  })
}

const KEY = /([A-Za-z-]+)\s*:/g

/** Properties a component asks motion to animate, whatever prop it asks through. */
export function animatedPropertiesOf(source: string): string[] {
  const properties: string[] = []
  for (const prop of ANIMATED_PROPS) {
    const block = new RegExp(`${prop}=\\{\\{([^}]*)\\}\\}`, 'g')
    let found = block.exec(source)
    while (found !== null) {
      KEY.lastIndex = 0
      let key = KEY.exec(found[1]!)
      while (key !== null) {
        properties.push(key[1]!)
        key = KEY.exec(found[1]!)
      }
      found = block.exec(source)
    }
  }
  return properties
}

const TRANSITION_PROPERTY = /transition(?:-property)?\s*:\s*([^;]+);/g
const KEYFRAMES = /@keyframes[^{]*\{([\s\S]*?)\n\}/g

/** Properties a stylesheet animates, through a transition or a keyframe. */
export function animatedStyleOf(source: string): string[] {
  const properties: string[] = []

  TRANSITION_PROPERTY.lastIndex = 0
  let transition = TRANSITION_PROPERTY.exec(source)
  while (transition !== null) {
    for (const part of transition[1]!.split(',')) {
      const name = part.trim().split(/\s+/)[0]
      if (name !== undefined && name !== '' && name !== 'all') properties.push(name)
      if (name === 'all') properties.push('all')
    }
    transition = TRANSITION_PROPERTY.exec(source)
  }

  KEYFRAMES.lastIndex = 0
  let frames = KEYFRAMES.exec(source)
  while (frames !== null) {
    KEY.lastIndex = 0
    let key = KEY.exec(frames[1]!)
    while (key !== null) {
      properties.push(key[1]!)
      key = KEY.exec(frames[1]!)
    }
    frames = KEYFRAMES.exec(source)
  }
  return properties
}

export function refusalsOf(file: string, source: string): Refusal[] {
  const animated = file.endsWith('.css') ? animatedStyleOf(source) : animatedPropertiesOf(source)
  return [
    ...animated
      .filter((property) => !ALLOWED_PROPERTIES.some((allowed) => allowed === property))
      .map((property) => ({
        file,
        property,
        problem:
          'is not a property a compositor animates; only transform, opacity, filter and clip-path are',
      })),
    ...hardcodedOf(file, source),
  ]
}

export function analyze(rendererRoot: string, repositoryRoot: string): Refusal[] {
  return filesUnder(rendererRoot, (path) => /\.(tsx?|css)$/.test(path)).flatMap((file) =>
    refusalsOf(relative(repositoryRoot, file).replaceAll('\\', '/'), readFileSync(file, 'utf8')),
  )
}

if (import.meta.main) {
  const repository = resolve(import.meta.dirname, '..')
  const refusals = [
    join(repository, 'apps', 'desktop', 'src', 'renderer'),
    join(repository, 'packages', 'ui', 'src'),
  ].flatMap((root) => analyze(root, repository))
  for (const refusal of refusals) {
    console.error(`${refusal.file}: "${refusal.property}" ${refusal.problem}`)
  }
  console.log(
    refusals.length === 0
      ? 'the renderer and the design system animate composited properties only, off the one preset'
      : `${refusals.length} animation(s) of a layout or colour property, or motion value written twice`,
  )
  if (refusals.length > 0) process.exit(1)
}
