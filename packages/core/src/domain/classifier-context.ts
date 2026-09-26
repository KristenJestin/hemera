/** Human authorization context, bounded without dropping a qualifying sentence (D59-05). */

import type { Mission, SessionEntry } from './session.ts'

export const CLASSIFIER_MESSAGE_LIMIT = 6
export const CLASSIFIER_ITEM_CHARACTERS = 2_000
export const CLASSIFIER_CONTEXT_CHARACTERS = 12_000

export interface FrozenSpecSection {
  readonly label: string
  readonly body: string
}

export interface HumanContextItem {
  readonly source: 'human-message' | 'frozen-spec'
  readonly text: string
}

export interface HumanContext {
  readonly items: readonly HumanContextItem[]
  /** A newer human message changes this value and invalidates a pending automatic grant. */
  readonly latestHumanSeq: number
}

/** Call with sections from the actual frozen revision only, never from an agent's task brief. */
export function classifierHumanContext(
  mission: Mission,
  entries: readonly SessionEntry[],
  frozenSpecSections: readonly FrozenSpecSection[] = [],
): HumanContext {
  const messages = entries
    .filter(
      (entry) =>
        entry.role === 'user' &&
        entry.origin === 'live' &&
        (entry.kind === 'message' || entry.kind === 'spec_answer'),
    )
    .sort((left, right) => left.seq - right.seq)
  const latestHumanSeq = messages.at(-1)?.seq ?? 0
  const latest = messages.slice(-CLASSIFIER_MESSAGE_LIMIT)
  let remaining = CLASSIFIER_CONTEXT_CHARACTERS
  const keptMessages: HumanContextItem[] = []
  for (const entry of latest.toReversed()) {
    if (entry.body.length === 0 || entry.body.length > CLASSIFIER_ITEM_CHARACTERS) continue
    if (entry.body.length > remaining) continue
    keptMessages.push({ source: 'human-message', text: entry.body })
    remaining -= entry.body.length
  }
  keptMessages.reverse()

  const spec: HumanContextItem[] = []
  if (mission === 'build') {
    for (const section of frozenSpecSections) {
      const text = `The Spec the user froze — ${section.label}:\n${section.body}`
      if (text.length > CLASSIFIER_ITEM_CHARACTERS || text.length > remaining) continue
      spec.push({ source: 'frozen-spec', text })
      remaining -= text.length
    }
  }
  return { items: [...spec, ...keptMessages], latestHumanSeq }
}
