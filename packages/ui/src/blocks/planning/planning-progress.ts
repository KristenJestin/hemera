/**
 * Where Planning stands, read from what the engine knows and nothing else: the Planner's session
 * and its Now line, the sections, the waves, the cold read, the dependencies, and whether the
 * Planner declared the Spec complete. From them: the four steps the page shows at the top of its
 * rail, the head's Now line with where a press on it leads, and what stands before Freeze.
 */

import { type ColdReadPass, type PlanningData, type Question, unsettled } from './planning-types.ts'

/** The Planner's session, as the engine knows it. */
export interface Planner {
  /**
   * `working` in a turn; `idle` between turns; `stuck` when it gave no sign for a while; `failed`
   * once stopped; `silent` when its last turn ended without a word.
   */
  state: 'working' | 'idle' | 'stuck' | 'failed' | 'silent'
  /** What it says it does, its Now line: believed only while it works. */
  doing: string | null
  /** The next step it set. */
  next: string | null
  /** Why it stopped, in words. */
  reason: string | null
}

/** What the page knows at one moment. */
export interface PlanningFacts {
  data: PlanningData
  planner: Planner
  /** Whether the Planner declared the Spec complete and Hemera's check passed. */
  declaredComplete: boolean
}

export type StepId = 'spec' | 'questions' | 'coldRead' | 'freeze'

/** A step's state, drawn as the design system's marks: `waiting` is the user's to act on. */
export type StepState = 'todo' | 'running' | 'waiting' | 'done' | 'failed'

/** Where a press leads on the page: a section of the Spec, a question, a card, Freeze. */
export type PlanningTarget =
  | { kind: 'section'; name: string }
  | { kind: 'question'; id: string }
  | { kind: 'coldRead' }
  | { kind: 'triage' }
  | { kind: 'freeze' }
  | { kind: 'steps' }
  | { kind: 'vision' }
  | { kind: 'questions' }

export interface PlanningStep {
  id: StepId
  title: string
  state: StepState
  /** Where it stands, in a few words. */
  detail: string | null
  /** What the Planner said it does next, on the step under way. */
  next: string | null
  /** Where a press on the step leads. */
  target: PlanningTarget | null
}

const TITLES: Record<StepId, string> = {
  spec: 'The Spec',
  questions: 'Your answers',
  coldRead: 'Cold read',
  freeze: 'Freeze',
}

/** The eight sections of the rail: the seven prose ones and Requirements. */
const SECTIONS = 8

const plural = (count: number, one: string, many: string): string =>
  `${String(count)} ${count === 1 ? one : many}`

const questionsOf = (data: PlanningData): Question[] => data.waves.flatMap((wave) => wave.questions)

/** The questions as the steps count them: to answer, waiting on someone, on their way, answered. */
export function tally(data: PlanningData) {
  const questions = questionsOf(data)
  return {
    open: questions.filter((question) => question.state === 'open'),
    waiting: questions.filter((question) => question.state === 'waiting'),
    pending: questions.filter((question) => question.state === 'answered' && unsettled(question)),
    answered: questions.filter((question) => question.state === 'answered'),
  }
}

const lastPass = (data: PlanningData): ColdReadPass | undefined => data.passes.at(-1)

const reading = (pass: ColdReadPass | undefined): boolean =>
  pass !== undefined && (pass.state === 'running' || pass.state === 'waiting_for_slot')

const openFindings = (pass: ColdReadPass | undefined): number =>
  pass === undefined || pass.state !== 'done'
    ? 0
    : pass.findings.filter((finding) => finding.fate === 'open').length

/** The section the Planner writes now, else the first not written. */
function sectionAtWork(data: PlanningData): string | null {
  const writing = data.sections.find((section) => section.state === 'being_written')
  if (writing !== undefined) return writing.name
  if (data.requirementsState === 'being_written') return 'requirements'
  return null
}

const writtenCount = (data: PlanningData): number =>
  data.sections.filter((section) => section.state === 'written').length +
  (data.requirementsState === 'written' ? 1 : 0)

/** What stands before Freeze, in words; empty once nothing does. */
function freezeReasons({ data }: PlanningFacts): string[] {
  const { open, waiting, pending } = tally(data)
  const pass = lastPass(data)
  const asked = open.length + waiting.length
  const findings = openFindings(pass)
  const deciding = data.dependencies.filter((dependency) => dependency.state === 'proposed')
  return [
    ...(asked > 0 ? [plural(asked, 'question to answer', 'questions to answer')] : []),
    ...(pending.length > 0 ? ['Your answers are being taken into account'] : []),
    ...(pass === undefined ? ['The cold read has not run yet'] : []),
    ...(reading(pass) ? ['The cold read is reading the Spec'] : []),
    ...(pass?.state === 'failed' ? ['The cold read stopped before its report'] : []),
    ...(findings > 0 ? [plural(findings, 'finding to settle', 'findings to settle')] : []),
    ...(deciding.length > 0
      ? [plural(deciding.length, 'dependency to decide', 'dependencies to decide')]
      : []),
  ]
}

/** How many questions are left to the user, in words: "2 to answer · 1 waits on someone". */
export function leftToAnswer(data: PlanningData): string | null {
  const { open, waiting } = tally(data)
  const parts = [
    ...(open.length > 0 ? [`${String(open.length)} to answer`] : []),
    ...(waiting.length > 0 ? [plural(waiting.length, 'waits on someone', 'wait on someone')] : []),
  ]
  return parts.length === 0 ? null : parts.join(' · ')
}

/** Said in place of the questions once none is left to answer; null while one is. */
export function allAnswered(data: PlanningData): string | null {
  const { open, waiting, pending } = tally(data)
  if (open.length > 0 || waiting.length > 0) return null
  return pending.length > 0
    ? 'All questions answered — the Planner takes them into account'
    : 'All questions answered'
}

/** Freeze in the head: absent before the Spec is declared complete and once frozen; else with what stands before it. */
export type FreezeOffer = { shown: false } | { shown: true; reasons: readonly string[] }

export function freezeOf(facts: PlanningFacts): FreezeOffer {
  if (facts.data.frozen || !facts.declaredComplete) return { shown: false }
  return { shown: true, reasons: freezeReasons(facts) }
}

/** The Planner in trouble, in words; null while it works or waits for its turn. */
function trouble(planner: Planner): string | null {
  if (planner.state === 'failed') {
    return planner.reason === null
      ? 'The Planner stopped'
      : `The Planner stopped: ${planner.reason}`
  }
  if (planner.state === 'stuck') return 'The Planner has given no sign for a while'
  if (planner.state === 'silent') return 'The Planner’s last turn ended without a word'
  return null
}

/** The Spec: settled once its eight sections are written; failed with a Planner in trouble. */
function specState({ data, planner }: PlanningFacts): StepState {
  if (writtenCount(data) === SECTIONS) return 'done'
  if (trouble(planner) !== null) return 'failed'
  if (planner.state === 'working' || sectionAtWork(data) !== null) return 'running'
  return 'todo'
}

/** The answers: the user's while one is to answer, the Planner's while one is taken in. */
function questionsState({ data }: PlanningFacts): StepState {
  const { open, waiting, pending } = tally(data)
  if (data.waves.length === 0) return 'todo'
  if (open.length > 0) return 'waiting'
  if (pending.length > 0) return 'running'
  if (waiting.length > 0) return 'waiting'
  return 'done'
}

function coldReadState({ data }: PlanningFacts): StepState {
  const pass = lastPass(data)
  if (data.frozen) return 'done'
  if (pass === undefined) return 'todo'
  if (reading(pass)) return 'running'
  if (pass.state === 'failed') return 'failed'
  return openFindings(pass) > 0 ? 'waiting' : 'done'
}

function freezeState(facts: PlanningFacts): StepState {
  if (facts.data.frozen) return 'done'
  return facts.declaredComplete && freezeReasons(facts).length === 0 ? 'waiting' : 'todo'
}

function questionsDetail(facts: PlanningFacts, state: StepState): string | null {
  const { open, waiting, pending, answered } = tally(facts.data)
  if (state === 'todo') return 'Asked once the Planner meets what it cannot decide alone'
  if (state === 'done') return `${String(answered.length)} answered`
  const parts = [
    ...(open.length > 0 ? [`${String(open.length)} to answer`] : []),
    ...(waiting.length > 0 ? [plural(waiting.length, 'waits on someone', 'wait on someone')] : []),
    ...(pending.length > 0 ? [`${String(pending.length)} being taken into account`] : []),
  ]
  return parts.length === 0 ? null : parts.join(' · ')
}

function coldReadDetail(facts: PlanningFacts, state: StepState): string {
  const words: Record<StepState, string> = {
    todo: 'Once the Spec is declared complete',
    running: 'Reading the Spec',
    failed: 'Stopped before its report',
    waiting: plural(openFindings(lastPass(facts.data)), 'finding to settle', 'findings to settle'),
    done: 'Nothing left to settle',
  }
  return words[state]
}

const FREEZE_DETAIL: Record<StepState, string | null> = {
  todo: null,
  running: null,
  failed: null,
  waiting: 'Ready: yours to press',
  done: 'Frozen',
}

/** The four steps of Planning, each with its state; the Planner's next step on the one under way. */
export function planningSteps(facts: PlanningFacts): PlanningStep[] {
  const { data, planner } = facts
  const { open, waiting, pending } = tally(data)
  const states: Record<StepId, StepState> = {
    spec: specState(facts),
    questions: questionsState(facts),
    coldRead: coldReadState(facts),
    freeze: freezeState(facts),
  }
  const current = (['spec', 'questions', 'coldRead', 'freeze'] as const).find(
    (id) => states[id] !== 'done',
  )
  // The Planner's next step stands on the step under way, when it is one of the Planner's.
  const nextOn = (id: StepId): string | null =>
    id === current && (id === 'spec' || id === 'questions') ? planner.next : null
  const firstQuestion = open[0] ?? waiting[0] ?? pending[0]
  return [
    {
      id: 'spec',
      title: TITLES.spec,
      state: states.spec,
      detail: `${String(writtenCount(data))} of ${String(SECTIONS)} sections written`,
      next: nextOn('spec'),
      target: { kind: 'section', name: sectionAtWork(data) ?? 'why' },
    },
    {
      id: 'questions',
      title: TITLES.questions,
      state: states.questions,
      detail: questionsDetail(facts, states.questions),
      next: nextOn('questions'),
      target: firstQuestion === undefined ? null : { kind: 'question', id: firstQuestion.id },
    },
    {
      id: 'coldRead',
      title: TITLES.coldRead,
      state: states.coldRead,
      detail: coldReadDetail(facts, states.coldRead),
      next: null,
      target: lastPass(data) === undefined ? null : { kind: 'coldRead' },
    },
    {
      id: 'freeze',
      title: TITLES.freeze,
      state: states.freeze,
      detail: FREEZE_DETAIL[states.freeze],
      next: null,
      target: states.freeze === 'waiting' ? { kind: 'freeze' } : null,
    },
  ]
}

/** The head's Now line: what happens, whose turn it is, and where a press on it leads. */
export interface PlanningNow {
  text: string
  ball: 'agent' | 'you' | 'idle'
  target: PlanningTarget | null
  /** The cold read's pass while it reads, for its chip beside the line. */
  coldRead: ColdReadPass | null
}

const now = (
  text: string,
  ball: PlanningNow['ball'],
  target: PlanningTarget | null,
  coldRead: ColdReadPass | null = null,
): PlanningNow => ({ text, ball, target, coldRead })

/**
 * The Now line, by what matters first: the Spec frozen; the Planner's triage; the Planner in
 * trouble; the Planner at work, by its own line; then the facts — a question to answer, the cold
 * read reading, failed or with findings, answers being taken into account, Freeze ready. A Planner
 * between turns is not believed over the facts: its last line may say there is nothing left.
 */
export function planningNow(facts: PlanningFacts): PlanningNow {
  const { data, planner } = facts
  if (data.frozen) return now('The Spec is frozen', 'idle', null)
  if (data.triage !== null) {
    return now('The Planner asks whether this is new work', 'you', { kind: 'triage' })
  }
  const troubled = trouble(planner)
  if (troubled !== null) return now(troubled, 'you', { kind: 'steps' })
  if (planner.state === 'working') {
    const section = sectionAtWork(data)
    return now(
      planner.doing ?? 'The Planner is working and has not said on what yet',
      'agent',
      section === null ? { kind: 'steps' } : { kind: 'section', name: section },
    )
  }
  const { open, waiting, pending } = tally(data)
  const first = open[0]
  if (first !== undefined) {
    return now(
      open.length === 1
        ? `${first.id} waits for your answer`
        : `${String(open.length)} questions wait for your answer`,
      'you',
      { kind: 'question', id: first.id },
    )
  }
  const pass = lastPass(data)
  if (pass !== undefined && reading(pass)) {
    return now(
      pass.state === 'waiting_for_slot'
        ? 'The cold read waits for a free agent'
        : 'The cold read is reading the Spec',
      'agent',
      { kind: 'coldRead' },
      pass,
    )
  }
  if (pass?.state === 'failed') {
    return now('The cold read stopped before its report', 'you', { kind: 'coldRead' })
  }
  const findings = openFindings(pass)
  if (findings > 0) {
    return now(plural(findings, 'finding to settle', 'findings to settle'), 'you', {
      kind: 'coldRead',
    })
  }
  const taking = pending[0]
  if (taking !== undefined) {
    return now('The Planner takes your answers into account', 'agent', {
      kind: 'question',
      id: taking.id,
    })
  }
  if (facts.declaredComplete && freezeReasons(facts).length === 0) {
    return now('Ready to freeze', 'you', { kind: 'freeze' })
  }
  const someone = waiting[0]
  if (someone !== undefined) {
    return now(`${someone.id} waits on someone`, 'you', { kind: 'question', id: someone.id })
  }
  return now('The Planner waits for its next turn', 'idle', { kind: 'steps' })
}

/** The id of the element a target leads to, for the page to scroll to and focus. */
export function targetId(target: PlanningTarget): string {
  switch (target.kind) {
    case 'section':
      return `spec-${target.name}`
    case 'question':
      return `question-${target.id}`
    default:
      return `planning-${target.kind}`
  }
}
