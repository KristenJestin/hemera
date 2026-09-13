#!/usr/bin/env bun
/**
 * Structural check of the component catalogue.
 *
 * A component is one folder holding four files: the styled component, its headless hook, its
 * keyboard test and its showcase entry. The hook carries behaviour only, and a component
 * without a demonstration is not delivered.
 *
 *   bun tools/components.ts
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

export interface ComponentViolation {
  component: string
  problem: string
}

/** Style properties a hook must never decide; those belong to the component. */
const VISUAL_KEYS = [
  'backgroundColor',
  'borderColor',
  'borderRadius',
  'boxShadow',
  'color',
  'fontSize',
  'fontWeight',
  'opacity',
  'padding',
  'height',
  'width',
]

/** What tells a component apart as one the keyboard drives. */
const INTERACTIVE = /onPress|onSelect|onKeyDown|onValueChange|onSubmit|tabIndex/

/** What the keyboard test of an interactive component has to exercise. */
const KEYBOARD_PROOFS = [
  { pattern: /focus\(/, proof: 'focus' },
  {
    // Either through the renderer, or through the headless behaviour the component uses.
    pattern: /nativeSimulateKeystrokes|simulateKeystrokes|onKeyDown\(|\.send\(|onSubmit/,
    proof: 'activation',
  },
]

function componentsRoot(repositoryRoot: string): string {
  return join(repositoryRoot, 'packages', 'ui', 'src', 'components')
}

/** Folder names of the catalogue, in alphabetical order. */
export function catalogueFolders(repositoryRoot: string): string[] {
  const root = componentsRoot(repositoryRoot)
  if (!existsSync(root)) return []
  return readdirSync(root).filter((entry) => statSync(join(root, entry)).isDirectory())
}

/** Component name a folder stands for, such as `icon-button` giving `IconButton`. */
export function componentNameOf(folder: string): string {
  return folder
    .split('-')
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join('')
}

export function analyzeComponents(repositoryRoot: string): ComponentViolation[] {
  const violations: ComponentViolation[] = []
  const root = componentsRoot(repositoryRoot)
  const registry = existsSync(join(root, 'showcase.ts'))
    ? readFileSync(join(root, 'showcase.ts'), 'utf8')
    : ''

  for (const folder of catalogueFolders(repositoryRoot)) {
    const component = componentNameOf(folder)
    for (const file of [
      `${folder}.tsx`,
      `use-${folder}.ts`,
      `${folder}.test.tsx`,
      `${folder}.showcase.tsx`,
    ]) {
      if (!existsSync(join(root, folder, file))) {
        violations.push({ component, problem: `is missing ${folder}/${file}` })
      }
    }

    const hook = join(root, folder, `use-${folder}.ts`)
    if (existsSync(hook)) {
      const source = readFileSync(hook, 'utf8')
      for (const key of VISUAL_KEYS) {
        if (new RegExp(`\\b${key}\\s*:`).test(source)) {
          violations.push({
            component,
            problem: `declares the visual value "${key}" in its hook; it belongs to the component`,
          })
        }
      }
    }

    const test = join(root, folder, `${folder}.test.tsx`)
    const surface = join(root, folder, `${folder}.tsx`)
    const interactive = existsSync(surface) && INTERACTIVE.test(readFileSync(surface, 'utf8'))
    if (interactive && existsSync(test)) {
      const source = readFileSync(test, 'utf8')
      for (const { pattern, proof } of KEYBOARD_PROOFS) {
        if (!pattern.test(source)) {
          violations.push({
            component,
            problem: `has no ${proof} in its keyboard test`,
          })
        }
      }
    }

    const painted = join(root, folder, `${folder}.tsx`)
    if (existsSync(painted)) {
      const source = readFileSync(painted, 'utf8')
      // A controlled component receives its value; it never keeps a copy of a prop.
      for (const match of source.matchAll(/useState(?:<[^>]*>)?\(\s*([a-zA-Z]\w*)\s*\)/g)) {
        const prop = match[1]
        if (prop !== undefined && new RegExp(String.raw`^\s*${prop}[,:?]`, 'm').test(source)) {
          violations.push({
            component,
            problem: `keeps the prop "${prop}" in its own state instead of leaving it to the caller`,
          })
        }
      }
    }

    const entry = `${folder.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())}Showcase`
    if (!registry.includes(entry)) {
      violations.push({ component, problem: 'has no entry in the showcase registry' })
    }
  }
  return violations
}

/** Marks of the HTML prototype, which is a token reference and never a source of markup. */
const PROTOTYPE_MARKS = [
  { pattern: /className\s*=/, mark: 'a class name' },
  { pattern: /style\s*=\s*"/, mark: 'an inline style string' },
  { pattern: /<(section|header|aside|nav|span|p)\b/, mark: 'a markup tag of the prototype' },
]

/** Every component the design system paints, by the name it is exported under. */
function deliveredNames(repositoryRoot: string): Set<string> {
  const names = new Set<string>()
  const root = join(repositoryRoot, 'packages', 'ui', 'src')
  const walk = (directory: string): void => {
    if (!existsSync(directory)) return
    for (const entry of readdirSync(directory)) {
      const path = join(directory, entry)
      if (statSync(path).isDirectory()) {
        walk(path)
        continue
      }
      if (!/\.tsx?$/.test(path) || /\.test\.tsx?$/.test(path)) continue
      for (const match of readFileSync(path, 'utf8').matchAll(
        /^export (?:function|const) ([A-Z]\w*)/gm,
      )) {
        names.add(match[1]!)
      }
    }
  }
  walk(root)
  return names
}

function screenFilesOf(directory: string): string[] {
  if (!existsSync(directory)) return []
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) return screenFilesOf(path)
    return /\.tsx$/.test(path) && !/\.test\.tsx$/.test(path) ? [path] : []
  })
}

/**
 * Check of the screens that compose the catalogue.
 *
 * A screen uses the catalogue; it never defines its own copy of a component, never calls one
 * the catalogue does not deliver, and never carries markup copied from the prototype.
 */
export function analyzeScreens(repositoryRoot: string): ComponentViolation[] {
  const violations: ComponentViolation[] = []
  const delivered = new Set(catalogueFolders(repositoryRoot).map(componentNameOf))
  const exported = deliveredNames(repositoryRoot)

  for (const file of screenFilesOf(join(repositoryRoot, 'apps', 'desktop', 'src'))) {
    const source = readFileSync(file, 'utf8')
    const screen = relative(repositoryRoot, file).replaceAll('\\', '/')

    for (const match of source.matchAll(/^(?:export )?function ([A-Z]\w*)/gm)) {
      const name = match[1]!
      if (delivered.has(name)) {
        violations.push({
          component: name,
          problem: `is defined again in ${screen}; the catalogue already delivers it`,
        })
      }
    }

    const imported = /import\s*\{([^}]*)\}\s*from\s*'@hemera\/ui'/.exec(source)
    for (const name of (imported?.[1] ?? '').split(',').map((entry) => entry.trim())) {
      if (!/^[A-Z]/.test(name)) continue
      if (!exported.has(name)) {
        violations.push({
          component: name,
          problem: `is used by ${screen} but the design system delivers no such component`,
        })
      }
    }

    for (const { pattern, mark } of PROTOTYPE_MARKS) {
      if (pattern.test(source)) {
        violations.push({
          component: screen,
          problem: `carries ${mark} of the prototype instead of primitives and tokens`,
        })
      }
    }
  }
  return violations
}

if (import.meta.main) {
  const repositoryRoot = resolve(import.meta.dir, '..')
  const violations = [...analyzeComponents(repositoryRoot), ...analyzeScreens(repositoryRoot)]
  for (const violation of violations) {
    console.error(`${violation.component} ${violation.problem}`)
  }
  console.log(
    violations.length === 0
      ? `catalogue complete: ${catalogueFolders(repositoryRoot).length} components`
      : `${violations.length} catalogue defects`,
  )
  if (violations.length > 0) process.exit(1)
}
