#!/usr/bin/env node
/**
 * Checks what the application is allowed to ask the platform for (design D0-05).
 *
 * Every option refused here costs something real: an extra `webPreferences` entry loses the
 * warmed-up renderer, an ozone hint decides the graphics backend behind the report that is
 * supposed to observe it, and a sandbox flag gives up the isolation the lot exists to prove.
 * None of them announce themselves at runtime, so they are refused in the source.
 *
 *   node tools/window-options.ts
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

/** The only `webPreferences` entries the window may carry. */
export const ALLOWED_WEB_PREFERENCES = [
  'preload',
  'sandbox',
  'contextIsolation',
  'nodeIntegration',
  'backgroundThrottling',
  'spellcheck',
] as const

/** Window options that each cost the preloaded renderer or the default session. */
export const REFUSED_WINDOW_OPTIONS = [
  'additionalArguments',
  'enableBlinkFeatures',
  'disableBlinkFeatures',
  'experimentalFeatures',
  'offscreen',
  'partition',
] as const

/** Command line switches the application never adds, whatever the target. */
export const REFUSED_SWITCHES = [
  '--ozone-platform-hint',
  '--ozone-platform',
  '--no-sandbox',
  '--single-process',
  '--in-process-gpu',
  '--disable-gpu',
] as const

/** Platform variables the application never sets: the target decides, and the report reads. */
export const REFUSED_ENVIRONMENT = [
  'ELECTRON_OZONE_PLATFORM_HINT',
  'GDK_BACKEND',
  'QT_QPA_PLATFORM',
  'OZONE_PLATFORM',
  'XDG_SESSION_TYPE',
  'WAYLAND_DISPLAY',
  'DISPLAY',
] as const

export interface Refusal {
  file: string
  found: string
  problem: string
}

function sourceFilesOf(directory: string): string[] {
  if (!existsSync(directory)) return []
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) return sourceFilesOf(path)
    return /\.tsx?$/.test(entry) ? [path] : []
  })
}

const WEB_PREFERENCES = /webPreferences\s*:\s*\{([^}]*)\}/g
const OPTION_KEY = /([A-Za-z][A-Za-z0-9]*)\s*:/g
const APPEND_SWITCH = /commandLine\s*\.\s*append(?:Switch|Argument)/

/** The `webPreferences` keys a source file asks for, in the order it asks for them. */
export function webPreferenceKeys(source: string): string[] {
  const keys: string[] = []
  WEB_PREFERENCES.lastIndex = 0
  let block = WEB_PREFERENCES.exec(source)
  while (block !== null) {
    const body = block[1]!
    OPTION_KEY.lastIndex = 0
    let key = OPTION_KEY.exec(body)
    while (key !== null) {
      keys.push(key[1]!)
      key = OPTION_KEY.exec(body)
    }
    block = WEB_PREFERENCES.exec(source)
  }
  return keys
}

export function refusalsOf(file: string, source: string): Refusal[] {
  const refusals: Refusal[] = []
  const at = (found: string, problem: string): void => {
    refusals.push({ file, found, problem })
  }

  for (const key of webPreferenceKeys(source)) {
    if (!ALLOWED_WEB_PREFERENCES.some((allowed) => allowed === key)) {
      at(
        key,
        `is not one of the webPreferences D0-05 allows (${ALLOWED_WEB_PREFERENCES.join(', ')})`,
      )
    }
  }
  if (/nodeIntegration\s*:\s*true/.test(source)) {
    at('nodeIntegration: true', 'gives the renderer Node, which the lot exists to keep away')
  }
  for (const option of REFUSED_WINDOW_OPTIONS) {
    if (new RegExp(`\\b${option}\\s*:`).test(source)) {
      at(option, 'is a window option D0-05 refuses')
    }
  }
  if (APPEND_SWITCH.test(source)) {
    at('commandLine.appendSwitch', 'adds a Chromium switch; the target decides, not the code')
  }
  for (const flag of REFUSED_SWITCHES) {
    // Looked for as a string the code hands over, not as text: the environment report reads
    // the very same flags out of the GPU process command line, and reading is the opposite
    // of passing.
    if (new RegExp(`['"\`]${flag}`).test(source)) {
      at(flag, 'is a platform flag the application never passes')
    }
  }
  for (const variable of REFUSED_ENVIRONMENT) {
    if (new RegExp(`${variable}\\s*(?::|=|'\\s*\\]\\s*=)`).test(source)) {
      at(variable, 'is a platform variable the application never sets')
    }
  }
  return refusals
}

export function analyze(applicationRoot: string): Refusal[] {
  return sourceFilesOf(join(applicationRoot, 'src')).flatMap((file) =>
    refusalsOf(relative(applicationRoot, file).replaceAll('\\', '/'), readFileSync(file, 'utf8')),
  )
}

if (import.meta.main) {
  const application = resolve(import.meta.dirname, '..', 'apps', 'desktop')
  const refusals = analyze(application)
  for (const refusal of refusals) {
    console.error(`${refusal.file}: "${refusal.found}" ${refusal.problem}`)
  }
  console.log(
    refusals.length === 0
      ? 'the window asks the platform for nothing it should not'
      : `${refusals.length} refused window or platform options`,
  )
  if (refusals.length > 0) process.exit(1)
}
