import type { Ball } from '../../blocks/ball/ball-mark.tsx'
import type { MissionMarkView } from '../../blocks/mission/vocabulary.ts'
import type { NeedRow } from '../../blocks/need/needs-you-list.tsx'
import type { FaceState } from '../../components/face/states.ts'
import type { MarkState } from '../../components/status-mark/status-mark.tsx'

/**
 * What the Shipping, Done and Cancelled pages draw, as #265 proposes them: plain values, in the
 * words the screens use. The engine's names stay in the RPCs the build tickets wire (`delivery.*`,
 * `closing.*`, `cleanup.*`, `mission.leftovers`).
 */

/**
 * Where one repository stands in the delivery. Not started until its wave comes; running while
 * Hemera runs a step; waiting while someone outside Hemera holds it (a CI, an approval); needs you
 * while a step waits for the user's click; failed, stopped, or delivered once every step is green.
 */
export type RepositoryState =
  | 'todo'
  | 'running'
  | 'waiting'
  | 'needsYou'
  | 'failed'
  | 'stopped'
  | 'delivered'

/** The kinds of step the delivery rules know (#250), each with its glyph. */
export type StepKind =
  | 'push'
  | 'pullRequest'
  | 'merge'
  | 'ci'
  | 'bump'
  | 'version'
  | 'remote'
  | 'confirm'
  | 'command'

/** A check of a CI step: its name, how it stands, and where the forge shows it. */
export interface CiCheck {
  name: string
  state: MarkState
  url: string
}

/** What the forge allows on a step beside Retry: re-run the failed jobs, stop a pipeline. */
export interface ForgeAction {
  label: string
  /** The forge's own words for it, kept apart so a story can ask for it by name. */
  id: 'rerun-failed' | 'stop-pipeline' | 'approve'
}

/** A line of the Journal the step wrote, newest last, as the Memory keeps it. */
export interface JournalLine {
  at: string
  text: string
}

export interface Step {
  id: string
  kind: StepKind
  /** The step's name as the rules say it: `Pull request`, `CI`, `Deploy to staging`. */
  name: string
  /** What it acts on, in words: `into develop`, `acme/shop · workflow ci.yml`. */
  task: string
  state: MarkState
  /** Its outcome once it has one: `#41`, `5 of 5 checks`, `2.4.0`. */
  outcome?: string | undefined
  /** Where the forge shows it. */
  url?: string | undefined
  checks?: readonly CiCheck[] | undefined
  /** A failure's message, verbatim, masked of its secrets. */
  failure?: string | undefined
  actions?: readonly ForgeAction[] | undefined
  /** Why it waits, in words, while it does: `Waiting on ana.lopez’s approval`. */
  waits?: string | undefined
  journal?: readonly JournalLine[] | undefined
}

export interface RepositoryDelivery {
  repository: string
  state: RepositoryState
  steps: readonly Step[]
}

export interface DeliveryWave {
  n: number
  repositories: readonly RepositoryDelivery[]
}

/** A team comment written on a pull request while the mission ships. */
export interface TeamComment {
  id: string
  author: string
  /** Where it was written: `api #41`, `web/src/export.ts:88`. */
  anchor: string
  text: string
  when: string
  /** Once a mission was started from it, its key. */
  started?: string | undefined
}

/** The fix of a CI broken after the merge, through the round machinery. */
export interface Fix {
  /** The round the fix is: `3`. */
  round: number
  repository: string
  /** Where it stands, one line each, as a round's steps. */
  steps: readonly { name: string; state: MarkState; detail?: string | undefined }[]
  /** The fix's pull request, once it is open. */
  pull?: { number: number; state: MarkState; words: string } | undefined
  /** The diff the user accepts, as a few lines: the fix is small. */
  diff?: string | undefined
}

/** One moment of the Shipping page. */
export interface ShippingMoment {
  face: FaceState
  now: string
  progress: { step: string; detail: string }
  ball: Ball
  /** Who has it, in words, when it is not the user's nor the agent's. */
  ballWords?: string | undefined
  marks: readonly MissionMarkView[]
  waves: readonly DeliveryWave[]
  needs: readonly NeedRow[]
  team: readonly TeamComment[]
  /** The delivery was stopped by the user: what is delivered stays delivered. */
  stopped?: boolean | undefined
  fix?: Fix | undefined
}

/** What was delivered, per repository, as Done keeps it. */
export interface Delivered {
  repository: string
  /** One line per outcome: the pull request, the merge, the version, the deploy. */
  outcomes: readonly { what: string; outcome: string; url?: string | undefined }[]
}

/** A requirement the mission merged into the living spec, with where it came from. */
export interface MergedRequirement {
  id: string
  title: string
  /** `new`, or the requirement it changed. */
  origin: string
}

/** A closing conflict: the living spec changed under the mission; both versions, one to keep. */
export interface ClosingConflict {
  requirement: string
  title: string
  mission: string
  living: string
  /** Who changed the living spec's version, and when. */
  livingFrom: string
}

/** An item of the cleanup: removed, being removed, or kept by the guard with its reason. */
export interface CleanupItem {
  what: string
  /** Its kind, as its glyph says it. */
  kind: 'workspace' | 'branch' | 'service' | 'file'
  state: 'todo' | 'running' | 'removed' | 'kept'
  /** Why the guard keeps it, in words. */
  reason?: string | undefined
}

/** What still runs after Done: a service, a deployment preview. */
export interface Leftover {
  id: string
  what: string
  /** Why it still runs, in words. */
  reason: string
}

/** The record of a mission once it is over: everything it holds, readable. */
export interface MissionRecord {
  rounds: readonly { n: number; points: number; words: string }[]
  feedback: number
  proofs: readonly { id: string; title: string; byHand?: boolean | undefined }[]
  evidence: readonly { what: string; detail: string }[]
  memory: { now: string; journal: number; notes: number }
}

export interface DoneMoment {
  delivered: readonly Delivered[]
  merged: readonly MergedRequirement[]
  conflict?: ClosingConflict | undefined
  cleanup: readonly CleanupItem[]
  leftovers: readonly Leftover[]
  record: MissionRecord
}

export interface CancelledMoment {
  /** What the cancel stopped, one line each. */
  stopped: readonly { what: string; detail: string }[]
  /** Repositories delivered before the cancel: they stay delivered. */
  delivered: readonly Delivered[]
  /** The work kept: the branches and their commits, unpushed or pushed. */
  kept: readonly { repository: string; branch: string; detail: string }[]
  /** What the cleanup would remove, and what its guard would keep. */
  cleanup: readonly CleanupItem[]
  /** Whether the user confirmed the cleanup already. */
  cleaned: boolean
}
