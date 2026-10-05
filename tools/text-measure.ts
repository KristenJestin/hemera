#!/usr/bin/env node
/**
 * Checks that nothing sizes a zone by measuring text.
 *
 * A width read off a rendered string depends on the font the system loaded, on the scale factor
 * of the display and on the language of the interface, and it is a layout the browser has to
 * finish before the answer exists: that is how a smooth interface acquires a stutter nobody can
 * reproduce. Everything is sized by the theme instead, and this check keeps it that way.
 *
 * Tests and stories are exempt: measuring is what a test does to find out whether the theme
 * produced the size it claimed. So is a `*-fixtures.tsx` beside them, a story's own machine split
 * out of the story file so that several stories can be shown the same one.
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
 * The files allowed to ask the browser about a box, and why. None of them sizes a zone by what it
 * reads; each follows a box the theme already laid out.
 *
 * - The sliding mark reads where the chosen item of its list is, to put a shape over it and then
 *   over the next: anything that follows a moving target measures it.
 * - `useHand` reads the box of the control it is handed, to work out the share of itself that
 *   brings its edges in by the same distance whatever its size.
 * - The body of a dialog grows and folds to what it holds: the height it reads is one it follows,
 *   never one it decides.
 * - The mention field reads where the `@` being typed is drawn, to hang its menu there: it follows
 *   a moving target, as the sliding mark does, and sizes nothing.
 */
export const MEASURE_EXCEPTIONS = [
  'packages/ui/src/components/sliding-mark/sliding-mark.tsx',
  'packages/ui/src/motion.ts',
  'packages/ui/src/components/dialog/dialog.tsx',
  'packages/ui/src/components/mention-field/caret.ts',
]

export interface Refusal {
  file: string
  measure: string
  problem: string
}

/** Whether a file is one of the places measuring is the point rather than the mistake. */
function exempt(file: string): boolean {
  return (
    /\.test\.tsx?$/.test(file) ||
    /\.stories\.tsx$/.test(file) ||
    /-fixtures\.tsx$/.test(file) ||
    MEASURE_EXCEPTIONS.includes(file)
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
      ? 'nothing in the renderer or the design system sizes itself by measuring text'
      : `${refusals.length} measurement(s) of text where the theme decides the size`,
  )
  if (refusals.length > 0) process.exit(1)
}
