import type { StatusTone } from '../../components/status-dot/status-dot.tsx'
import type { BuildTaskState } from '../../build/model.ts'

/**
 * What the Session layout exploration draws (design exploration of 25 September 2026): a build
 * said as the Spec the user wrote, annotated with its progress, and the few words the minimised
 * chat says about its agent. View types for the exploration only; nothing of the engine.
 */

/** Where a story or one of its criteria stands in a build. */
export type Progress = 'done' | 'working' | 'todo' | 'blocked'

export const PROGRESS_LABELS: Record<Progress, string> = {
  done: 'Done',
  working: 'In progress',
  todo: 'To do',
  blocked: 'Blocked',
}

export interface CriterionProgress {
  id: string
  text: string
  progress: Progress
}

/** A task of the build, the detail under a story that one can unfold. */
export interface TaskProgress {
  label: string
  title: string
  state: BuildTaskState
}

export interface StoryProgress {
  id: string
  key: string
  title: string
  narrative: string
  criteria: CriterionProgress[]
  tasks: TaskProgress[]
}

/** The agent saying a criterion cannot be met as the Spec writes it. */
export interface BlockerProgress {
  criterionId: string
  reason: string
  /** When it was raised, already written: `6 min ago`. */
  raised: string
}

/** Building, or done and waiting for the user's review. */
export type BuildStage = 'building' | 'review'

export interface BuildProgressView {
  specKey: string
  specTitle: string
  stage: BuildStage
  stories: StoryProgress[]
  blocker?: BlockerProgress | undefined
}

/** The agent of a Session, as the minimised chat says it. */
export interface AgentState {
  name: string
  agentId: string
  tone: StatusTone
  /** What it is doing, in a few words: `Working on S1 · the column order`. */
  says: string
}

/** Something in the chat that waits for the user, which the minimised chat previews. */
export interface Attention {
  /** What it is, in two words: `Blocker`, `3 points to confirm`. */
  title: string
  /** The first line of it. */
  preview: string
}

/** One point of the user's review, as the agent restates it. */
export interface Restatement {
  id: string
  /** What the user wrote, as they wrote it. */
  point: string
  /** What the agent understood. */
  understood: string
  /** Whether doing it changes the Spec, which then asks for a rework. */
  changesSpec?: boolean | undefined
}

/** How the user answered a restatement: confirmed, or corrected with their own words. */
export type RestatementAnswer = { ok: true } | { ok: false; correction: string }
