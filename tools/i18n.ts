#!/usr/bin/env bun
/**
 * Checks that the desktop application keeps its user-visible strings in translation
 * resources: no literal text in a component, and every requested key exists in the only
 * locale shipped.
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
const TRANSLATION_CALL = /\bt\(\s*'([^']+)'\s*\)/g

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
  const resourceRoot = join(desktopSource, 'i18n')

  for (const file of sourceFilesOf(desktopSource)) {
    if (file.startsWith(resourceRoot)) continue
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

      TRANSLATION_CALL.lastIndex = 0
      let call = TRANSLATION_CALL.exec(line)
      while (call !== null) {
        const key = call[1]!
        if (!knownKeys.has(key)) {
          violations.push({
            file: reported,
            line: index + 1,
            problem: `translation key "${key}" is missing from the loaded locale`,
          })
        }
        call = TRANSLATION_CALL.exec(line)
      }
    }
  }
  return violations
}

if (import.meta.main) {
  const repositoryRoot = resolve(import.meta.dir, '..')
  const { en } = await import(
    join(repositoryRoot, 'apps', 'desktop', 'src', 'i18n', 'resources', 'en.ts')
  )
  const violations = analyzeI18n(repositoryRoot, new Set(Object.keys(en)))
  for (const violation of violations) {
    console.error(`${violation.file}:${violation.line}: ${violation.problem}`)
  }
  console.log(
    violations.length === 0
      ? 'every visible string comes from the translation resources'
      : `${violations.length} i18n violations`,
  )
  if (violations.length > 0) process.exit(1)
}
