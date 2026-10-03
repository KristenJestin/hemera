/**
 * What the catalogue claims about itself, read off its story files: where a story shows in the
 * sidebar, what it is called, and that no story file writes what Git decides.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, test } from 'vite-plus/test'

const designSystem = join(import.meta.dirname, '..', 'src')
const components = join(designSystem, 'components')
const preview = readFileSync(join(import.meta.dirname, '..', '.storybook', 'preview.tsx'), 'utf8')

function filesUnder(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry)
    return statSync(path).isDirectory() ? filesUnder(path) : [path]
  })
}

const STORY_FILES = filesUnder(designSystem).filter((path) => path.endsWith('.stories.tsx'))

/** The title a story file files itself under. */
function titleOf(source: string): string | null {
  return /\btitle:\s*'([^']+)'/.exec(source)?.[1] ?? null
}

/** The names of the stories a file exports. */
function storiesOf(source: string): string[] {
  return [...source.matchAll(/^export const (\w+): Story\b/gm)].map((match) => match[1]!)
}

/** The tags a story file declares in its meta. */
function tagsOf(source: string): string[] {
  const tags = /\btags:\s*\[([^\]]*)\]/.exec(source)?.[1] ?? ''
  return [...tags.matchAll(/'([^']+)'/g)].map((match) => match[1]!)
}

describe('Every primitive is drawn in the catalogue', () => {
  test('every folder of components holds the stories of what it draws', () => {
    const folders = readdirSync(components)
    const missing = folders.filter(
      (folder) =>
        !readdirSync(join(components, folder)).some((file) => file.endsWith('.stories.tsx')),
    )
    expect(missing).toEqual([])
  })
})

describe('The roots of the catalogue', () => {
  test('the sort gives the roots in their order, and the alphabet inside them', () => {
    expect(preview).toContain(
      "order: ['Foundations', 'Components', 'Blocks', 'Surfaces', 'Shell', 'Explorations']",
    )
    expect(preview).toContain("method: 'alphabetical'")
  })

  test('a primitive is filed flat under Components, by one name', () => {
    const misfiled = STORY_FILES.filter((path) => path.startsWith(components))
      .map((path) => [relative(designSystem, path), titleOf(readFileSync(path, 'utf8'))] as const)
      .filter(([, title]) => title === null || !/^Components\/[A-Z][A-Za-z]*$/.test(title))
    expect(misfiled).toEqual([])
  })
})

describe('One story per state, named after the state', () => {
  test.each(STORY_FILES.map((path) => [relative(designSystem, path), path]))(
    '%s names its stories after states, not after a gallery',
    (_name, path) => {
      const stories = storiesOf(readFileSync(path, 'utf8'))
      expect(stories.length).toBeGreaterThan(0)
      for (const gallery of ['Playground', 'Variants', 'States', 'Keyboard']) {
        expect(stories).not.toContain(gallery)
      }
    },
  )
})

describe('Badges computed from Git', () => {
  test('a story file declares no tag but autodocs, and no badge by hand', () => {
    const tagged = STORY_FILES.map(
      (path) => [relative(designSystem, path), tagsOf(readFileSync(path, 'utf8'))] as const,
    ).filter(([, tags]) => tags.join() !== 'autodocs')
    expect(tagged).toEqual([])
  })

  test('no story pins a theme of its own: the theme is the toolbar’s, and the runner’s', () => {
    const pinned = STORY_FILES.filter((path) =>
      /globals:\s*\{[^}]*theme/.test(readFileSync(path, 'utf8')),
    )
    expect(pinned).toEqual([])
  })
})
