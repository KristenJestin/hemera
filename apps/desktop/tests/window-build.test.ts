/**
 * A build as the window follows it, over the whole engine (design D8-13, D10-08, D10-11, D10-12).
 *
 * The page is drawn from the build store: what is under test is the road from the window to the
 * engine and back — a build asked for through `launches.request`, read through `build.read` with
 * the frozen revision it works from, followed through `build.changed`, the user's Done and Accept
 * sent through their channels — and the OS told once when a task becomes the user's. The agent is
 * the fake one, finishing every task it is handed.
 */

import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import type { BuildView } from '@hemera/ipc'

import {
  acceptBuild,
  buildSnapshot,
  closeBuild,
  doneTask,
  listenToBuilds,
  openBuild,
} from '#renderer/build-store.ts'
import { lineOf } from '#renderer/journal-lines.ts'

import { aReadySpec, buildAgent } from './build-harness.ts'
import { type OpenWindow, install, openWindow } from './window.ts'

let dataFolder: string
let opened: OpenWindow | null = null
let stop: () => void = () => undefined

beforeEach(() => {
  dataFolder = realpathSync.native(mkdtempSync(join(tmpdir(), 'hemera-window-build-')))
})

afterEach(async () => {
  stop()
  closeBuild()
  await opened?.close()
  opened = null
  rmSync(dataFolder, { recursive: true, force: true })
})

/** Waits in real time for the build on screen to be what is waited for, and answers it. */
async function until(ready: (view: BuildView) => boolean): Promise<BuildView> {
  for (let tries = 0; tries < 400; tries += 1) {
    const view = buildSnapshot().view
    if (view !== null && ready(view)) return view
    // oxlint-disable-next-line no-await-in-loop -- each look waits for the one before it: this is a poll
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`never came: ${JSON.stringify(buildSnapshot().view)}`)
}

const HUMAN = [
  { title: 'Write the exporter' },
  { title: 'Sign the export format', executor: 'human' as const },
  { title: 'Publish it', dependsOn: ['Sign the export format'] },
]

describe('A human task waits for the user', () => {
  test('asked for from the window, the build hands the user their task, told once, and Done moves it on to Accept', async () => {
    const { agent } = buildAgent()
    opened = await openWindow(dataFolder, agent)
    install(opened.bridge)
    const notified: string[] = []
    stop = listenToBuilds((title) => notified.push(title))
    const spec = await opened.running(aReadySpec(dataFolder, HUMAN))

    const launch = await opened.bridge.invoke('launches.request', {
      specId: spec.specId,
      workspaceId: spec.workspaceId,
    })
    expect(launch.state).toBe('started')
    const sessionId = launch.sessionId ?? ''
    await openBuild(sessionId)

    const waiting = await until((view) => view.tasks[1]?.state === 'yours')
    // The frozen revision the build works from, read as it was frozen.
    expect(buildSnapshot().spec?.revision.number).toBe(waiting.revision)
    expect(buildSnapshot().spec?.revision.id).toBe(spec.revisionId)
    expect(notified).toEqual([`T2 is yours · ${spec.key}`])

    expect(await doneTask(waiting.tasks[1]?.id ?? '')).toBe(true)
    const verified = await until((view) => view.canAccept)
    expect(verified.tasks.map((one) => one.state)).toEqual(['done', 'done', 'done'])
    expect(await acceptBuild()).toBe(true)
    expect((await until((view) => view.phase === 'accepted')).phase).toBe('accepted')
    // Told once, whatever else changed since.
    expect(notified).toHaveLength(1)

    // Every line the build wrote reads as a sentence of its own, never as its type.
    const journal = await opened.bridge.invoke('journal.read', {
      projectId: spec.projectId,
      limit: 200,
    })
    const built = journal.entries.filter(
      (entry) => entry.sessionId === sessionId && /^(build|task|check)\./.test(entry.type),
    )
    expect(built.length).toBeGreaterThan(0)
    for (const entry of built) expect(lineOf(entry).label).not.toBe(entry.type)
  })

  test('a user’s act the engine refuses comes back in its words', async () => {
    const { agent } = buildAgent()
    opened = await openWindow(dataFolder, agent)
    install(opened.bridge)
    stop = listenToBuilds(() => undefined)
    const spec = await opened.running(aReadySpec(dataFolder, HUMAN))
    const launch = await opened.bridge.invoke('launches.request', {
      specId: spec.specId,
      workspaceId: spec.workspaceId,
    })
    await openBuild(launch.sessionId ?? '')
    const view = await until((one) => one.tasks[0]?.state === 'done')

    expect(await doneTask(view.tasks[0]?.id ?? '')).toBe(false)
    expect(buildSnapshot().refusal).toBe('T1 is not waiting for you.')
    expect(await acceptBuild()).toBe(false)
  })
})
