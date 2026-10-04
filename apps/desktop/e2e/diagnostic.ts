/** What the application wrote in the diagnostic of the profile a spec file runs on. */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { browser } from '@wdio/globals'

import { e2eProfileOf } from '../wdio.conf.ts'

/** Every line of the diagnostic so far; none when the application has not written one yet. */
export function diagnosticOf(spec: string): string[] {
  try {
    return readFileSync(join(e2eProfileOf(spec), 'diagnostic.log'), 'utf8')
      .trimEnd()
      .split('\n')
  } catch {
    return []
  }
}

/** How many lines of the diagnostic match `pattern`. */
export function countOf(spec: string, pattern: RegExp): number {
  return diagnosticOf(spec).filter((line) => pattern.test(line)).length
}

/** Waits until the diagnostic has `count` lines matching `pattern`. */
export async function waitForLines(spec: string, pattern: RegExp, count: number): Promise<void> {
  await browser.waitUntil(() => countOf(spec, pattern) >= count, {
    timeout: 15_000,
    timeoutMsg: `the diagnostic never had ${String(count)} lines matching ${String(pattern)}`,
  })
}

/** What the window says of the engine: starting, late, ready or stopped. */
export async function engineOfPage(): Promise<string | null> {
  return browser.$('#root > [data-engine]').getAttribute('data-engine')
}

/** Marks the page that is loaded now, so a wait can tell it from the next one. */
export async function markPage(): Promise<void> {
  await browser.execute(() => Object.assign(window, { hemeraPreviousPage: true }))
}

/** Waits for a page other than the marked one to have heard from the engine. */
export async function waitForNewPage(): Promise<void> {
  await browser.waitUntil(
    async () =>
      (await browser.execute(() => !Reflect.has(window, 'hemeraPreviousPage'))) &&
      (await engineOfPage()) === 'ready',
    { timeout: 30_000, timeoutMsg: 'no new page heard from the engine' },
  )
}

/** Waits for the window to say the engine answered. */
export async function waitForEngine(): Promise<void> {
  await browser.waitUntil(async () => (await engineOfPage()) === 'ready', {
    timeout: 30_000,
    timeoutMsg: 'the window never heard from the engine',
  })
}
