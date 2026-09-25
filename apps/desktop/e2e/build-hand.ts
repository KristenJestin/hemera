/**
 * What the build suites read and press (lot 22).
 *
 * Not a spec file — `wdio.conf.ts` takes `*.e2e.ts` and this is not one. It reads a build as the
 * engine holds it, through the bridge, and presses a button by its exact words: a build view says
 * "Done" on a button and on the rows of the tasks that are, and only the button says nothing else.
 */

import { browser, expect } from '@wdio/globals'

/** A build as the engine holds it, by task label: what the suites check. */
export interface BuildNow {
  readonly phase: string
  readonly paused: boolean
  readonly canAccept: boolean
  readonly specStatus: string
  /** Where each task stands. */
  readonly states: Readonly<Record<string, string>>
  /** How each of a task's tries ended, in order; null while one runs. */
  readonly tries: Readonly<Record<string, readonly (string | null)[]>>
  /** Whether each task was ever handed to the agent. */
  readonly handed: Readonly<Record<string, boolean>>
}

/** The build of the Spec of this key, in the Project `Atlas`, read through the bridge. */
export async function buildNow(key: string): Promise<BuildNow> {
  return await browser.execute(async (wanted: string) => {
    const projects = await window.hemera.invoke('projects.list', {})
    const projectId = projects.find((one) => one.name === 'Atlas')?.id ?? ''
    const specs = await window.hemera.invoke('specs.list', { projectId })
    const spec = specs.find((one) => one.key === wanted)
    const sessions = await window.hemera.invoke('sessions.list', { projectId })
    const session = sessions.find((one) => one.mission === 'build' && one.specId === spec?.id)
    const view = await window.hemera.invoke('build.read', { sessionId: session?.id ?? '' })
    return {
      phase: view.phase,
      paused: view.pausedAt !== null,
      canAccept: view.canAccept,
      specStatus: spec?.status ?? '',
      states: Object.fromEntries(view.tasks.map((task) => [task.label, task.state])),
      tries: Object.fromEntries(
        view.tasks.map((task) => [task.label, task.attempts.map((attempt) => attempt.result)]),
      ),
      handed: Object.fromEntries(view.tasks.map((task) => [task.label, task.handedAt !== null])),
    }
  }, key)
}

/** Presses the button whose words are exactly these, and says so when there is none. */
export async function pressExactly(words: string): Promise<void> {
  const pressed = await browser.execute((said: string) => {
    const button = [...document.querySelectorAll('button')].find(
      (one) => (one.textContent ?? '').trim() === said,
    )
    if (button === undefined) return false
    button.click()
    return true
  }, words)
  expect(pressed).toBe(true)
  await browser.pause(300)
}
