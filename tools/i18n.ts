#!/usr/bin/env bun
/**
 * Checks that the desktop application keeps its user-visible strings in the message
 * catalogue: no literal text in a component, every message called exists, and the compiled
 * messages match the catalogue they were compiled from.
 *
 *   bun tools/i18n.ts
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

export interface I18nViolation {
  file: string
  line: number
  problem: string
}

/** Props whose value is rendered to the user. */
const TEXT_PROPS = ['label', 'title', 'placeholder', 'text', 'caption', 'heading', 'message']

const JSX_TEXT = />([^<>{}\n][^<>{}]*)</g
const TEXT_PROP = new RegExp(`\\b(${TEXT_PROPS.join('|')})=(['"])([^'"]+)\\2`, 'g')
const MESSAGE_CALL = /\bm\.([a-z0-9_]+)\(/g

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

/** True when a JSX text run is punctuation or whitespace rather than a sentence. */
function isDecorative(text: string): boolean {
  return !/[A-Za-z]{2}/.test(text)
}

export function analyzeI18n(repositoryRoot: string, knownKeys: Set<string>): I18nViolation[] {
  const violations: I18nViolation[] = []
  const desktopSource = join(repositoryRoot, 'apps', 'desktop', 'src')
  const generatedRoot = join(desktopSource, 'paraglide')

  for (const file of sourceFilesOf(desktopSource)) {
    if (file.startsWith(generatedRoot)) continue
    const reported = relative(repositoryRoot, file).replaceAll('\\', '/')
    const lines = readFileSync(file, 'utf8').split('\n')

    for (const [index, line] of lines.entries()) {
      for (const pattern of [JSX_TEXT, TEXT_PROP]) {
        pattern.lastIndex = 0
        let match = pattern.exec(line)
        while (match !== null) {
          const text = (pattern === JSX_TEXT ? match[1]! : match[3]!).trim()
          if (text.length > 0 && !isDecorative(text)) {
            violations.push({
              file: reported,
              line: index + 1,
              problem: `hard-coded visible text "${text}"; move it to a translation resource`,
            })
          }
          match = pattern.exec(line)
        }
      }

      MESSAGE_CALL.lastIndex = 0
      let call = MESSAGE_CALL.exec(line)
      while (call !== null) {
        const key = call[1]!
        if (!knownKeys.has(key)) {
          violations.push({
            file: reported,
            line: index + 1,
            problem: `message "${key}" is missing from the catalogue`,
          })
        }
        call = MESSAGE_CALL.exec(line)
      }
    }
  }
  return violations
}

/** The messages the catalogue declares, by their compiled name. */
export function catalogueOf(repositoryRoot: string): Set<string> {
  const path = join(repositoryRoot, 'apps', 'desktop', 'messages', 'en.json')
  const catalogue = JSON.parse(readFileSync(path, 'utf8')) as Record<string, string>
  return new Set(Object.keys(catalogue).filter((key) => !key.startsWith('$')))
}

/**
 * Messages the catalogue declares and the compiled output does not carry.
 *
 * The compiled folder is not committed — the compiler rewrites a `.gitignore` into it on
 * every run — so it is built by `i18n:compile`, which `typecheck` and `test` depend on. What
 * this catches is the folder being stale: a catalogue edited without recompiling leaves the
 * application calling a message that is not there.
 */
export function staleMessages(repositoryRoot: string): string[] {
  const desktop = join(repositoryRoot, 'apps', 'desktop')
  const declared = catalogueOf(repositoryRoot)
  const compiledRoot = join(desktop, 'src', 'paraglide', 'messages')
  if (!existsSync(compiledRoot)) {
    return ['the messages were never compiled']
  }
  const compiled = new Set(
    readdirSync(compiledRoot)
      .filter((entry) => entry.endsWith('.js') && entry !== '_index.js')
      .map((entry) => entry.slice(0, -'.js'.length)),
  )
  return [
    ...[...declared]
      .filter((key) => !compiled.has(key))
      .map((key) => `${key}: declared, not compiled`),
    ...[...compiled]
      .filter((key) => !declared.has(key))
      .map((key) => `${key}: compiled, not declared`),
  ]
}

if (import.meta.main) {
  const repositoryRoot = resolve(import.meta.dir, '..')
  const stale = staleMessages(repositoryRoot)
  for (const message of stale) {
    console.error(`${message}; run "bun run i18n:compile" in apps/desktop`)
  }
  const violations = analyzeI18n(repositoryRoot, catalogueOf(repositoryRoot))
  for (const violation of violations) {
    console.error(`${violation.file}:${violation.line}: ${violation.problem}`)
  }
  console.log(
    violations.length === 0
      ? 'every visible string comes from the message catalogue'
      : `${violations.length} i18n violations`,
  )
  if (violations.length > 0 || stale.length > 0) process.exit(1)
}
