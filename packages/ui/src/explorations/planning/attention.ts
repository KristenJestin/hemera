import type { FaceState } from '../../components/face/states.ts'
import {
  type PlanningStep,
  freezeOf,
  planningNow,
  planningSteps,
  tally,
} from '../../blocks/planning/planning-progress.ts'
import type { Finding, PlanningData, Question } from '../../blocks/planning/planning-types.ts'
import type { AttentionMoment } from './fixtures.ts'

/**
 * What the Planning page tells at a glance, read from the facts alone: what happens now (the
 * face and one line), where Planning stands (its step under way), and how much waits for the user.
 */
export interface Attention {
  face: FaceState
  /** What happens now, in one line: the Planner's own line while it works. */
  now: string
  /** Where Planning stands: the step under way and how far it is. */
  progress: { step: string; detail: string }
  /** How many things wait for the user: permissions, questions to answer, findings to settle. */
  waiting: number
  /** Whether nothing is left but Freeze. */
  ready: boolean
}

/** The questions, one list in the order they were asked: the page draws no waves. */
export function questionsOf(data: PlanningData): Question[] {
  return data.waves.flatMap((wave) => wave.questions)
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
  data.probes.some((probe) => probe.state === 'running' || probe.state === 'preparing')

/**
 * The face, by what matters first. While the Planner works, it is the Planner's: writing a
 * section, taking answers in, reading. In trouble, it says so. Between its turns it shows what
 * waits for the user — a permission, a question or a finding — then what runs, then done once
 * only Freeze is left; asleep when nothing runs and nothing waits.
 */
function faceOf(moment: AttentionMoment, ready: boolean): FaceState {
  const { data, planner, permissions } = moment
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
  if (permissions.length > 0) return 'permission'
  if (open.length > 0 || findingsToSettle(data).length > 0) return 'question'
  if (data.passes.at(-1)?.state === 'failed') return 'error'
  if (coldReadReading(data)) return 'reading'
  if (running(data)) return 'running'
  if (pending.length > 0) return 'thinking'
  if (ready) return 'done'
  if (waiting.length > 0) return 'blocked'
  return 'asleep'
}

/** Who waits on a permission, in words: "Probe #1 and Probe #2". */
function askers(moment: AttentionMoment): string {
  const who = [...new Set(moment.permissions.map((permission) => permission.who))]
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

export function attentionOf(moment: AttentionMoment): Attention {
  const { data, planner, permissions } = moment
  const { open } = tally(data)
  const freeze = freezeOf(moment)
  const ready = freeze.shown && freeze.reasons.length === 0 && permissions.length === 0
  const line = planningNow(moment)
  const asked = permissions.length > 0 && planner.state !== 'working'
  return {
    face: faceOf(moment, ready),
    now: asked
      ? `${askers(moment)} ${permissions.length === 1 ? 'waits' : 'wait'} for your permission`
      : line.text,
    progress: progressOf(planningSteps(moment)),
    waiting: permissions.length + open.length + findingsToSettle(data).length,
    ready,
  }
}
