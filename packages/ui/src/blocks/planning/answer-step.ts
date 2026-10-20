import { type InputState, type Question, latest } from './planning-types.ts'

/** Where an answer stands: nothing answered yet, or the state of the input that carries it. */
export type AnswerStep = 'unanswered' | InputState

/**
 * Where a question's answer stands, from the question alone: not answered while it is asked (an
 * earlier answer of a question asked again does not count), else its latest answer's input; an
 * answer the engine has not listed an input for yet was just sent.
 */
export function answerStepOf(question: Question): AnswerStep {
  if (question.state !== 'answered') return 'unanswered'
  return latest(question)?.inputState ?? 'unanswered'
}

/** Each step in words, with the one that follows it: the dot's legend. */
export const INPUT_WORDS: Record<AnswerStep, string> = {
  unanswered: 'Not answered yet',
  received: 'Sent; next, the Planner reads it',
  delivered: 'With the Planner; next, taken into account in the Spec',
  integrated: 'Taken into account in the Spec',
  superseded: 'Replaced by a later answer',
}

/** Each step in a word or two, under a question once answered. */
export const INPUT_SHORT: Record<AnswerStep, string> = {
  unanswered: 'Not answered yet',
  received: 'Sent',
  delivered: 'With the Planner',
  integrated: 'Taken into account',
  superseded: 'Replaced',
}
