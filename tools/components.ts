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
import { join, resolve } from 'node:path'

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

    const entry = `${folder.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())}Showcase`
    if (!registry.includes(entry)) {
      violations.push({ component, problem: 'has no entry in the showcase registry' })
    }
  }
  return violations
}

if (import.meta.main) {
  const repositoryRoot = resolve(import.meta.dir, '..')
  const violations = analyzeComponents(repositoryRoot)
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
