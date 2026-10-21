import type { NeedRow } from '../../blocks/need/needs-you-list.tsx'
import type { Question } from '../../blocks/planning/planning-types.ts'
import type { FaceState } from '../../components/face/states.ts'
import type { MarkState } from '../../components/status-mark/mark-legends.ts'

/**
 * What the Review page, its round view and Ship draw, as #254 proposes them: plain values, in the
 * words the screens use. The engine's names stay in the RPCs the build tickets wire.
 */

/**
 * Where a remark of the user stands. It waits until Fix sends it; it is in a round while the
 * round works on it; the agent marks it addressed, and only its author resolves it; its author may
 * withdraw it while it is not resolved.
 */
export type RemarkState = 'waiting' | 'inRound' | 'addressed' | 'resolved' | 'withdrawn'

/** An image a remark carries: kept, or refused with its reason in words. */
export interface RemarkImage {
  name: string
  /** Its size, in words: `412 KB`. */
  size: string
  /** Why it was not kept, when it was not. */
  refused?: string | undefined
}

export interface Remark {
  id: string
  /** A remark asks for a change; a question asks for an answer and never becomes a task. */
  kind: 'remark' | 'question'
  text: string
  state: RemarkState
  /** Where in the code it was written, when it was written in the diff: `web/src/export.ts:42`. */
  anchor?: string | undefined
  images?: readonly RemarkImage[] | undefined
  /** The round it went into, once it did. */
  round?: number | undefined
  /** What the agent answered, once it did: what it did, or the answer to a question. */
  answer?: string | undefined
  /** Whether the agent answered that it asks for a mission of its own, to start from it. */
  toMission?: boolean | undefined
  /** The remark it follows up, when it is a follow-up. */
  follows?: string | undefined
  /** Who wrote it when it came from the team, through the user. */
  from?: string | undefined
  at: string
}

/** A round's point: written like a requirement, with the ids of everything it came from. */
export interface RoundPoint {
  id: string
  title: string
  /** A fix changes nothing the Spec says; a behaviour change is a decision on a requirement. */
  kind: 'fix' | 'behaviour'
  /** The remarks, team comments and findings it came from. */
  sources: readonly string[]
  state: MarkState
  /** What it asks, in a sentence or two. */
  detail: string
  /** Its scenario, for a point that can be proven. */
  scenario?: string | undefined
  /** The decision it records, for a behaviour change. */
  decision?: string | undefined
  /**
   * When the point goes against the Spec: the requirement it contradicts, and what the user chose
   * among the three ways out, once they did.
   */
  conflict?:
    | {
        with: string
        why: string
        outcome?: 'clarified' | 'withdrawn' | 'cancelled' | undefined
        note?: string | undefined
      }
    | undefined
  /** When the point adds what the Spec never asked for: it is offered as a mission of its own. */
  newMission?: string | undefined
}

/** The grilling's questions, by waves: a wave is sent once its questions are answered. */
export interface Wave {
  n: number
  questions: readonly Question[]
}

export interface Round {
  n: number
  /** Grilling: the agent asks; building: the mission is in Building · round N; back: answered. */
  state: 'grilling' | 'building' | 'back' | 'closed'
  waves: readonly Wave[]
  points: readonly RoundPoint[]
  /** When it was sent, and when it came back. */
  sentAt: string
  backAt?: string | undefined
  /** How far Building · round N is, while it builds: `2 of 4 points done`. */
  building?: string | undefined
}

/** A comment of the team on the forge, which reaches a round only through the user. */
export interface TeamComment {
  id: string
  author: string
  /** Where it was written: `api/src/export.ts:88`, or the pull request itself. */
  anchor: string
  text: string
  /** The agent's reading of it. */
  reading: string
  /** The reply the agent drafted, which stays here: the user answers on the forge. */
  draft: string
  state: 'new' | 'inRound' | 'dismissed' | 'resolved'
  /** The user's own take, which weighs more than the agent's reading. */
  take?: string | undefined
  url: string
  at: string
}

/** A pull request of one repository, as the delivery rules push and open it. */
export interface PullRequest {
  repository: string
  state: 'click' | 'running' | 'open' | 'failed' | 'signedOut' | 'merged'
  /** Once open: its number and address. */
  number?: number | undefined
  url?: string | undefined
  /** Its CI, once it runs. */
  ci?: MarkState | undefined
  /** How many approvals it has, of how many it needs. */
  approvals?: { given: number; needed: number } | undefined
  reviewers?: readonly string[] | undefined
  /** What failed, as the remote or Git said it. */
  message?: string | undefined
  /** The command that signs the forge's CLI in. */
  command?: string | undefined
  /** The images of the mission: published in the description, or listed by name. */
  images?: { published: boolean; names: readonly string[] } | undefined
  /** The step under way, while it runs: `pushing`, `opening the pull request`. */
  step?: string | undefined
}

/** A service of the mission, for the live test. */
export interface Service {
  name: string
  state: 'running' | 'starting' | 'stopped' | 'failed'
  /** Its address while it runs. */
  url?: string | undefined
  /** The line it is started with. */
  line: string
  /** Why it stopped, when it failed. */
  error?: string | undefined
  /** Whether its × removes it once it does not run: not one of the catalogue never started. */
  removable?: boolean | undefined
}

/** A scenario's proof: its red recorded, then green; or a proof the user verifies by hand. */
export interface Proof {
  id: string
  requirement: string
  title: string
  /** Proven by a test, red then green; or verified by hand, by the user. */
  how: 'test' | 'hand'
  state: 'green' | 'red' | 'toVerify' | 'validated' | 'refused'
  redAt?: string | undefined
  greenAt?: string | undefined
  /** What to do to verify it by hand. */
  steps?: string | undefined
  /** Why the user refused it. */
  reason?: string | undefined
  /** Whether a change made outside Hemera touches it: it is to redo at Ship. */
  redo?: boolean | undefined
}

export interface Check {
  repository: string
  name: string
  state: MarkState
  /** How long it took, or how long ago it ran. */
  after: string
  tail?: readonly string[] | undefined
  redo?: boolean | undefined
}

/** A finding of the automatic review, and what became of it. */
export interface Finding {
  id: string
  severity: 'blocking' | 'warning' | 'suggestion'
  by: 'Code reviewer' | 'Spec reviewer'
  text: string
  /** What became of it, in words: `fixed by RV1`, `dismissed: …`. */
  fate: string
}

/** What changed after the automatic review: the special tasks, covered only by the checks. */
export interface AfterReview {
  id: string
  text: string
  files: readonly string[]
}

export interface Change {
  repository: string
  files: number
  added: number
  deleted: number
  outside?: readonly string[] | undefined
}

/** One step of what Ship re-runs before it pushes. */
export interface Rerun {
  id: string
  what: string
  state: MarkState
  tail?: readonly string[] | undefined
}

/** What Ship's confirmation lists before it goes. */
export interface ShipPreview {
  /** What leaves, per repository: its branch and what it carries. */
  leaving: readonly { repository: string; branch: string; summary: string }[]
  /** The files changed outside Hemera that leave too, and what they make to redo. */
  outside: readonly { repository: string; path: string }[]
  redo: readonly string[]
  /** The proofs verified by hand that the user has not validated. */
  unvalidated: readonly { id: string; title: string }[]
  /** The rules of the Project that changed since the mission copied them. */
  rules: readonly { what: string; before: string; now: string }[]
  /** The CI of each open pull request. */
  ci: readonly { repository: string; number: number; state: MarkState; words: string }[]
  /** The Local preset: no forge, Ship is a dated "delivered". */
  local?: { merges: readonly { repository: string; into: string }[] } | undefined
}

/** The Ship under way: what it re-runs, and whether a red stopped it. */
export interface Shipping {
  reruns: readonly Rerun[]
  stopped?: string | undefined
}

/** Who has the ball in Review, and why, in words. */
export interface BallView {
  ball: 'agent' | 'you' | 'someone'
  /** Beside the glyph: who or what it waits on. */
  words?: string | undefined
}

export interface ReviewMoment {
  /** The mission's stage: Review, or Building while a round builds. */
  stage?: 'Building' | undefined
  face: FaceState
  /** The stage card's line: what happens, or what waits. */
  now: string
  progress: { step: string; detail: string }
  round: number
  ball: BallView
  needs: readonly NeedRow[]
  remarks: readonly Remark[]
  /** Whether Fix may be pressed now, as the engine says: feedback waits and no round runs. */
  fixable: boolean
  rounds: readonly Round[]
  team: readonly TeamComment[]
  pulls: readonly PullRequest[]
  forge: 'GitHub' | 'Bitbucket' | null
  services: readonly Service[]
  proofs: readonly Proof[]
  checks: readonly Check[]
  findings: readonly Finding[]
  saw: string
  after: readonly AfterReview[]
  /** The documenter's reason when it changed nothing. */
  noDocChange?: string | undefined
  changes: readonly Change[]
  /** Why Ship cannot be pressed yet, each reason in words; empty when it can. */
  refusals: readonly string[]
  preview: ShipPreview
  shipping?: Shipping | undefined
}
