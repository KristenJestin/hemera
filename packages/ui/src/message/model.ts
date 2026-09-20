import type { ReactNode } from 'react'

/**
 * What a thread of a Session is made of, as the design system sees it (design D4b-08).
 *
 * The types live apart from the components so that a page can build the list it hands over
 * without importing anything that draws: a row is described, then rendered, and the two halves
 * stay legible on their own.
 */

/**
 * Who wrote a line.
 *
 * `hemera` is the application speaking about itself — the note that says a Session was created
 * or renamed, read from the Journal and drawn in the ghost tone. `agent` exists for HEM-48 and
 * draws nothing yet: this lot has no agent and the thread says so by never producing one.
 */
export type MessageAuthor = 'user' | 'hemera' | 'agent'

/**
 * How the surface of a line is filled.
 *
 * `soft` is a message with a rim, `tint` the accent colour, `ghost` a line without a surface at
 * all — what Hemera says about the Session rather than what someone said in it.
 */
export type MessageTone = 'soft' | 'tint' | 'ghost'

/**
 * Where a line stands with the Profile.
 *
 * There is no fourth value and no optimism: a message is `saving` until the engine says the
 * transaction committed, and only then `saved`. A failed write is `failed` and stays visible
 * as such, with its text still recoverable (D4b-02).
 */
export type MessageState = 'saved' | 'saving' | 'failed'

/** One message of a thread: what it says, and what identifies it to the engine. */
export interface MessageLine {
  /** The entry's own identifier; a draft carries the key its retry will carry. */
  id: string
  /** What the line says. Text in this lot. */
  body: ReactNode
}
