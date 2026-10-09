/**
 * The Planner's questions (#86): asked in waves, each with its options and the one it recommends,
 * answered by the user at their own pace, and kept apart from the Spec. Every human input of
 * Planning goes through three states, received, delivered and integrated (CT-26).
 *
 * Here are the pure rules: what makes a wave valid, what makes an answer one, how a changed
 * answer reads, and what an input is about.
 */

import { Schema } from 'effect'

/** A question's life (CT-27): open, waiting on someone, answered, or retired with its reason. */
export const QUESTION_STATES = [
  'open',
  'waiting',
  'answered',
  'withdrawn',
  'replaced',
  'moot',
] as const
export const QuestionState = Schema.Literals(QUESTION_STATES)
export type QuestionState = typeof QuestionState.Type

/** How the Planner retires a question itself. */
export const RETIRE_HOWS = ['withdrawn', 'moot'] as const
export const RetireHow = Schema.Literals(RETIRE_HOWS)
export type RetireHow = typeof RetireHow.Type

/** What a human input of Planning is (CT-26). */
export const INPUT_KINDS = [
  'answer',
  'waiting',
  'vision',
  'discuss_decision',
  'dismissed_finding',
  'triage_kept',
  'dependency_accepted',
] as const
export const InputKind = Schema.Literals(INPUT_KINDS)
export type InputKind = typeof InputKind.Type

/** Received, delivered to the Planner, integrated by it; or superseded by a later version. */
export const INPUT_STATES = ['received', 'delivered', 'integrated', 'superseded'] as const
export const InputState = Schema.Literals(INPUT_STATES)
export type InputState = typeof InputState.Type

export interface QuestionOption {
  readonly id: string
  readonly label: string
  readonly detail: string
}

/** A question as the Planner asks it in a wave. */
export interface AskedQuestion {
  readonly text: string
  readonly why: string
  readonly options: ReadonlyArray<{ readonly label: string; readonly detail: string }>
  /** The index of the option it recommends. */
  readonly recommended: number
  readonly recommendedReason: string
}

/** Exactly one of an option the question offers and a text of the user's own. */
export type Answer =
  | { readonly optionId: string; readonly text: null }
  | { readonly optionId: null; readonly text: string }

/** The id of the option at an index: `A`, `B`… */
export const optionIdAt = (at: number): string => String.fromCharCode(65 + at)

const blank = (text: string): boolean => text.trim() === ''

/** The most options a question offers: one letter each. */
const MOST_OPTIONS = 26

/**
 * Why a wave is refused, in the sentence the Planner reads, or null when it is valid: it holds a
 * question, and each has a text, two options at least, and a recommendation with its reason.
 */
export function waveRefusal(questions: ReadonlyArray<AskedQuestion>): string | null {
  if (questions.length === 0) return 'refused: a wave holds at least one question.'
  for (const [at, question] of questions.entries()) {
    const which = `question ${String(at + 1)}`
    if (blank(question.text)) return `refused: ${which} has no text.`
    if (question.options.length < 2) return `refused: ${which} offers fewer than two options.`
    if (question.options.length > MOST_OPTIONS) {
      return `refused: ${which} offers more than ${String(MOST_OPTIONS)} options.`
    }
    if (question.options.some((option) => blank(option.label))) {
      return `refused: ${which} has an option with no label.`
    }
    if (
      !Number.isInteger(question.recommended) ||
      question.recommended < 0 ||
      question.recommended >= question.options.length
    ) {
      return `refused: ${which} recommends no option it offers (its options are 0 to ${String(question.options.length - 1)}).`
    }
    if (blank(question.recommendedReason)) {
      return `refused: ${which} does not say why you recommend its option.`
    }
  }
  return null
}

/**
 * The answer to a question, checked: one of its options or a text, never neither nor both, and an
 * option the question offers.
 */
export function answerTo(
  options: ReadonlyArray<QuestionOption>,
  given: { readonly optionId?: string | undefined; readonly text?: string | undefined },
): { readonly answer: Answer } | { readonly refused: string } {
  const text = given.text?.trim() ?? ''
  const optionId = given.optionId ?? null
  const refused = (reason: string) => ({ refused: `The answer is refused: ${reason}.` })
  if (optionId === null && text === '') return refused('it names neither an option nor a text')
  if (optionId !== null && text !== '') return refused('it names both an option and a text')
  if (optionId !== null && !options.some((option) => option.id === optionId)) {
    return refused(`“${optionId}” is not an option of the question`)
  }
  return { answer: optionId === null ? { optionId: null, text } : { optionId, text: null } }
}

/** What an answer says in words: its option's letter and label, or the user's own text quoted. */
export function answerWords(options: ReadonlyArray<QuestionOption>, answer: Answer): string {
  if (answer.optionId === null) return `“${answer.text}”`
  const chosen = options.find((option) => option.id === answer.optionId)
  return chosen === undefined ? answer.optionId : `${chosen.id} · ${chosen.label}`
}

/** An answer as the Planner reads it: a first one, or a change ("Q3: now B, was A"). */
export const answerChangeSaid = (
  id: string,
  version: number,
  options: ReadonlyArray<QuestionOption>,
  now: Answer,
  was: Answer | null,
): string =>
  was === null
    ? `${id}: ${answerWords(options, now)} (version ${String(version)})`
    : `${id}: now ${answerWords(options, now)}, was ${answerWords(options, was)} (version ${String(version)})`

/** What an input is about, as a sentence names it. */
export function inputAbout(kind: InputKind, item: string, version: number | null): string {
  const versioned = version === null ? '' : `, version ${String(version)}`
  switch (kind) {
    case 'answer':
      return `the answer to ${item}${versioned}`
    case 'waiting':
      return `${item} waiting on someone`
    case 'vision':
      return 'the user’s vision'
    case 'discuss_decision':
      return `the decision ${item}${versioned}`
    case 'dismissed_finding':
      return `the dismissed finding ${item}`
    case 'triage_kept':
      return 'the user keeping the mission'
    case 'dependency_accepted':
      return `the dependency on ${item}`
  }
}
