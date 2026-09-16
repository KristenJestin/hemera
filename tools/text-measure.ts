#!/usr/bin/env node
/**
 * Checks that nothing sizes a zone by measuring text (design D2-07).
 *
 * A width read off a rendered string is a width that depends on the font the system actually
 * loaded, on the scale factor the display is at, and on the language the interface is in. It
 * is also a layout the browser has to finish before the answer exists, which is how a smooth
 * interface acquires a stutter nobody can reproduce. Everything here is sized by the theme
 * instead, and this check is what keeps it that way.
 *
 * Tests and stories are exempt: measuring is exactly what a test does to find out whether the
 * theme produced the size it claimed. The sidebar's separator is exempt too, by name — what it
 * reads is where the pointer is, which is not text and is not a layout.
 *
 *   node tools/text-measure.ts
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

/** What a file asks the browser when it wants to know how big something came out. */
export const MEASUREMENTS = ['getBoundingClientRect', 'offsetWidth', 'offsetHeight', 'measureText']

/** The same question asked the long way round, which is the one a lint usually misses. */
const COMPUTED_SIZE = /getComputedStyle\([\s\S]*?\)\s*\.\s*(width|height)/g

/**
 * The one file allowed to ask the browser about a position, and why.
 *
 * The separator follows the pointer, and the pointer is not text: reading where a hand is has
 * none of the costs above. It is named here rather than left to a comment so that the day it
 * starts measuring something else, this list is where the argument happens.
 */
export const MEASURE_EXCEPTIONS = ['packages/ui/src/shell/gutter.tsx']

export interface Refusal {
  file: string
  measure: string
  problem: string
}

/** Whether a file is one of the places measuring is the point rather than the mistake. */
function exempt(file: string): boolean {
  return (
    /\.test\.tsx?$/.test(file) || /\.stories\.tsx$/.test(file) || MEASURE_EXCEPTIONS.includes(file)
  )
}

export function refusalsOf(file: string, source: string): Refusal[] {
  if (exempt(file)) return []
  const refusals: Refusal[] = []
  for (const measurement of MEASUREMENTS) {
    if (source.includes(measurement)) {
      refusals.push({
        file,
        measure: measurement,
        problem: 'sizes a zone by measuring, where the theme is what decides a size',
      })
    }
  }
  COMPUTED_SIZE.lastIndex = 0
  let computed = COMPUTED_SIZE.exec(source)
  while (computed !== null) {
    refusals.push({
      file,
      measure: `getComputedStyle(...).${computed[1]!}`,
      problem: 'reads back a size the theme already decided',
    })
    computed = COMPUTED_SIZE.exec(source)
  }
  return refusals
}

function sourceFilesOf(directory: string): string[] {
  if (!existsSync(directory)) return []
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) return sourceFilesOf(path)
    return /\.tsx?$/.test(entry) ? [path] : []
  })
}

export function analyze(root: string, repositoryRoot: string): Refusal[] {
  return sourceFilesOf(root).flatMap((file) =>
    refusalsOf(relative(repositoryRoot, file).replaceAll('\\', '/'), readFileSync(file, 'utf8')),
  )
}

if (import.meta.main) {
  const repository = resolve(import.meta.dirname, '..')
  const refusals = [
    join(repository, 'packages', 'ui', 'src'),
    join(repository, 'apps', 'desktop', 'src', 'renderer'),
  ].flatMap((root) => analyze(root, repository))
  for (const refusal of refusals) {
    console.error(`${refusal.file}: "${refusal.measure}" ${refusal.problem}`)
  }
  console.log(
    refusals.length === 0
      ? 'nothing in the shell or the design system sizes itself by measuring text'
      : `${refusals.length} measurement(s) of text where the theme decides the size`,
  )
  if (refusals.length > 0) process.exit(1)
}
