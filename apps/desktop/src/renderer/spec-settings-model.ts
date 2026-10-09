/**
 * What the Spec settings show of the engine's answers, and what they write back: the modes
 * offered, the words of a refused setting, the key prefix as an edit, and the gate that drops a
 * write answered after a later one. Plain values and no React.
 */

import { InvalidKeyPrefix, KeyPrefixTaken, type KeyPrefixEdit, type Project } from '@hemera/ipc'
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
