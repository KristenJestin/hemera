/**
 * Who has the ball: the key indicator of a mission, as one glyph wherever the mission is named —
 * the sidebar, the Project page, the mission's header. Its legend is a tooltip on the glyph, never
 * a panel; without the legend it is decoration beside a line that says the state.
 *
 * Nothing here is drawn for the purpose: each state is a mark the design system already has, with
 * the meaning that mark has everywhere else.
 *
 * - `agent` · the agent works: the status mark's running arc in a list; Hemera's face, thinking,
 *   where the mission is the subject — its header — and nowhere smaller (`face`). One family of
 *   glyphs in every list, and the face once per screen.
 * - `you` · it waits for the user: the status mark of what waits for the user, the dot and its
 *   ring, in the one tone that calls.
 * - `someone` · it waits for somebody outside Hemera, a review or a CI: the dotted ring of what
 *   has not started, because for Hemera nothing is running.
 * - `blocked` · a dependency or a resource holds it: the status mark of what is blocked.
 * - `idle` · nothing runs and nothing waits: the idle status mark, the quietest ring. Every row
 *   has a status, so a mission at rest has one too.
 */
export type Ball = 'agent' | 'you' | 'someone' | 'blocked' | 'idle'

/** What each state means, in words: the legend, and what a screen reader says. */
export const BALL_LEGENDS: Record<Ball, string> = {
  agent: 'Agent working',
  you: 'Needs you',
  someone: 'Waiting on someone',
  blocked: 'Blocked',
  idle: 'Idle',
}
