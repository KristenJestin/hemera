/**
 * The times of a build in short words (D10-12): how long ago something happened, and how long it
 * took.
 *
 * Nothing here reads a clock or a time zone: the view is handed the ISO times of the engine and
 * the `now` of its caller, and says only differences between them. A time of day would be a
 * locale and a zone this package does not have, and a story that said one would change with the
 * machine it ran on.
 */

import { type BuildTaskView, TRIES } from './model.ts'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** How long a span is, from milliseconds: `40 s`, `12 min`, `1 h 5 min`, `3 days`. */
function span(ms: number): string {
  const at = Math.max(0, ms)
  if (at < MINUTE) return `${String(Math.round(at / 1000))} s`
  if (at < HOUR) return `${String(Math.floor(at / MINUTE))} min`
  if (at < DAY) {
    const hours = Math.floor(at / HOUR)
    const minutes = Math.floor((at % HOUR) / MINUTE)
    return minutes === 0 ? `${String(hours)} h` : `${String(hours)} h ${String(minutes)} min`
  }
  const days = Math.floor(at / DAY)
  return days === 1 ? '1 day' : `${String(days)} days`
}

/** How long ago `at` was, seen from `now`: `just now`, `12 min ago`, `2 h ago`. */
export function ago(at: string, now: string): string {
  const ms = Date.parse(now) - Date.parse(at)
  if (ms < MINUTE) return 'just now'
  return `${span(ms)} ago`
}

/** How long it took from `from` to `to`: `40 s`, `9 min`, `1 h 5 min`. */
export function took(from: string, to: string): string {
  return span(Date.parse(to) - Date.parse(from))
}

/**
 * The one time a task's row and its stage say, chosen by its state: how long it has been worked
 * on, checked or waited for, how long it took, or what it waits on.
 */
export function taskTime(task: BuildTaskView, now: string): string {
  switch (task.state) {
    case 'waiting':
      return task.dependsOn.length === 0 ? 'waiting' : `after ${task.dependsOn.join(', ')}`
    case 'ready':
      return task.handedAt === null ? 'ready' : `handed ${ago(task.handedAt, now)}`
    case 'in_progress':
      return task.startedAt === null ? 'working' : `for ${took(task.startedAt, now)}`
    case 'checking':
      return task.finishedAt === null ? 'checking' : `for ${took(task.finishedAt, now)}`
    case 'done':
      if (task.startedAt !== null && task.endedAt !== null) {
        return `took ${took(task.startedAt, task.endedAt)}`
      }
      return task.endedAt === null ? 'done' : `done ${ago(task.endedAt, now)}`
    case 'yours':
      return task.endedAt === null ? 'yours' : `for ${took(task.endedAt, now)}`
    case 'blocked':
      return ago(task.updatedAt, now)
    case 'skipped':
      return task.endedAt === null ? 'skipped' : ago(task.endedAt, now)
  }
}

/** A try in words: `Try 2 of 3`, or `Try 4` once the user asked for more than three. */
export function tryLabel(number: number): string {
  return number > TRIES ? `Try ${String(number)}` : `Try ${String(number)} of ${String(TRIES)}`
}
