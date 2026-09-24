/**
 * A Spec: the contract a `define` Session writes and a human freezes (design D7-01).
 *
 * One entity, three types. A Spec holds revisions; a revision holds its sections as versioned
 * rows, its stories, criteria, tasks, questions and the durable state of its phases. Everything
 * here is pure: the engine reads a snapshot of one revision and asks these functions what is
 * missing, what is writable and which phase comes next.
 */

/** What a Spec proves: a new behaviour, a vanished bug, or an unchanged behaviour (D7-06). */
export const SPEC_TYPES = ['feature', 'bug', 'maintenance'] as const

export type SpecType = (typeof SPEC_TYPES)[number]

/** The statuses of a Spec; this lot writes `draft` and `ready` only (D7-03). */
export const SPEC_STATUSES = ['draft', 'ready', 'in_progress', 'cancelled'] as const

export type SpecStatus = (typeof SPEC_STATUSES)[number]

/** The closed set of section names: the base, the plan and each type's own section (D7-01). */
export const SECTION_NAMES = [
  'problem',
  'expected_outcome',
  'scope',
  'verification',
  'plan',
  'behaviour',
  'reproduction',
  'invariants',
] as const

export type SectionName = (typeof SECTION_NAMES)[number]

/** The sections every type requires. */
export const BASE_SECTIONS = ['problem', 'expected_outcome', 'scope', 'verification'] as const

/** Who wrote a section or raised a question. */
export const SPEC_ACTORS = ['human', 'agent'] as const

export type SpecActor = (typeof SPEC_ACTORS)[number]

/** Who carries out a task of the contract. */
export const TASK_EXECUTORS = ['agent', 'human'] as const

export type TaskExecutor = (typeof TASK_EXECUTORS)[number]

/** The phases of the `define` protocol, in presentation order (D7-08). */
export const PHASE_IDS = ['shape', 'plan', 'decompose', 'prototype'] as const

export type PhaseId = (typeof PHASE_IDS)[number]

/** The durable state of one phase on one revision (D7-08). */
export const PHASE_STATES = ['pending', 'open', 'finished', 'stale', 'unavailable'] as const

export type PhaseState = (typeof PHASE_STATES)[number]

export interface Spec {
  id: string
  projectId: string
  /** `PREFIX-n`, minted at creation and never reused (D7-02). */
  key: string
  slug: string
  status: SpecStatus
  priority: string | null
  /** A Spec needs no Workspace. */
  workspaceId: string | null
  currentRevisionId: string
  /** The one Session whose agent may write the draft (D7-11). */
  writerSessionId: string | null
  /** Bumped by every write; what an attestation and a "Mark ready" click are made against. */
  contentVersion: number
  createdAt: number
  updatedAt: number
}

export interface SpecRevision {
  id: string
  specId: string
  number: number
  title: string
  type: SpecType
  changeSummary: string | null
  changeReason: string | null
  createdBy: SpecActor
  /** The `contentVersion` the agent attested the contract on, if it did (D7-10). */
  attestedContentVersion: number | null
  createdAt: number
}

export interface SpecSection {
  id: string
  revisionId: string
  name: SectionName
  /** Markdown. */
  body: string
  /** Bumped by every write of this section: the conflict and staleness rules read it (D7-12). */
  version: number
  author: SpecActor
  /** The Session the write came from. */
  sessionId: string | null
  updatedAt: number
}

export interface UserStory {
  id: string
  revisionId: string
  title: string
  narrative: string
  priority: string | null
  rank: string
}

export interface AcceptanceCriterion {
  id: string
  storyId: string
  body: string
  rank: string
}

export interface TaskSet {
  id: string
  revisionId: string
  kind: 'contract'
}

export interface SpecTask {
  id: string
  taskSetId: string
  title: string
  result: string
  type: string
  executor: TaskExecutor
  criteria: string
  rank: string
}

/** `taskId` depends on `dependsOnId`. */
export interface TaskDependency {
  taskId: string
  dependsOnId: string
}

/** `taskId` covers `storyId`. */
export interface TaskStory {
  taskId: string
  storyId: string
}

/** One answer offered with a question; the agent may recommend one of them (D7-01). */
export interface SpecQuestionOption {
  id: string
  label: string
  recommended?: boolean | undefined
}

/**
 * The human's answer to a question: one of its options, or words of their own — exactly one of
 * the two (D7-03).
 */
export interface SpecAnswer {
  optionId: string | null
  text: string | null
}

export interface SpecQuestion {
  id: string
  revisionId: string
  body: string
  blocking: boolean
  phase: PhaseId | null
  raisedBy: SpecActor
  /** The answers offered; empty when the question takes free text only. */
  options: SpecQuestionOption[]
  /** `null` while the question is open. */
  answer: SpecAnswer | null
  resolvedAt: number | null
}

export interface SpecPhase {
  id: string
  revisionId: string
  phase: PhaseId
  state: PhaseState
  summary: string | null
  assumptions: string[]
  /** The version of each section the phase was declared on (D7-08). */
  basis: Partial<Record<SectionName, number>>
  protocolVersion: number
  declaredAt: number | null
}

/** Everything the gate, the panel and the brief read: one revision of one Spec. */
export interface SpecSnapshot {
  spec: Spec
  revision: SpecRevision
  sections: SpecSection[]
  stories: UserStory[]
  criteria: AcceptanceCriterion[]
  tasks: SpecTask[]
  dependencies: TaskDependency[]
  taskStories: TaskStory[]
  questions: SpecQuestion[]
  phases: SpecPhase[]
  /**
   * When the writer Session's agent was last briefed, or null before its first brief (Decided
   * 17): a human edit after it is sent to the agent with the next turn.
   */
  briefedAt: number | null
}

export class InvalidSpecTitleError extends Error {
  constructor() {
    super('a Spec keeps a title: an empty title is refused')
    this.name = 'InvalidSpecTitleError'
  }
}

/** A task write that would close a cycle; `path` is closed, by task title (D7-06). */
export class TaskCycleError extends Error {
  readonly path: string[]

  constructor(path: string[]) {
    super(`the task dependencies form a cycle: ${path.join(' → ')}`)
    this.path = path
    this.name = 'TaskCycleError'
  }
}

/** A write refused by `writable`, carrying its reason (D7-04). */
export class SpecNotWritableError extends Error {
  constructor(refusal: WriteRefusal) {
    super(refusal)
    this.name = 'SpecNotWritableError'
  }
}

/** A section written against a version that is no longer its current one (D7-12). */
export class StaleSectionError extends Error {
  readonly section: SectionName
  readonly baseVersion: number
  readonly currentVersion: number

  constructor(section: SectionName, baseVersion: number, currentVersion: number) {
    super(
      `the ${section} section changed since version ${baseVersion}: it is at version ${currentVersion}`,
    )
    this.section = section
    this.baseVersion = baseVersion
    this.currentVersion = currentVersion
    this.name = 'StaleSectionError'
  }
}

/** An answer that names neither or both of an option and a text, or an option not offered. */
export class InvalidAnswerError extends Error {
  constructor(reason: string) {
    super(`the answer is refused: ${reason}`)
    this.name = 'InvalidAnswerError'
  }
}

/**
 * The answer to a question, checked (D7-03): one of its options or a text, never neither nor
 * both, and an option the question offers.
 */
export function answerTo(
  question: SpecQuestion,
  given: { optionId?: string | undefined; text?: string | undefined },
): SpecAnswer {
  const text = given.text?.trim() ?? ''
  const optionId = given.optionId ?? null
  if (optionId === null && text.length === 0) {
    throw new InvalidAnswerError('it names neither an option nor a text')
  }
  if (optionId !== null && text.length > 0) {
    throw new InvalidAnswerError('it names both an option and a text')
  }
  if (optionId !== null && !question.options.some((option) => option.id === optionId)) {
    throw new InvalidAnswerError(`"${optionId}" is not an option of the question`)
  }
  return optionId === null ? { optionId: null, text } : { optionId, text: null }
}

/** What an answer says in words: the label of the option chosen, or the human's own text. */
export function answerWords(question: SpecQuestion): string | null {
  const answer = question.answer
  if (answer === null) return null
  const chosen = question.options.find((option) => option.id === answer.optionId)
  return chosen?.label ?? answer.text
}

/** The section each type adds to the base (D7-06). */
const TYPE_SECTION = {
  feature: 'behaviour',
  bug: 'reproduction',
  maintenance: 'invariants',
} as const satisfies Record<SpecType, SectionName>

/** The sections a type requires at the gate: the base plus its own (D7-06). */
export function contractOf(type: SpecType): readonly SectionName[] {
  return [...BASE_SECTIONS, TYPE_SECTION[type]]
}

/** The phase whose declaration a section feeds: `plan` owns `plan`, `shape` the rest (D7-08). */
export function sectionOwner(name: SectionName): PhaseId {
  return name === 'plan' ? 'plan' : 'shape'
}

/** What is wrong with the task graph of a revision. */
export interface GraphProblem {
  kind: 'unknown_task' | 'unknown_story' | 'cycle'
  /** The id that names nothing, or the id of the first task of the cycle. */
  target: string
  /** For a cycle: the closed path by task title, `['A', 'B', 'C', 'A']`. */
  path?: string[]
}

/**
 * The problems of a revision's task graph (D7-06): a dependency or a story link naming a task
 * or a story the revision does not hold, and each cycle of dependencies, as a closed path by
 * title in the direction of the dependencies.
 */
export function taskGraph(
  tasks: readonly SpecTask[],
  dependencies: readonly TaskDependency[],
  taskStories: readonly TaskStory[],
  stories: readonly UserStory[],
): GraphProblem[] {
  const byId = new Map(tasks.map((task) => [task.id, task]))
  const storyIds = new Set(stories.map((story) => story.id))
  const problems: GraphProblem[] = []

  for (const { taskId, dependsOnId } of dependencies) {
    for (const id of [taskId, dependsOnId]) {
      if (!byId.has(id)) problems.push({ kind: 'unknown_task', target: id })
    }
  }
  for (const { taskId, storyId } of taskStories) {
    if (!byId.has(taskId)) problems.push({ kind: 'unknown_task', target: taskId })
    if (!storyIds.has(storyId)) problems.push({ kind: 'unknown_story', target: storyId })
  }

  const next = new Map<string, string[]>()
  for (const { taskId, dependsOnId } of dependencies) {
    if (byId.has(taskId) && byId.has(dependsOnId)) {
      next.set(taskId, [...(next.get(taskId) ?? []), dependsOnId])
    }
  }

  // Depth-first walk: an edge back onto the current path closes a cycle.
  const done = new Set<string>()
  const path: string[] = []
  const visit = (id: string): void => {
    path.push(id)
    for (const target of next.get(id) ?? []) {
      const at = path.indexOf(target)
      if (at !== -1) {
        const cycle = [...path.slice(at), target]
        problems.push({
          kind: 'cycle',
          target,
          path: cycle.map((taskId) => byId.get(taskId)!.title),
        })
      } else if (!done.has(target)) {
        visit(target)
      }
    }
    path.pop()
    done.add(id)
  }
  for (const task of tasks) if (!done.has(task.id)) visit(task.id)

  return problems
}

/** One failed check of the ready gate or of a phase exit (D7-10). */
export interface GateFailure {
  check:
    | 'type_contract'
    | 'references'
    | 'coverage'
    | 'cycle'
    | 'blocking_question'
    | 'phase'
    | 'attestation'
  /** Where it fails: a section or phase name, or the id of a story, task, question or revision. */
  target: string
  message: string
}

function missingSections(snapshot: SpecSnapshot, required: readonly SectionName[]): GateFailure[] {
  return required
    .filter((name) => {
      const section = snapshot.sections.find((candidate) => candidate.name === name)
      return section === undefined || section.body.trim().length === 0
    })
    .map((name) => ({
      check: 'type_contract',
      target: name,
      message: `the ${name} section is missing`,
    }))
}

function graphFailures(snapshot: SpecSnapshot): GateFailure[] {
  return taskGraph(
    snapshot.tasks,
    snapshot.dependencies,
    snapshot.taskStories,
    snapshot.stories,
  ).map((problem) => {
    if (problem.kind === 'cycle') {
      return {
        check: 'cycle',
        target: problem.target,
        message: `the task dependencies form a cycle: ${problem.path!.join(' → ')}`,
      }
    }
    const what = problem.kind === 'unknown_task' ? 'task' : 'story'
    return {
      check: 'references',
      target: problem.target,
      message: `a link names a ${what} this revision does not hold`,
    }
  })
}

/**
 * Requirements covered by criteria and tasks (D7-10): each story has a criterion and a task
 * covering it; with no story, the contract still has a task. The `verification` section that
 * D7-10 also asks of a Spec without stories is required of every type, and reported once, by
 * the type contract.
 */
function coverageFailures(snapshot: SpecSnapshot): GateFailure[] {
  if (snapshot.stories.length === 0) {
    return snapshot.tasks.length === 0
      ? [{ check: 'coverage', target: 'tasks', message: 'the contract has no task' }]
      : []
  }
  const taskIds = new Set(snapshot.tasks.map((task) => task.id))
  const failures: GateFailure[] = []
  for (const story of snapshot.stories) {
    if (!snapshot.criteria.some((criterion) => criterion.storyId === story.id)) {
      failures.push({
        check: 'coverage',
        target: story.id,
        message: `the story "${story.title}" has no acceptance criterion`,
      })
    }
    if (
      !snapshot.taskStories.some((link) => link.storyId === story.id && taskIds.has(link.taskId))
    ) {
      failures.push({
        check: 'coverage',
        target: story.id,
        message: `no task covers the story "${story.title}"`,
      })
    }
  }
  return failures
}

function blockingQuestions(snapshot: SpecSnapshot, phase?: PhaseId): GateFailure[] {
  return snapshot.questions
    .filter(
      (question) =>
        question.blocking &&
        question.resolvedAt === null &&
        (phase === undefined || question.phase === phase),
    )
    .map((question) => ({
      check: 'blocking_question',
      target: question.id,
      message: `a blocking question is open: ${question.body}`,
    }))
}

/**
 * Whether a finished phase was declared on the current version of every section it owns: an
 * old declaration no longer counts (D7-08, D7-10).
 */
function onCurrentBasis(phase: SpecPhase, sections: readonly SpecSection[]): boolean {
  return sections
    .filter((section) => sectionOwner(section.name) === phase.phase)
    .every((section) => phase.basis[section.name] === section.version)
}

/**
 * The ready gate (D7-10): every failing check with its target, empty when "Mark ready" may be
 * offered. A phase `unavailable` is not activated and never blocks.
 */
export function readyGate(snapshot: SpecSnapshot): GateFailure[] {
  const failures = [
    ...missingSections(snapshot, contractOf(snapshot.revision.type)),
    ...graphFailures(snapshot),
    ...coverageFailures(snapshot),
    ...blockingQuestions(snapshot),
  ]
  for (const phase of snapshot.phases) {
    if (phase.state === 'unavailable') continue
    if (phase.state !== 'finished') {
      failures.push({
        check: 'phase',
        target: phase.phase,
        message: `the ${phase.phase} phase is ${phase.state}, not finished`,
      })
    } else if (!onCurrentBasis(phase, snapshot.sections)) {
      failures.push({
        check: 'phase',
        target: phase.phase,
        message: `the ${phase.phase} phase was finished on sections that changed since`,
      })
    }
  }
  if (snapshot.revision.attestedContentVersion !== snapshot.spec.contentVersion) {
    failures.push({
      check: 'attestation',
      target: snapshot.revision.id,
      message:
        snapshot.revision.attestedContentVersion === null
          ? 'the agent has not attested the contract'
          : 'the agent attested an earlier content of the Spec',
    })
  }
  return failures
}

/** One phase of a protocol: what it waits for, and whether this version can run it. */
export interface ProtocolPhase {
  id: PhaseId
  dependsOn: readonly PhaseId[]
  available: boolean
}

/** A mission's protocol: its version and its phases in presentation order (D7-08). */
export interface MissionProtocol {
  version: number
  phases: readonly ProtocolPhase[]
}

/**
 * The `define` protocol, v1 (D7-08): `plan` waits for `shape`, `decompose` for `plan`;
 * `prototype` waits for `shape` and is declared but unavailable in this version.
 */
export const DEFINE_PROTOCOL: MissionProtocol = {
  version: 1,
  phases: [
    { id: 'shape', dependsOn: [], available: true },
    { id: 'plan', dependsOn: ['shape'], available: true },
    { id: 'decompose', dependsOn: ['plan'], available: true },
    { id: 'prototype', dependsOn: ['shape'], available: false },
  ],
}

function protocolPhase(id: PhaseId): ProtocolPhase {
  return DEFINE_PROTOCOL.phases.find((phase) => phase.id === id)!
}

/**
 * The mechanical exit checks of a phase (core.md, "Mission protocols and phases"; D7-08). The
 * agent's semantic judgement is the other half, and is not checked here.
 */
export function phaseExit(phase: PhaseId, snapshot: SpecSnapshot): GateFailure[] {
  switch (phase) {
    case 'shape': {
      const title: GateFailure[] =
        snapshot.revision.title.trim().length === 0
          ? [{ check: 'type_contract', target: 'title', message: 'the Spec has no title' }]
          : []
      return [
        ...title,
        ...missingSections(snapshot, [
          'problem',
          'expected_outcome',
          'scope',
          TYPE_SECTION[snapshot.revision.type],
        ]),
        ...blockingQuestions(snapshot, 'shape'),
      ]
    }
    case 'plan':
      return [...missingSections(snapshot, ['plan']), ...blockingQuestions(snapshot, 'plan')]
    case 'decompose': {
      const noTask: GateFailure[] =
        snapshot.tasks.length === 0
          ? [{ check: 'coverage', target: 'tasks', message: 'the contract has no task' }]
          : []
      const coverage = coverageFailures(snapshot).filter((failure) => failure.target !== 'tasks')
      return [...noTask, ...graphFailures(snapshot), ...coverage]
    }
    case 'prototype':
      return [
        {
          check: 'phase',
          target: 'prototype',
          message: 'prototype is unavailable in this version',
        },
      ]
  }
}

function finished(phases: readonly SpecPhase[], ids: readonly PhaseId[]): boolean {
  return ids.every((id) => phases.some((phase) => phase.phase === id && phase.state === 'finished'))
}

/** Opens every `pending` phase whose dependencies are all finished; the engine persists (D7-08). */
export function nextPhaseStates(phases: readonly SpecPhase[]): SpecPhase[] {
  return phases.map((phase) =>
    phase.state === 'pending' && finished(phases, protocolPhase(phase.phase).dependsOn)
      ? { ...phase, state: 'open' }
      : phase,
  )
}

/**
 * The phase whose brief leads the turn (D7-08): the first `open` or `stale` one in protocol
 * order. The order is topological, so after a Rework or a new shaping it is the phase to
 * re-declare first.
 */
export function focusOf(phases: readonly SpecPhase[]): PhaseId | null {
  for (const { id } of DEFINE_PROTOCOL.phases) {
    const state = phases.find((phase) => phase.phase === id)?.state
    if (state === 'open' || state === 'stale') return id
  }
  return null
}

/**
 * The finished phases a section write makes stale (D7-08, "a new shaping makes the plan
 * stale"): the section's owner and every phase depending on it, directly or not, in protocol
 * order.
 */
export function staleAfterWrite(section: SectionName, phases: readonly SpecPhase[]): PhaseId[] {
  const reached = new Set<PhaseId>([sectionOwner(section)])
  for (const { id, dependsOn } of DEFINE_PROTOCOL.phases) {
    if (dependsOn.some((dependency) => reached.has(dependency))) reached.add(id)
  }
  return DEFINE_PROTOCOL.phases
    .map(({ id }) => id)
    .filter(
      (id) =>
        reached.has(id) && phases.some((phase) => phase.phase === id && phase.state === 'finished'),
    )
}

/** Why a write is refused, as the sentence shown to its author (D7-04). */
export type WriteRefusal = string

/** Who is writing: a human from any Session's panel, or the agent of a Session (D7-11). */
export interface SpecWriter {
  kind: SpecActor
  sessionId: string | null
}

/**
 * The one writability rule (D7-04): the Spec is a draft, the revision is its current one, and
 * an agent writes only from the writer Session. `null` when the write may go ahead.
 *
 * `writerTitle` is what the writer Session is called, which a refused agent is told (D7-11):
 * the caller reads it, since a Spec knows its writer by identifier only.
 */
export function writable(
  spec: Spec,
  revision: SpecRevision,
  actor: SpecWriter,
  writerTitle: string | null,
): WriteRefusal | null {
  if (spec.status !== 'draft') {
    return `${spec.key} is ${spec.status}: only a draft is written`
  }
  if (revision.id !== spec.currentRevisionId) {
    return `revision ${revision.number} of ${spec.key} is not its current revision`
  }
  if (actor.kind === 'agent' && actor.sessionId !== spec.writerSessionId) {
    return spec.writerSessionId === null
      ? `${spec.key} has no writer Session`
      : `the write right on ${spec.key} belongs to the Session "${writerTitle ?? 'another Session'}"`
  }
  return null
}

/**
 * Why the write right of a Spec may not be taken over now (D7-11, Decided 14), or `null` when it
 * may: only a draft's right moves, and never under a turn the writer Session is running. The
 * engine refuses with this sentence, and the reader bar disables its button with it.
 */
export function takeOverRefusal(
  spec: Spec,
  writerTitle: string | null,
  writerRunning: boolean,
): WriteRefusal | null {
  if (spec.status !== 'draft') {
    return `${spec.key} is ${spec.status}: only a draft's write right is taken over.`
  }
  if (spec.writerSessionId !== null && writerRunning) {
    return `The Session "${writerTitle ?? 'another Session'}" is running a turn on ${spec.key}: take over once it ends.`
  }
  return null
}

/**
 * Whether a section is a human edit the agent has not been briefed on since `briefedAt` (D7-09,
 * Decided 17). A section still as the Spec's creation left it, empty, is not an edit.
 */
export function unbriefedEdit(section: SpecSection, briefedAt: number | null): boolean {
  return (
    section.author === 'human' &&
    (briefedAt === null || section.updatedAt > briefedAt) &&
    (section.body !== '' || section.version > 1)
  )
}

/** The prefix used when a Project name gives nothing usable (Decided 2). */
export const DEFAULT_SPEC_PREFIX = 'SPEC'

/**
 * The Spec key prefix derived from a Project name (Decided 2).
 *
 * Accents are dropped and the name is cut into words of Latin letters. Several words give the
 * initials of the first four; a single word gives its first three letters, or both when it has
 * two. Upper case. A name leaving fewer than two letters gives `SPEC`.
 */
export function specPrefixFrom(projectName: string): string {
  const words = projectName
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .split(/[^A-Za-z]+/)
    .filter((word) => word.length > 0)
  const prefix =
    words.length > 1
      ? words
          .slice(0, 4)
          .map((word) => word[0])
          .join('')
      : (words[0] ?? '').slice(0, 3)
  return prefix.length >= 2 ? prefix.toUpperCase() : DEFAULT_SPEC_PREFIX
}

/** A Spec key prefix that is not 2 to 4 upper-case Latin letters (Decided 2). */
export class InvalidSpecPrefixError extends Error {
  readonly prefix: string

  constructor(prefix: string) {
    super(`the Spec key prefix "${prefix}" is refused: it takes 2 to 4 upper-case letters, A to Z`)
    this.prefix = prefix
    this.name = 'InvalidSpecPrefixError'
  }
}

/** A Spec key prefix chosen in the Project settings, refused unless 2 to 4 of A to Z (D7-02). */
export function specPrefix(value: string): string {
  if (!/^[A-Z]{2,4}$/.test(value)) throw new InvalidSpecPrefixError(value)
  return value
}

/** The human key of the `n`-th Spec of a Project (D7-02). */
export function specKey(prefix: string, n: number): string {
  return `${prefix}-${n}`
}

/** Longest slug kept, so a long title still gives a readable one. */
export const MAX_SLUG_LENGTH = 60

/**
 * The slug of a Spec, derived from its title (D7-02): lower case, accents dropped, anything
 * else than a letter or a digit collapsed into one dash. A title with nothing sluggable gives
 * `spec`; an empty title is refused.
 */
export function slugOf(title: string): string {
  if (title.trim().length === 0) throw new InvalidSpecTitleError()
  const slug = title
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/^-+|-+$/g, '')
  return slug.length > 0 ? slug : 'spec'
}

/** A Spec the agent of a `free` Session proposes to create, and its answer without the marker. */
export interface SpecProposal {
  title: string
  type: SpecType
  /** The agent's text with the marker line taken out. */
  text: string
}

/** The marker line: an HTML comment, which a Markdown reader shows nothing of. */
const PROPOSAL_MARKER = /^[ \t]*<!--\s*hemera:propose-spec\b(.*?)-->[ \t]*(?:\r?\n|$)/m

/** One `name="value"` of the marker; a value holds no double quote. */
const PROPOSAL_ATTRIBUTE = /(\w+)="([^"]*)"/g

/**
 * The Spec the agent proposes in its answer, if it does (D7-07).
 *
 * Until the agent has a `spec_propose` tool, a `free` Session's agent proposes a Spec with one
 * line of its answer, `<!-- hemera:propose-spec title="…" type="feature|bug|maintenance" -->`.
 * The line is Hemera's, not the reader's: it is taken out of the text, and the proposal is what
 * the thread shows. A marker with no title or a type that is not one of the three proposes
 * nothing and is left as it is.
 */
export function proposalIn(text: string): SpecProposal | null {
  const found = PROPOSAL_MARKER.exec(text)
  if (found === null) return null
  const attributes = new Map(
    [...(found[1] ?? '').matchAll(PROPOSAL_ATTRIBUTE)].map((match) => [match[1], match[2]]),
  )
  const title = attributes.get('title')?.trim() ?? ''
  const type = SPEC_TYPES.find((one) => one === attributes.get('type'))
  if (title.length === 0 || type === undefined) return null
  const rest = text.slice(0, found.index) + text.slice(found.index + found[0].length)
  return { title, type, text: rest.trim() }
}
