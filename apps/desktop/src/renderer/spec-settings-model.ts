/**
 * What the Spec settings show of the engine's answers, and what they write back: the modes
 * offered, the words of a refused setting, the key prefix as an edit, and the gate that drops a
 * write answered after a later one, and the last check of the linked tickets. Plain values and no
 * React.
 */

import {
  InvalidKeyPrefix,
  InvalidSyncInterval,
  KeyPrefixTaken,
  type KeyPrefixEdit,
  type Project,
} from '@hemera/ipc'
import type { SpecModeChoice } from '@hemera/ui'

/** The modes the select offers: one line to change when the remote mode can be used. */
export const OFFERED_MODES: readonly SpecModeChoice[] = ['local', 'linked']

/** How long the key prefix waits for the typing to settle before the engine is asked. */
export const PREFIX_SETTLES_MS = 600

/** Why the key prefix was not saved, in words: the engine's own for a refusal it explains. */
export function prefixWords(failure: Error): string {
  return failure instanceof InvalidKeyPrefix || failure instanceof KeyPrefixTaken
    ? failure.message
    : `The key prefix could not be saved: ${failure.message}`
}

/** Why a Spec setting was not saved, in words. */
export function settingWords(setting: 'Spec mode' | 'Spec language', failure: Error): string {
  return `The ${setting} could not be saved: ${failure.message}`
}

/** Why the sync interval was not saved, in words: the engine's own for an interval it refuses. */
export function syncWords(failure: Error): string {
  return failure instanceof InvalidSyncInterval
    ? failure.message
    : `The sync interval could not be saved: ${failure.message}`
}

const dayIn = (date: Date, zone?: string): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(date)

/**
 * When the linked tickets were last checked, as the row says it after "Last checked at": `08:12`
 * today, `7 Oct, 08:12` another day; null before the first check or when the date cannot be read.
 */
export function lastCheckWords(iso: string | null, now: Date, zone?: string): string | null {
  if (iso === null) return null
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return null
  const time = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: zone,
  }).format(at)
  if (dayIn(at, zone) === dayIn(now, zone)) return time
  const day = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: zone,
  }).format(at)
  return `${day}, ${time}`
}

/** The key prefix typed, as the engine takes it: at the version of the Project it was read from. */
export function prefixEditOf(
  project: Pick<Project, 'id' | 'version'>,
  prefix: string,
): KeyPrefixEdit {
  return { id: project.id, version: project.version, prefix }
}

/**
 * Tells whether a write is still the latest when the engine answers: each write takes a ticket, and
 * an answer to any but the last ticket is dropped. Closing the gate drops every answer to come.
 */
export interface AnswerGate {
  readonly begin: () => number
  readonly isLatest: (ticket: number) => boolean
  readonly close: () => void
}

export function answerGate(): AnswerGate {
  let latest = 0
  let closed = false
  return {
    begin: () => ++latest,
    isLatest: (ticket) => !closed && ticket === latest,
    close: () => {
      closed = true
    },
  }
}
