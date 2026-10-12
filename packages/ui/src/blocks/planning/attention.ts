import type { FaceState } from '../../components/face/states.ts'
import {
  type PlanningFacts,
  type PlanningStep,
  freezeOf,
  planningNow,
  planningSteps,
  tally,
} from './planning-progress.ts'
import { type Finding, type PlanningData, type PlanningNeed, toLookAt } from './planning-types.ts'

/**
 * What the Planning page tells at a glance, read from the facts alone: what happens now (the
 * face and one line), where Planning stands (its step under way), and how much waits for the
 * user. The face follows the order of `docs/technical/planning-attention.md`.
 */
export interface Attention {
  face: FaceState
  /** What happens now, in one line: the Planner's own line while it works. */
  now: string
  /** Where Planning stands: the step under way and how far it is. */
  progress: { step: string; detail: string }
  /**
   * How many things wait for the user: needs, questions to answer, findings to settle, results of
   * Prototypers to look at.
   */
  waiting: number
  /** Whether nothing is left but Freeze. */
  ready: boolean
}

/** What the page knows at one moment, with the mission's needs that wait. */
export interface AttentionFacts extends PlanningFacts {
  needs: readonly PlanningNeed[]
}

/** The findings of the last pass still to settle. */
export function findingsToSettle(data: PlanningData): Finding[] {
  const pass = data.passes.at(-1)
  if (pass === undefined || pass.state !== 'done') return []
  return pass.findings.filter((finding) => finding.fate === 'open')
}

const writing = (data: PlanningData): boolean =>
  data.requirementsState === 'being_written' ||
  data.sections.some((section) => section.state === 'being_written')

const coldReadReading = (data: PlanningData): boolean => {
  const state = data.passes.at(-1)?.state
  return state === 'running' || state === 'waiting_for_slot'
}

const running = (data: PlanningData): boolean =>
  data.probes.some((probe) => probe.state === 'running' || probe.state === 'preparing') ||
  data.prototypes.some((prototype) => prototype.state === 'running')

/**
 * The face, by what matters first. While the Planner works, it is the Planner's: writing a
 * section, taking answers in, reading. In trouble, it says so. Between its turns it shows what
 * waits for the user — a permission, a question or a finding — then what runs, then done once
 * only Freeze is left; asleep when nothing runs and nothing waits.
 */
function faceOf(facts: AttentionFacts, ready: boolean): FaceState {
  const { data, planner, needs } = facts
  const { open, waiting, pending } = tally(data)
  if (data.frozen) return 'done'
  if (planner.state === 'failed') return 'error'
  if (planner.state === 'stuck') return 'blocked'
  if (data.triage !== null) return 'question'
  if (planner.state === 'working') {
    if (writing(data)) return 'writing'
    if (pending.length > 0) return 'thinking'
    return 'reading'
  }
  if (needs.length > 0) return permissionsOnly(needs) ? 'permission' : 'question'
  if (open.length > 0 || findingsToSettle(data).length > 0) return 'question'
  if (data.passes.at(-1)?.state === 'failed') return 'error'
  if (coldReadReading(data)) return 'reading'
  if (running(data)) return 'running'
  if (pending.length > 0) return 'thinking'
  if (ready) return 'done'
  if (waiting.length > 0) return 'blocked'
  return 'asleep'
}

/** Whether every need that waits is a permission, as they mostly are while planning. */
const permissionsOnly = (needs: readonly PlanningNeed[]): boolean =>
  needs.every((need) => need.need.ask.kind === 'permission')

/** Who waits on the user, in words: "Probe #1 and Probe #2". */
function askers(needs: readonly PlanningNeed[]): string {
  const who = [...new Set(needs.map((need) => need.who))]
  return who.length === 1
    ? (who[0] ?? '')
    : `${who.slice(0, -1).join(', ')} and ${who.at(-1) ?? ''}`
}

/** The step under way, with how far it is; the Spec's count when that step says nothing more. */
function progressOf(steps: readonly PlanningStep[]): Attention['progress'] {
  const current = steps.find((step) => step.state !== 'done' && step.detail !== null)
  const shown = current ?? steps.find((step) => step.id === 'spec')
  return { step: shown?.title ?? '', detail: shown?.detail ?? '' }
}

/** What the page tells at a glance, from what it knows. */
export function attentionOf(facts: AttentionFacts): Attention {
  const { data, planner, needs } = facts
  const { open } = tally(data)
  const freeze = freezeOf(facts)
  const ready = freeze.shown && freeze.reasons.length === 0 && needs.length === 0
  const line = planningNow(facts)
  const asked = needs.length > 0 && planner.state !== 'working' && !data.frozen
  return {
    face: faceOf(facts, ready),
    now: asked
      ? `${askers(needs)} ${needs.length === 1 ? 'waits' : 'wait'} for your ${permissionsOnly(needs) ? 'permission' : 'answer'}`
      : line.text,
    progress: progressOf(planningSteps(facts)),
    waiting:
      needs.length +
      open.length +
      findingsToSettle(data).length +
      data.prototypes.filter(toLookAt).length,
    ready,
  }
}
