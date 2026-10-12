/**
 * Ends a stories run that stopped making progress, and says on which file.
 *
 * Vitest's browser mode puts a timeout on every test and every hook, and none on a file: once a
 * file has been handed to its page, the run waits for that page to report, however long it takes.
 * A page that goes quiet without crashing and without dropping its connection is waited for
 * until the CI step's own cap, with no word on which file it was (#244: on Windows, one file of
 * seventy-seven in one theme never reported, twice, and the step sat for the fifteen minutes it
 * is given). A healthy run finishes a file every few seconds, twenty at most; this watchdog
 * fails the run when none has finished for ninety, with the files it is still waiting on.
 *
 * It is a Vitest reporter, set in `vite.config.ts`, and watches the Storybook projects only: the
 * repository suites have files that run for minutes.
 */

import type { Reporter, TestModule, Vitest } from 'vite-plus/test/node'

const IDLE_MS = 90_000
const CHECK_EVERY_MS = 5_000
/** What `vitest.close()` is given to stop the browsers before the process exits anyway. */
const CLOSE_GRACE_MS = 10_000

interface Clock {
  idleMs: number
  now: () => number
}

/** The files of a run, and whether the run still finishes them. */
export function watchProgress({ idleMs, now }: Clock) {
  const queued = new Set<string>()
  const running = new Set<string>()
  let lastProgress = now()
  return {
    queue(file: string) {
      queued.add(file)
    },
    start(file: string) {
      queued.delete(file)
      running.add(file)
    },
    finish(file: string) {
      queued.delete(file)
      running.delete(file)
      lastProgress = now()
    },
    /** The reason to end the run, or `null` while it is still moving or has nothing left to wait for. */
    verdict(): string | null {
      if (queued.size + running.size === 0) return null
      if (now() - lastProgress < idleMs) return null
      const lines = [
        `The stories run stalled: no story file finished in the last ${idleMs / 1000} s.`,
        `Running: ${[...running].join(', ') || 'none'}`,
      ]
      if (queued.size > 0) {
        lines.push(`Waiting for a slot: ${queued.size} file${queued.size === 1 ? '' : 's'}`)
      }
      lines.push(
        'Vitest has no timeout on a whole file: a page that goes quiet without crashing is waited for for ever.',
      )
      return lines.join('\n')
    },
  }
}

const isStory = (module: TestModule) => module.project.name.startsWith('storybook-')
const nameOf = (module: TestModule) => `${module.project.name} ${module.relativeModuleId}`

export default class StoriesWatchdog implements Reporter {
  #vitest: Vitest | undefined
  #watch = watchProgress({ idleMs: IDLE_MS, now: Date.now })
  #timer: ReturnType<typeof setInterval> | undefined

  onInit(vitest: Vitest) {
    this.#vitest = vitest
  }

  onTestRunStart() {
    this.#watch = watchProgress({ idleMs: IDLE_MS, now: Date.now })
    this.#timer = setInterval(() => void this.#check(), CHECK_EVERY_MS)
    this.#timer.unref()
  }

  onTestModuleQueued(module: TestModule) {
    if (isStory(module)) this.#watch.queue(nameOf(module))
  }

  onTestModuleStart(module: TestModule) {
    if (isStory(module)) this.#watch.start(nameOf(module))
  }

  onTestModuleEnd(module: TestModule) {
    if (isStory(module)) this.#watch.finish(nameOf(module))
  }

  onTestRunEnd() {
    clearInterval(this.#timer)
  }

  async #check() {
    const verdict = this.#watch.verdict()
    if (verdict === null) return
    clearInterval(this.#timer)
    console.error(`\n${verdict}\n`)
    const closed = this.#vitest?.close()
    await Promise.race([closed, new Promise((done) => setTimeout(done, CLOSE_GRACE_MS))])
    process.exit(1)
  }
}
