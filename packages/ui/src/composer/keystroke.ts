/**
 * What a keystroke in a box a message is written in means (design D4b-08).
 *
 * Enter sends and Shift+Enter breaks the line, which is what every box of this shape does and
 * what the hand already expects of this one. The part that is easy to get wrong is the third
 * case: a Japanese, Chinese or Korean keyboard composes a word through an input method, and
 * the Enter that accepts the candidate is the same Enter that would send. Sending there throws
 * a half-written word into the thread and leaves the writer with nothing to correct.
 *
 * Two ways of asking the same question, because neither is answered everywhere. `isComposing`
 * is the property the standard gives a keyboard event; `229` is the key code a browser hands
 * over while an input method owns the keystroke, from before the property existed and still
 * what some of them send. Either one means the same thing: this Enter is not yours.
 *
 * A decision and not a handler: it takes what a keystroke says about itself and answers what
 * to do, so it can be read in a test rather than played in a browser.
 */

/** What a box needs to know about a keystroke to decide what it meant. */
export interface Keystroke {
  key: string
  shiftKey: boolean
  /** Whether an input method owns the keystroke, which the standard says. */
  isComposing: boolean
  /** What a browser that predates `isComposing` says instead, which is `229`. */
  keyCode: number
}

/** What the box does about it: send what is written, break the line, or let the key through. */
export type KeystrokeAnswer = 'send' | 'newline' | 'through'

/** The key code a browser reports while an input method is composing a word. */
const COMPOSING_KEY_CODE = 229

export function answerTo(stroke: Keystroke): KeystrokeAnswer {
  if (stroke.key !== 'Enter') return 'through'
  if (stroke.isComposing || stroke.keyCode === COMPOSING_KEY_CODE) return 'through'
  return stroke.shiftKey ? 'newline' : 'send'
}
