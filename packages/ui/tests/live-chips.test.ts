/**
 * What the chips of the catalogue promise, read off their sources: a LiveChip is drawn for a run
 * that goes on, so pressing it always opens something (its glance), or does something (its press).
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, test } from 'vite-plus/test'

const designSystem = join(import.meta.dirname, '..', 'src')

function filesUnder(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry)
    return statSync(path).isDirectory() ? filesUnder(path) : [path]
  })
}

/** The files that draw a chip: not its own, not its stories. */
const DRAWING = filesUnder(designSystem).filter(
  (path) =>
    path.endsWith('.tsx') &&
    !path.endsWith('.stories.tsx') &&
    !path.includes(join('components', 'live-chip')),
)

/** The JSX of every `<LiveChip` in a source, up to its closing `/>`. */
function chipsOf(source: string): string[] {
  return [...source.matchAll(/<LiveChip\b[\s\S]*?\n\s*\/>/g)].map((match) => match[0])
}

describe('Every LiveChip drawn for a run opens something', () => {
  const drawn = DRAWING.flatMap((path) =>
    chipsOf(readFileSync(path, 'utf8')).map((chip) => ({
      file: relative(designSystem, path),
      chip,
    })),
  )

  test('the chips are found', () => {
    expect(drawn.length).toBeGreaterThan(0)
  })

  test('each is given a glance or a press', () => {
    const mute = drawn.filter(({ chip }) => !/\bglance=/.test(chip) && !/\bonPress=/.test(chip))
    expect(mute.map(({ file }) => file)).toEqual([])
  })
})
