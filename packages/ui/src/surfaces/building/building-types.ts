import type { FaceState } from '../../components/face/states.ts'
import type { MissionStage } from '../../blocks/mission/vocabulary.ts'
import type { NeedRow } from '../../blocks/need/needs-you-list.tsx'
import type { LiveState } from '../../components/live-chip/live-chip.tsx'
import type { ModelChoice, PickerAgent } from '../../components/model-picker/model-picker.tsx'
import type { MarkState } from '../../components/status-mark/status-mark.tsx'

/**
 * What the Ready and Building pages draw, as #149 designed them: plain values, by the words the
 * screens use. The engine's names stay in the RPCs; the renderer turns one into the other.
 */

/** Where a task stands: done is said twice, verified by a check or not yet. */
export type TaskState =
  | 'todo'
  | 'running'
  | 'verified'
  | 'unverified'
  | 'waiting'
  | 'blocked'
  | 'skipped'

export interface Task {
  id: string
  title: string
  state: TaskState
  repositories: readonly string[]
  /** How many tries ended red, when some did. */
  failures?: number | undefined
  /** Why it is blocked, in words: the mark's tooltip. */
  cause?: string | undefined
}

/**
 * A scenario's proof: its red recorded before the code, then its green, or to run again; a
 * scenario verified by hand waits for the user once its code is written.
 */
export type ProofState = 'none' | 'red' | 'green' | 'rerun' | 'manual'

export interface Scenario {
  id: string
  title: string
  proof: ProofState
  /** When its red was recorded, once it was. */
  redAt?: string | undefined
}

export interface Requirement {
  id: string
  title: string
  tasks: readonly Task[]
  scenarios: readonly Scenario[]
}

/** A point of a review round, with the tasks it became. */
export interface RoundPoint {
  id: string
  title: string
  tasks: readonly Task[]
}

export interface Check {
  repository: string
  name: string
  state: MarkState
  /** Whether it is one of the final checks, which are drawn in full. */
  final: boolean
  /** After what it ran, in words: `after R7`. */
  after: string
  /** The end of what it printed, when it failed. */
  tail?: readonly string[] | undefined
}

export interface Change {
  repository: string
  files: number
  added: number
  deleted: number
  /** Whether the repository was changed outside Hemera since the last look. */
  outside?: boolean | undefined
}

/** A service the mission runs: its mark, its address once it published one. */
export interface Service {
  /** What its actions name it by: the run. */
  id: string
  name: string
  /** Running, or failed while it does not answer. */
  state: MarkState
  url?: string | undefined
  line: string
}

/**
 * A service the mission can run but does not run now: one it ran that stopped, or one the
 * Project's catalogue offers.
 */
export interface IdleService {
  /** What its actions name it by: the run that stopped, or the catalogue's command. */
  id: string
  name: string
  line: string
  /** Idle once stopped, failed when it ended badly. */
  state?: MarkState | undefined
  /** Whether it may leave the list: a service that stopped. */
  dismissable?: boolean | undefined
}

/** What works beside the Builder: a chip each, never stopped by hand. */
export interface Helper {
  id: string
  name: string
  kind: 'helper' | 'documenter' | 'reviewer'
  state: LiveState
  step: string
  startedAt: number
  endedAt: number | null
}

/** The phases of a Building, in order: the tasks, then what closes it. */
export interface Phase {
  id: 'tasks' | 'documentation' | 'final-checks' | 'review' | 'special'
  title: string
  state: MarkState
  detail?: string | undefined
}

export interface JournalEvent {
  at: string
  text: string
}

/** An "Allow for this mission": the action in words, who allowed it, when, and how many times used. */
export interface Grant {
  id: string
  action: string
  by: string
  at: string
  uses: number
}

export interface Budget {
  /** What the mission may spend, in words: `$40`; none when no budget is set. */
  cap: string | null
  /** What it spent so far, in words: `$12.40`. */
  spent: string
  /** How much of the budget is spent, 0 to 1; none without a budget. */
  share: number | null
  /** Whether the usage is estimated rather than measured: an agent that does not report it. */
  estimated: boolean
}

export interface Dependency {
  key: string
  title: string
  stage: MissionStage
  /** Building's percentage, while it builds. */
  percent?: number | undefined
}

/** The mission's own things, which no stage owns. */
export interface MissionThings {
  dependencies: readonly Dependency[]
  grants: readonly Grant[]
  budget: Budget
}

export interface BuildingMoment {
  /** Hemera's face for what happens; the Builder writing when left out. */
  face?: FaceState | undefined
  /** What happens now, or what waits for the user, in plain words. */
  now: string
  /** What comes next, while it works. */
  next?: string | undefined
  elapsed: string
  workspace: string
  branch: string
  /** The review round being built, 0 for the first Building. */
  round: number
  requirements: readonly Requirement[]
  /** The round's points, on a Building of a round. */
  points?: readonly RoundPoint[] | undefined
  /** `RV1…`: what the automatic review asked for, counted apart. */
  special: readonly Task[]
  phases: readonly Phase[]
  checks: readonly Check[]
  changes: readonly Change[]
  /** The services that run. */
  services: readonly Service[]
  /** The services the Project declares that do not run: each shows Start. */
  idle: readonly IdleService[]
  /** What the Project's catalogue offers that this mission does not declare. */
  catalogue: readonly IdleService[]
  helpers: readonly Helper[]
  journal: readonly JournalEvent[]
  /** Whether the journal goes further back than what it shows. */
  journalMore?: boolean | undefined
  needs: readonly NeedRow[]
  mission: MissionThings
  /** The repository changed outside Hemera, when one was. */
  outside?: string | undefined
}

/** What moved since the Freeze, as the check found it. */
export interface Moved {
  kind: 'target' | 'proof' | 'living' | 'ticket' | 'dirty'
  /** A path, a requirement of the living spec, or the ticket. */
  what: string
  /** How it moved, in words: `+12 −3 in 2 commits`. */
  how: string
  /** The agent's verdict on a file it was handed: whether the Spec still holds, and why. */
  verdict?: { holds: boolean; why: string } | undefined
}

/** The pre-launch check, in every way it can end. */
export type LaunchCheck =
  | { state: 'idle' }
  | { state: 'checking'; step: string }
  | { state: 'clear' }
  | { state: 'moved'; moved: readonly Moved[] }
  | { state: 'outdated'; moved: readonly Moved[] }
  | { state: 'unfetched'; since: string; moved: readonly Moved[] }
  | { state: 'silent'; moved: readonly Moved[] }
  | { state: 'expired' }
  | { state: 'failed'; reason: string }
  | { state: 'dependency'; dependency: Dependency }

/** The Builder's model: the mission's own choice, or what it inherits, and the Planner's advice. */
export interface BuilderModel {
  agents: readonly PickerAgent[]
  /** The user's choice for this mission; null while it inherits. */
  value: ModelChoice | null
  /** What Building runs on without a choice of the mission's own. */
  fallback?: ModelChoice | undefined
  /** The Planner's recommendation in words, `Opus · High`, and why. */
  recommended?: { words: string; why: string } | undefined
}

export interface PreparationStep {
  name: string
  state: MarkState
  detail?: string | undefined
}

export interface ReadyMoment {
  /** The frozen Spec in summary: its goal, its requirements by title, its scenarios. */
  goal: string
  requirements: readonly { id: string; title: string; scenarios: number }[]
  frozenAt: string
  model: BuilderModel
  check: LaunchCheck
  /** The recipe's steps, once the check let the launch through. */
  preparation: readonly PreparationStep[] | null
  needs: readonly NeedRow[]
  mission: MissionThings
}

/** A task as its view shows it: where it aims, its tries, what it touched and what judged it. */
export interface TaskDetail {
  task: Task
  requirement: string
  /** What it aims at: a file it creates, or one it changes. */
  targets: readonly { path: string; intent: 'create' | 'change' }[]
  tries: readonly {
    n: number
    runner: string
    state: MarkState
    took: string
  }[]
  files: readonly { path: string; added: number; deleted: number; outside: boolean }[]
  verdicts: readonly { name: string; state: MarkState; tail?: readonly string[] | undefined }[]
  conflicts: readonly { with: string; path: string; settled: string }[]
  amended?: { by: string; what: string; at: string } | undefined
}
