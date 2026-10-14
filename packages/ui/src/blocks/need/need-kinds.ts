/**
 * A need: what blocks and waits for the user, the same card wherever it is met — Home's Needs you,
 * the top of a mission, behind a notification.
 *
 * Its band says whose it is: the kind's glyph and "Needs you", then the mission (a link, left out
 * on the mission's own page), when, and the role that raised it. The body is the title and the
 * agent's own words, then what that kind asks: the call and the two reasons of a permission (with
 * how to stop being asked: Allow for this mission, or the setting that would settle it), the
 * options of a decision, the attempts of an error, the action of what is missing. The actions are
 * the band below. What cannot be chosen is not drawn: Allow for this mission is not there on a
 * sensitive place or outside a mission, Discuss only while the mission is in Planning.
 *
 * Once answered or expired, the card is one faint line: the glyph, Applied or Expired, the title,
 * and the answer or the reason.
 */
export type NeedKind = 'permission' | 'decision' | 'error' | 'environment'

/** What each kind is, in words: the legend of its glyph. */
export const NEED_KINDS: Record<NeedKind, string> = {
  permission: 'Permission',
  decision: 'Decision',
  error: 'Error',
  environment: 'Something missing',
}
