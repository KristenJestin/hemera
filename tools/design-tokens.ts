#!/usr/bin/env bun
/**
 * Refuses raw visual values outside the primitive token layer (design-system spec).
 *
 * A literal colour or a dimension that belongs to no closed scale is reported with its file,
 * its line and the token that should carry it. Only `packages/ui/src/tokens/primitives.ts`
 * may hold literals.
 *
 *   bun tools/design-tokens.ts
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

export interface TokenViolation {
  file: string
  line: number
  value: string
  problem: string
}

/** Directories where no raw visual value is accepted. */
const SCANNED = [
  'apps/desktop/src',
  'packages/ui/src/components',
  'packages/ui/src/primitives',
  'packages/ui/src/theme',
  'packages/ui/src/shell',
]

/** The single file allowed to hold literals. */
const EXEMPT = 'packages/ui/src/tokens/primitives.ts'

const COLOUR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\s*\(/g

/** The closed scale each style property draws from, so a report names the right one. */
const SCALES: { name: string; steps: number[]; properties: string[] }[] = [
  {
    name: 'the text size scale',
    steps: [11, 12, 13, 14, 16, 20, 26],
    properties: ['fontSize'],
  },
  {
    name: 'the radius scale',
    steps: [4, 6, 8, 12, 16, 999],
    properties: [
      'borderRadius',
      'borderTopLeftRadius',
      'borderTopRightRadius',
      'borderBottomLeftRadius',
      'borderBottomRightRadius',
    ],
  },
  {
    name: 'the spacing scale',
    steps: [0, 2, 4, 6, 8, 12, 16, 24, 32, 40],
    properties: [
      'padding',
      'paddingTop',
      'paddingRight',
      'paddingBottom',
      'paddingLeft',
      'margin',
      'marginTop',
      'marginRight',
      'marginBottom',
      'marginLeft',
      'gap',
      'rowGap',
      'columnGap',
      'top',
      'right',
      'bottom',
      'left',
    ],
  },
  {
    name: 'the border width scale',
    steps: [0, 1, 2],
    properties: [
      'borderWidth',
      'borderTopWidth',
      'borderRightWidth',
      'borderBottomWidth',
      'borderLeftWidth',
    ],
  },
  {
    name: 'the elevation tokens',
    steps: [0, 1, 2, 6, 12, 14, 18, 32, 40],
    properties: ['blurRadius', 'spreadRadius', 'offsetX', 'offsetY'],
  },
  {
    name: 'the component and shell tokens',
    steps: [
      // 1 is the separator rule thickness.
      0, 1, 2, 4, 6, 8, 12, 14, 16, 18, 20, 24, 28, 32, 40, 44, 58, 180, 248, 420, 980, 999,
    ],
    properties: ['width', 'height', 'minWidth', 'minHeight', 'maxWidth', 'maxHeight'],
  },
]

const DIMENSION_PROPERTIES = SCALES.flatMap((scale) => scale.properties)

const DIMENSION = new RegExp(
  `\\b(${DIMENSION_PROPERTIES.join('|')})\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`,
  'g',
)

function scaleOf(property: string): { name: string; steps: number[] } {
  const found = SCALES.find((scale) => scale.properties.includes(property))
  if (found === undefined) throw new Error(`no scale declared for the property ${property}`)
  return found
}

/** Every dimension a token scale expresses, whatever the property. */
export function allowedDimensions(): number[] {
  return [...new Set(SCALES.flatMap((scale) => scale.steps))].toSorted((a, b) => a - b)
}

function nearestSteps(steps: number[], value: number): string {
  const sorted = steps.toSorted((a, b) => a - b)
  const below = sorted.filter((step) => step < value).at(-1)
  const above = sorted.find((step) => step > value)
  if (below !== undefined && above !== undefined) return `${below} and ${above}`
  return below === undefined ? `${above}` : `${below}`
}

function sourceFilesOf(directory: string): string[] {
  if (!existsSync(directory)) return []
  const found: string[] = []
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) {
      found.push(...sourceFilesOf(path))
    } else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
      found.push(path)
    }
  }
  return found
}

/** Drops comments so a value quoted in prose is not reported as code. */
export function withoutComments(source: string): string {
  return source
    .replaceAll(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n')
}

export function analyzeTokens(repositoryRoot: string): TokenViolation[] {
  const violations: TokenViolation[] = []
  for (const directory of SCANNED) {
    for (const file of sourceFilesOf(resolve(repositoryRoot, directory))) {
      const reported = relative(repositoryRoot, file).replaceAll('\\', '/')
      if (reported === EXEMPT) continue
      const lines = withoutComments(readFileSync(file, 'utf8')).split('\n')

      for (const [index, line] of lines.entries()) {
        COLOUR.lastIndex = 0
        let colour = COLOUR.exec(line)
        while (colour !== null) {
          violations.push({
            file: reported,
            line: index + 1,
            value: colour[0],
            problem:
              'literal colour; read a semantic colour token from the theme ' +
              '(theme.colors.*) instead',
          })
          colour = COLOUR.exec(line)
        }

        DIMENSION.lastIndex = 0
        let dimension = DIMENSION.exec(line)
        while (dimension !== null) {
          const property = dimension[1]!
          const value = Number.parseFloat(dimension[2]!)
          const scale = scaleOf(property)
          if (!scale.steps.includes(value)) {
            violations.push({
              file: reported,
              line: index + 1,
              value: `${property}: ${value}`,
              problem:
                `dimension outside ${scale.name}; ` +
                `nearest steps are ${nearestSteps(scale.steps, value)}`,
            })
          }
          dimension = DIMENSION.exec(line)
        }
      }
    }
  }
  return violations
}

if (import.meta.main) {
  const repositoryRoot = resolve(import.meta.dir, '..')
  const violations = analyzeTokens(repositoryRoot)
  for (const violation of violations) {
    console.error(`${violation.file}:${violation.line}: "${violation.value}" ${violation.problem}`)
  }
  console.log(
    violations.length === 0
      ? 'every visual value comes from a token'
      : `${violations.length} raw visual values`,
  )
  if (violations.length > 0) process.exit(1)
}
