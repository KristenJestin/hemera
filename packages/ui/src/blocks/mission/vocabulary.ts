/**
 * What a mission is called on screen: its stages in the orders the screens use, a dot for each,
 * and its marks as the interface says them. Pure data and words: the glyphs are in
 * `mission-marks.tsx`.
 */

/** The stage of a mission as the screens name it; Cancelled is where a cancel leads. */
export type MissionStage =
  | 'Planning'
  | 'Ready'
  | 'Building'
  | 'Review'
  | 'Shipping'
  | 'Done'
  | 'Cancelled'

/** The stages in the order a list gives them: what is closest to shipping first, the folded last. */
export const STAGE_ORDER: readonly MissionStage[] = [
  'Shipping',
  'Review',
  'Building',
  'Planning',
  'Ready',
  'Done',
  'Cancelled',
]

/** The stages in the order a mission lives them: the header's track, without Cancelled. */
export const STAGE_LIFE: readonly MissionStage[] = [
  'Planning',
  'Ready',
  'Building',
  'Review',
  'Shipping',
  'Done',
]

/** The stages a list folds away: the missions that are over. */
export const FOLDED_STAGES: ReadonlySet<MissionStage> = new Set<MissionStage>(['Done', 'Cancelled'])

/** The dot of a stage, as classes: its tone. */
export const STAGE_DOT: Record<MissionStage, string> = {
  Planning: 'size-2 shrink-0 rounded-full bg-info',
  Ready: 'size-2 shrink-0 rounded-full bg-muted-foreground',
  Building: 'size-2 shrink-0 rounded-full bg-build',
  Review: 'size-2 shrink-0 rounded-full bg-warning',
  Shipping: 'size-2 shrink-0 rounded-full bg-primary',
  Done: 'size-2 shrink-0 rounded-full bg-success',
  Cancelled: 'size-2 shrink-0 rounded-full bg-border',
}

/** A mark on a mission as a row or a header draws it: what it is and, when it has one, its cause. */
export type MissionMarkView =
  | { kind: 'blocked'; cause: string }
  | { kind: 'waiting'; on: string }
  | { kind: 'needsYou' }
  | { kind: 'outdated' }
  | { kind: 'outside'; repository: string }
  | { kind: 'fixing' }

/** The marks whose cause must be read without pointing at them: drawn with their words. */
export const SPELLED_MARKS: ReadonlySet<MissionMarkView['kind']> = new Set<MissionMarkView['kind']>(
  ['blocked', 'waiting'],
)

/** A mark in words: the legend on its glyph, and what the spelled form writes. */
export function markWords(mark: MissionMarkView): string {
  switch (mark.kind) {
    case 'blocked':
      return `Blocked by ${mark.cause}`
    case 'waiting':
      return `Waiting on ${mark.on}`
    case 'needsYou':
      return 'Needs you'
    case 'outdated':
      return 'Outdated'
    case 'outside':
      return `${mark.repository} changed outside Hemera`
    case 'fixing':
      return 'Fixing'
  }
}

/** A stage in words: `Review · round 1` once a Building or a Review has had a round. */
export function stageWords(stage: MissionStage, round: number): string {
  const rounded = round > 0 && (stage === 'Building' || stage === 'Review')
  return rounded ? `${stage} · round ${String(round)}` : stage
}
