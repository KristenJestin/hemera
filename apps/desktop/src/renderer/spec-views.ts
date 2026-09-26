import {
  type GateFailure,
  contractOf,
  focusOf,
  readyGate,
  sectionOwner,
  takeOverRefusal,
} from '@hemera/core'
import type {
  JournalEntry,
  PhaseId,
  SectionName,
  Session,
  SpecAnswer as WireAnswer,
  SpecLaunches,
  SpecQuestion,
  SpecRevision,
  SpecSnapshot,
} from '@hemera/ipc'
import type {
  GateCheck,
  LaunchView,
  Mark,
  PhaseView,
  ReaderView,
  ReadinessItem,
  ReadinessView,
  RevisionView,
  SectionView,
  SpecAnswer,
  SpecQuestionView,
  SpecTarget,
  SpecView,
  StoryView,
  TaskView,
} from '@hemera/ui'

/**
 * A Spec snapshot as the Spec panel of `@hemera/ui` draws it (design D7-01, D7-08, D7-10, D7-12).
 *
 * The design system mirrors nothing of the domain: its view says what is shown, already decided —
 * one sentence of what is happening, a mark per part, the readiness as seven segments and the
 * things left before ready. This is where a snapshot, its revisions and its Journal become
 * that. Pure, and free of what `@hemera/ui` runs when it loads, so it is
 * tested on Node.
 */

/** Everything a Spec view is read from: the store's answers, as they came. */
export interface SpecReading {
  snapshot: SpecSnapshot
  revisions: readonly SpecRevision[]
  /** The Spec's lines of the Journal, newest first. */
  journal: readonly JournalEntry[]
  /** What the last "Mark ready" was refused with, which the readiness bar says. */
  readyRefused?: string | null | undefined
}

const PHASES: readonly PhaseId[] = ['shape', 'plan', 'decompose', 'prototype']

const PHASE_WORDS: Record<PhaseId, string> = {
  shape: 'Shape',
  plan: 'Plan',
  decompose: 'Decompose',
  prototype: 'Prototype',
}

/** How a section is named inside a sentence. */
const SECTION_WORDS: Record<SectionName, string> = {
  problem: 'the problem',
  expected_outcome: 'the expected outcome',
  scope: 'the scope',
  verification: 'the verification',
  plan: 'the plan',
  behaviour: 'the behaviour',
  reproduction: 'the reproduction',
  invariants: 'the invariants',
}

/** Where the document is taken to fix what a phase lacks. */
const PHASE_TARGETS: Record<PhaseId, SpecTarget> = {
  shape: 'problem',
  plan: 'plan',
  decompose: 'tasks',
  prototype: 'plan',
}

/** The engine's name of a check, and the one the readiness bar draws (D7-10). */
const CHECKS: Record<GateFailure['check'], GateCheck> = {
  type_contract: 'contract',
  references: 'references',
  coverage: 'coverage',
  cycle: 'cycle',
  blocking_question: 'questions',
  phase: 'phases',
  attestation: 'attestation',
}

/** The seven checks, in the order the bar draws them. */
const GATE_ORDER: readonly GateCheck[] = [
  'contract',
  'references',
  'coverage',
  'cycle',
  'questions',
  'phases',
  'attestation',
]

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** A day as the panel says it: `23 Sep`. */
export function dayOf(at: number): string {
  const date = new Date(at)
  return `${String(date.getDate())} ${MONTHS[date.getMonth()] ?? ''}`
}

/** Whether the revision shown is the Spec's current one. */
function isCurrent(snapshot: SpecSnapshot): boolean {
  return snapshot.revision.id === snapshot.spec.currentRevisionId
}

/** Whether it may be edited: the current revision of a draft Spec (D7-04). */
function isEditable(snapshot: SpecSnapshot): boolean {
  return isCurrent(snapshot) && snapshot.spec.status === 'draft'
}

function phaseState(snapshot: SpecSnapshot, phase: PhaseId) {
  return snapshot.phases.find((one) => one.phase === phase)?.state ?? 'pending'
}

/** `S1`, `S2`: the stories by their order in the revision. */
function storyKeys(snapshot: SpecSnapshot): Map<string, string> {
  return new Map(snapshot.stories.map((story, at) => [story.id, `S${String(at + 1)}`]))
}

/** `T1`, `T2`: the tasks by their order in the contract. */
function taskKeys(snapshot: SpecSnapshot): Map<string, string> {
  return new Map(snapshot.tasks.map((task, at) => [task.id, `T${String(at + 1)}`]))
}

/**
 * The mark of a section: nothing written, out of date because the phase that owns it is stale
 * (D7-08), or who wrote it last.
 */
function sectionMark(
  snapshot: SpecSnapshot,
  name: SectionName,
  author: 'agent' | 'human' | null,
): Mark {
  if (author === null) return 'empty'
  if (phaseState(snapshot, sectionOwner(name)) === 'stale') return 'stale'
  return author
}

/** The sections, each with its mark: read, never edited by hand (issue #135). */
export function sectionsOf(snapshot: SpecSnapshot): SectionView[] {
  return snapshot.sections.map((section) => {
    const author = section.body.trim() === '' ? null : section.author
    return {
      name: section.name,
      body: section.body,
      author,
      mark: sectionMark(snapshot, section.name, author),
    }
  })
}

function storiesOf(snapshot: SpecSnapshot): StoryView[] {
  const keys = storyKeys(snapshot)
  return snapshot.stories.map((story) => ({
    id: story.id,
    key: keys.get(story.id) ?? '',
    title: story.title,
    narrative: story.narrative,
    criteria: snapshot.criteria
      .filter((criterion) => criterion.storyId === story.id)
      .map((criterion) => criterion.body),
  }))
}

/** The tasks, with the tasks they wait on and the stories they cover named by key. */
export function tasksOf(snapshot: SpecSnapshot): TaskView[] {
  const stories = storyKeys(snapshot)
  const tasks = taskKeys(snapshot)
  return snapshot.tasks.map((task) => ({
    key: tasks.get(task.id) ?? '',
    title: task.title,
    result: task.result,
    after: snapshot.dependencies
      .filter((link) => link.taskId === task.id)
      .map((link) => tasks.get(link.dependsOnId) ?? link.dependsOnId),
    covers: snapshot.taskStories
      .filter((link) => link.taskId === task.id)
      .map((link) => stories.get(link.storyId) ?? link.storyId),
    executor: task.executor,
  }))
}

/** An answer as the design system reads it: one of the options, or a text. */
function answerOf(answer: WireAnswer | null): SpecAnswer | null {
  if (answer === null) return null
  return { optionId: answer.optionId ?? undefined, text: answer.text ?? undefined }
}

/**
 * A question of the register. A question the engine ties to no phase is drawn under `shape`,
 * the phase that frames the need: the design system has no word for none.
 */
function questionOf(question: SpecQuestion): SpecQuestionView {
  return {
    id: question.id,
    body: question.body,
    blocking: question.blocking,
    phase: question.phase ?? 'shape',
    options: question.options,
    answer: answerOf(question.answer),
  }
}

/** The state of each phase, in protocol order, which the group headings wear. */
function phasesOf(snapshot: SpecSnapshot): PhaseView[] {
  return PHASES.map((name) => ({ name, state: phaseState(snapshot, name) }))
}

/** A list part: nothing yet, stale with `decompose`, or written. */
function listMark(snapshot: SpecSnapshot, count: number): Mark {
  if (count === 0) return 'empty'
  return phaseState(snapshot, 'decompose') === 'stale' ? 'stale' : 'agent'
}

/** Whether the agent attested the content the Spec is at now (D7-10). */
function attested(snapshot: SpecSnapshot): boolean {
  return snapshot.revision.attestedContentVersion === snapshot.spec.contentVersion
}

/**
 * The one sentence under the head: the phase in focus and where it stands.
 *
 * In the reader's words, never the engine's: no revision, no attestation, no stale. Ready, it
 * says nothing: the status beside the title says it (issue #135). With every phase finished, whether the agent confirmed the Spec complete; with a phase
 * stale, that it is to review and the agent goes over it again — every phase after a Rework, the
 * one a new shaping made stale otherwise; with a blocking question of that phase open, that the answer is yours; and
 * otherwise what the agent is writing: the first empty section of the shape, the plan, the tasks.
 */
export function nowOf(snapshot: SpecSnapshot): string {
  if (!isCurrent(snapshot)) return 'An earlier version · read only'
  if (snapshot.spec.status !== 'draft') return ''
  const focus = focusOf(snapshot.phases)
  if (focus === null) {
    return attested(snapshot)
      ? 'Decompose · finished, the agent confirmed the Spec is complete'
      : 'Decompose · finished, waiting for the agent to confirm the Spec is complete'
  }
  const phase = PHASE_WORDS[focus]
  if (phaseState(snapshot, focus) === 'stale') {
    // Right after a Rework every phase that can run is stale; one stale among others finished is
    // a new shaping's doing, whatever the revision.
    const reworked = snapshot.phases.every(
      (one) => one.state === 'stale' || one.state === 'unavailable',
    )
    return reworked
      ? 'Every phase to review · the agent goes over each again'
      : `${phase} · to review, the agent goes over it again`
  }
  const waiting = snapshot.questions.some(
    (question) => question.blocking && question.resolvedAt === null && question.phase === focus,
  )
  if (waiting) return `${phase} · waiting for your answer`
  if (focus === 'decompose') return 'Decompose · the agent is splitting the tasks'
  if (focus === 'plan') return 'Plan · the agent is writing the plan'
  const empty = contractOf(snapshot.revision.type).find(
    (name) => (snapshot.sections.find((one) => one.name === name)?.body.trim() ?? '') === '',
  )
  return empty === undefined
    ? `${phase} · the agent is shaping the need`
    : `${phase} · the agent is writing ${SECTION_WORDS[empty]}`
}

function isSection(target: string): target is SectionName {
  return target in SECTION_WORDS
}

/**
 * What is left before ready, as links to where each is fixed: one item per missing section and
 * per story left uncovered, one for the blocking questions and one for the phases, however many
 * each counts, and the attestation, which has no part in the document to link to.
 */
function todoOf(snapshot: SpecSnapshot, failures: readonly GateFailure[]): ReadinessItem[] {
  const keys = storyKeys(snapshot)
  const items: ReadinessItem[] = []
  const add = (item: ReadinessItem): void => {
    if (!items.some((one) => one.label === item.label)) items.push(item)
  }
  const questions = failures.filter((failure) => failure.check === 'blocking_question').length
  const phases = PHASES.filter((phase) =>
    failures.some((failure) => failure.check === 'phase' && failure.target === phase),
  )
  for (const failure of failures) {
    const { check, target } = failure
    if (check === 'type_contract') {
      add(isSection(target) ? { label: SECTION_WORDS[target], target } : { label: 'the title' })
    } else if (check === 'references' || check === 'cycle') {
      add({ label: 'the task links', target: 'tasks' })
    } else if (check === 'coverage' && target === 'tasks') {
      add({ label: 'the tasks', target: 'tasks' })
    } else if (check === 'coverage') {
      const key = keys.get(target) ?? target
      if (!snapshot.criteria.some((criterion) => criterion.storyId === target)) {
        add({ label: `criteria for ${key}`, target: 'stories' })
      }
      if (!snapshot.taskStories.some((link) => link.storyId === target)) {
        add({ label: `a task for ${key}`, target: 'tasks' })
      }
    } else if (check === 'blocking_question') {
      add({
        label:
          questions === 1 ? 'the blocking question' : `${String(questions)} blocking questions`,
        target: 'questions',
      })
    } else if (check === 'phase') {
      add({ label: phases.join(' and '), target: PHASE_TARGETS[phases[0] ?? 'shape'] })
    } else {
      add({ label: "the agent's final check" })
    }
  }
  return items
}

/**
 * Whether a check that passes stands on something written or decided (issue #130).
 *
 * The gate passes a check on nothing at all: no task has no broken link and no cycle, no question
 * leaves none open. A bar that drew those filled was partly green on a Spec where nothing was
 * written. A segment fills for what the Spec holds: tasks for the links and the cycles, stories or
 * tasks for the coverage, a question answered for the questions. The contract, the phases and the
 * attestation pass only on what was written or declared, and stand on it already.
 */
function grounded(check: GateCheck, snapshot: SpecSnapshot): boolean {
  switch (check) {
    case 'references':
    case 'cycle':
      return snapshot.tasks.length > 0
    case 'coverage':
      return snapshot.stories.length > 0 || snapshot.tasks.length > 0
    case 'questions':
      return snapshot.questions.some((question) => question.answer !== null)
    default:
      return true
  }
}

/**
 * The readiness of the revision shown (D7-10): the ready gate of `@hemera/core`, run on the very
 * snapshot on screen — so what it says and the content version "Mark ready" is sent with are one
 * reading — check by check, each failing one naming what fails. A check the gate passes on
 * nothing is not drawn as met until the Spec holds what it is about; a gate that passes whole
 * meets every check. A frozen revision passed its gate when it was frozen, and is drawn so.
 * `failed` is what the gate answers of the snapshot, handed in by a test that looks at one check.
 */
export function readinessOf(
  snapshot: SpecSnapshot,
  failed: readonly GateFailure[] = readyGate(snapshot),
): ReadinessView {
  const failures = isEditable(snapshot) ? failed : []
  return {
    checks: GATE_ORDER.map((check) => {
      const failing = failures.filter((failure) => CHECKS[failure.check] === check)
      return failing.length === 0
        ? { check, passed: failures.length === 0 || grounded(check, snapshot) }
        : {
            check,
            passed: false,
            detail: `${check} · ${failing.map((failure) => failure.message).join('; ')}`,
          }
    }),
    todo: todoOf(snapshot, failures),
  }
}

/**
 * When a revision was frozen: its `spec.ready` line in the Journal; failing that — a line older
 * than the page read — the last change of a Spec still ready on it, or the Rework that followed
 * it, which is the latest it can have been frozen.
 */
function frozenAt(
  revision: SpecRevision,
  snapshot: SpecSnapshot,
  revisions: readonly SpecRevision[],
  journal: readonly JournalEntry[],
): number {
  const line = journal.find(
    (entry) => entry.type === 'spec.ready' && entry.revisionId === revision.id,
  )
  if (line !== undefined) return Date.parse(line.occurredAt)
  if (revision.id === snapshot.spec.currentRevisionId) return snapshot.spec.updatedAt
  const next = revisions.find((one) => one.number === revision.number + 1)
  return next?.createdAt ?? revision.createdAt
}

/** The revisions for the picker, newest first: the current one and the older, read only. */
export function revisionsOf(
  snapshot: SpecSnapshot,
  revisions: readonly SpecRevision[],
  journal: readonly JournalEntry[],
): RevisionView[] {
  return revisions
    .toSorted((one, other) => other.number - one.number)
    .map((revision) => ({
      number: revision.number,
      detail:
        revision.id === snapshot.spec.currentRevisionId
          ? `Latest · ${snapshot.spec.status === 'draft' ? 'draft' : 'ready'}`
          : `Marked ready ${dayOf(frozenAt(revision, snapshot, revisions, journal))} · read only`,
    }))
}

/**
 * A refused "Mark ready" in the reader's words. The engine's refusal of a Spec that does not pass
 * its gate lists the gate's failures in its own vocabulary — phases, attestation — which the bar
 * above already says plainly; a Spec that changed meanwhile is said as it is.
 */
export function plainRefusal(key: string, refused: string | null | undefined): string | undefined {
  if (refused === null || refused === undefined) return undefined
  return refused.includes('does not pass its gate')
    ? `${key} is not ready yet: see what is left above.`
    : refused
}

/** The whole view of the panel. */
export function specViewOf({ snapshot, revisions, journal, readyRefused }: SpecReading): SpecView {
  return {
    key: snapshot.spec.key,
    title: snapshot.revision.title,
    type: snapshot.revision.type,
    // The revision shown speaks for itself: the current one carries the Spec's own status, which a
    // build makes `in_progress` (D8-13), and an older one reads as frozen, whatever the Spec is
    // now (D7-05).
    status: isCurrent(snapshot) ? snapshot.spec.status : 'ready',
    revision: snapshot.revision.number,
    revisions: revisionsOf(snapshot, revisions, journal),
    phases: phasesOf(snapshot),
    now: nowOf(snapshot),
    sections: sectionsOf(snapshot),
    stories: storiesOf(snapshot),
    storiesMark: listMark(snapshot, snapshot.stories.length),
    tasks: tasksOf(snapshot),
    tasksMark: listMark(snapshot, snapshot.tasks.length),
    questions: snapshot.questions.map(questionOf),
    questionsMark:
      snapshot.questions.length === 0 ? 'empty' : (snapshot.questions.at(-1)?.raisedBy ?? 'agent'),
    readiness: {
      ...readinessOf(snapshot),
      refused: plainRefusal(snapshot.spec.key, readyRefused),
    },
    frozenOn: isEditable(snapshot)
      ? undefined
      : dayOf(frozenAt(snapshot.revision, snapshot, revisions, journal)),
    // An older revision offers no Rework, which the engine would refuse: only the current one
    // can be reworked (D7-05).
    replacedBy: isCurrent(snapshot)
      ? undefined
      : revisions.find((one) => one.id === snapshot.spec.currentRevisionId)?.number,
  }
}

/**
 * The launch of the Spec's build as the panel's head reads it (D8-13): where it stands, the step
 * its Workspace is preparing while it waits, and — refused — the engine's own words for it, which
 * are the only thing that says what to do about it. `null` while no launch has been asked for.
 *
 * The step belongs to the Workspace (D8-05) and is read beside the launch, not inside it: what a
 * preparation is doing is what the launch is waiting for, and it is named where it stands.
 */
export function launchOf(launches: SpecLaunches | null): LaunchView | null {
  if (launches === null || launches.launch === null) return null
  const { state, detail } = launches.launch
  switch (state) {
    case 'waiting':
      return launches.step === null ? { state } : { state, step: launches.step }
    case 'starting':
    case 'started':
    case 'cancelled':
      return { state }
    case 'failed':
      return { state, cause: detail ?? 'the agent did not start' }
  }
}

/**
 * The Workspaces a build may be started in, and the one the Spec is set on (D8-12): `main` first,
 * as the engine orders them, then the ones made by hand. Absent while no Workspace is ready.
 */
export function specWorkspacesOf(launches: SpecLaunches | null) {
  if (launches === null) return { workspace: undefined, workspaces: [] }
  return {
    workspace: launches.workspace ?? undefined,
    workspaces: launches.workspaces,
  }
}

/**
 * Present when this Session reads a draft another Session writes (D7-11): the name of the
 * writer, and why `Take over` is refused while the writer runs a turn — the engine's own rule,
 * so the button is disabled exactly when the engine would refuse it (Decided 14).
 */
export function readerOf(
  snapshot: SpecSnapshot,
  sessionId: string,
  sessions: readonly Session[],
  running: (sessionId: string) => boolean,
): ReaderView | undefined {
  const writer = snapshot.spec.writerSessionId
  if (writer === sessionId || !isEditable(snapshot)) return undefined
  const title = sessions.find((one) => one.id === writer)?.title ?? null
  return {
    writer: title ?? 'none',
    takeOverRefused: takeOverRefusal(snapshot.spec, title, writer !== null && running(writer)),
  }
}
