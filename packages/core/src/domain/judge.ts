/**
 * Hemera Auto's pure rules: the verdict from Jev's scores at the policy's one level, the human
 * context Jev is told and its bounds, and who judges a call.
 *
 * Jev allows or asks; it never refuses. Only Hemera's local rules refuse, before Jev is reached.
 */

import { PERMISSION_POLICY } from './permissions.ts'

/** Jev's three answers: risk 0–3, approval and user-requested 0–1. */
export interface JudgeScores {
  readonly risk: number
  readonly approval: number
  readonly userRequested: number
}

const within = (value: number, top: number): boolean =>
  Number.isFinite(value) && value >= 0 && value <= top

/**
 * The verdict at the Normal level: always ask from `alwaysAskRisk`; ask from `askRisk` or
 * `askApproval` unless there is human context and the user asked for this exact call
 * (`userRequestedLifts`); otherwise allow. Invalid or out-of-range scores ask. Never a refusal.
 */
export function verdictFromScores(scores: JudgeScores, hasHumanContext: boolean): 'allow' | 'ask' {
  const { risk, approval, userRequested } = scores
  if (!within(risk, 3) || !within(approval, 1) || !within(userRequested, 1)) return 'ask'
  if (risk >= PERMISSION_POLICY.alwaysAskRisk) return 'ask'
  if (risk >= PERMISSION_POLICY.askRisk || approval >= PERMISSION_POLICY.askApproval) {
    return hasHumanContext && userRequested >= PERMISSION_POLICY.userRequestedLifts
      ? 'allow'
      : 'ask'
  }
  return 'allow'
}

/** How much of what the user said Jev is told: the latest items, each whole, within a total. */
export const HUMAN_CONTEXT_LIMITS = {
  items: 6,
  itemCharacters: 2000,
  totalCharacters: 12000,
} as const

/**
 * Where an item of the human context comes from. Only the user's own words count: the frozen
 * Spec and its decisions (from the frozen version, never an agent's brief), the user's answers to
 * the waves and to Needs you, an option the user chose, and the user's messages in a Chat. Never
 * an agent's text, a file's content or a tool's result.
 */
export type HumanSource =
  | 'frozen-spec'
  | 'spec-decision'
  | 'answer'
  | 'chosen-option'
  | 'chat-message'

export interface HumanItem {
  readonly source: HumanSource
  readonly text: string
}

const SAID: Readonly<Record<HumanSource, string>> = {
  'frozen-spec': 'The Spec the user froze',
  'spec-decision': 'A decision of the frozen Spec',
  answer: 'The user answered',
  'chosen-option': 'An option the user chose',
  'chat-message': 'The user wrote',
}

/**
 * The human context as Jev is told it, from items oldest first: the latest
 * `HUMAN_CONTEXT_LIMITS.items` only, each said with where it comes from. An item whose text is
 * longer than `itemCharacters` is left out rather than cut, and so is an older one that would take
 * what is told past `totalCharacters`.
 */
export function boundedHumanContext(items: ReadonlyArray<HumanItem>): ReadonlyArray<string> {
  const kept: string[] = []
  let total = 0
  for (const one of items.slice(-HUMAN_CONTEXT_LIMITS.items).toReversed()) {
    if (one.text.trim() === '' || one.text.length > HUMAN_CONTEXT_LIMITS.itemCharacters) continue
    const text = `${SAID[one.source]}: ${one.text}`
    if (total + text.length > HUMAN_CONTEXT_LIMITS.totalCharacters) continue
    kept.push(text)
    total += text.length
  }
  return kept.toReversed()
}

/**
 * Who judges what the local rules leave open, as the settings and the model picker say it.
 *
 * Jev, once a key is saved and the user consented; otherwise nobody judges and Hemera asks. An
 * agent's own judge never stands in for Jev in this version: Claude Code's auto mode waits on the
 * checks that would qualify it, and Codex's reviewer and OpenCode cannot judge Hemera's tools. So
 * neither the agent nor its mode changes the answer, and it never says "Auto" when nobody judges.
 */
export const JUDGES = ['Jev', 'Hemera asks'] as const
export type WhoJudges = (typeof JUDGES)[number]

export const whoJudges = (jevReady: boolean): WhoJudges => (jevReady ? 'Jev' : 'Hemera asks')
