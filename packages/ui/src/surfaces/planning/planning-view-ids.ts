import { type DiscussionItem } from '../../blocks/planning/planning-types.ts'

/**
 * The Planning page: the base of a mission's frame while the Planner writes the Spec with the
 * user (#100, reworked by #169, then by #193 so that it tells at a glance what waits, what
 * happens, and where the Spec stands).
 *
 * The centre holds what matters to read, the Spec, at its measure, with its eight sections and
 * their state down the left — the green check only once no open question touches a section; what
 * changed since the last read is marked where it changed, with one line on top and Mark as read.
 * The right-hand rail reads top to bottom, in an order that never changes: the stage card (what
 * happens: the face, one line, where Planning stands, the chips of what runs), For you (what
 * waits: the mission's needs, the questions — one list in the order they were asked, one open at a
 * time —, the findings to settle), and the rest, one quiet line each, folded. The head draws no
 * Now line: the card says it.
 *
 * Discuss and a Probe's report open as views over the page: their ids are below, and the frame
 * that holds the page holds them.
 */

/** The id of the view of a discussion over the page. */
export const discussionViewId = (item: DiscussionItem): string =>
  `discussion:${item.kind}:${item.id}`

/** The id of the view of a Probe's report over the page. */
export const probeViewId = (id: string): string => `probe:${id}`
