/**
 * The Specs of a Project: created and written by `define` Sessions, frozen by a human (D7-01).
 *
 * Business operations only, no status setter (D7-03). Every write goes through `mutate`, checks
 * the one writability rule of `@hemera/core` (D7-04), bumps the Spec's `content_version`, and
 * journals its step with the Spec, the revision, the Session and the phase (D7-13). The window
 * hears of it once the transaction has committed, through `SpecNotices`.
 *
 * The protocol (`protocol.ts`), the gate (`gate.ts`), Rework (`revisions.ts`), the write right
 * (`write-right.ts`) and the entries a question writes into a thread (`thread.ts`) live beside
 * this file; this one holds the service and the content writes.
 */

import {
  type AcceptanceCriterion,
  type AgentProvider,
  type PhaseId,
  type SectionName,
  type Spec,
  type SpecQuestion,
  type SpecQuestionOption,
  type SpecRevision,
  type SpecSnapshot,
  type SpecTask,
  type SpecType,
  type SpecWriter,
  type TaskDependency,
  type TaskExecutor,
  type TaskStory,
  InvalidAnswerError,
  InvalidSpecTitleError,
  SpecNotWritableError,
  StaleSectionError,
  TaskCycleError,
  answerTo,
  answerWords,
  contractOf,
  rankBetween,
  sectionOwner,
  slugOf,
  specKey,
  taskGraph,
  writable,
  SPEC_TYPES,
} from '@hemera/core'
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import { Context, Data, Effect, Layer } from 'effect'
import { z } from 'zod'

import type { NewEvent } from '../journal.ts'
import { UnknownProjectError } from '../projects.ts'
import { UnknownWorkspaceError } from '../workspaces/described.ts'
import { type Session, type UnknownSessionError, entryOf } from '../sessions.ts'
import { Database, type DatabaseError, type EngineTransaction } from '../storage/database.ts'
import {
  acceptanceCriteria,
  projects,
  sessionEntries,
  specEditBuffers,
  specQuestions,
  specRevisions,
  specSections,
  specTasks,
  specs,
  taskDependencies,
  taskSets,
  taskStories,
  userStories,
  workspaces,
} from '../storage/schema.ts'
import { mutate } from '../transaction.ts'
import {
  type Gate,
  type ReadyRefusedError,
  type ReadyRequest,
  attestable,
  gateOf,
  markReady,
} from './gate.ts'
import { SpecNotices } from './notices.ts'
import {
  type Declaration,
  type PhaseRefusedError,
  afterSectionWrite,
  declare,
  firstPhases,
  insertPhases,
} from './protocol.ts'
import { type ReopenRefusedError, type ReopenRequest, reopen } from './revisions.ts'
import {
  type UnknownRevisionError,
  type UnknownSpecError,
  failed,
  now,
  readSnapshot,
  reading,
  revisionOf,
  specEvent,
  specOf,
  specRow,
  taskSetOf,
} from './snapshot.ts'
import { type Written, appendEntry, askedIn } from './thread.ts'
import {
  type SpecAnchorRefusedError,
  define,
  definable,
  openSessionIn,
  sessionNow,
  sessionRow,
  transferWrite,
} from './write-right.ts'

/** A Spec as a list shows it: with the title and type of its current revision. */
export interface SpecSummary extends Spec {
  title: string
  type: SpecType
}

/** The agent's proposal, accepted by the human in a `free` Session (D7-07). */
export interface NewSpec {
  sessionId: string
  type: SpecType
  title: string
}

/** A new Session on a Spec, from a list of Specs, with the agent it runs (D7-07). */
export interface SessionOpening {
  specId: string
  provider: AgentProvider
}

/** A Session on a Spec, taking its write right (D7-11). */
export interface WriteRightTaking {
  specId: string
  sessionId: string
}

/** A Session switched onto a Spec, and the Spec as it now reads (D7-07). */
export interface DefiningSession {
  session: Session
  snapshot: SpecSnapshot
}

/** A section written against the version it was read at (D7-12). */
export interface SectionWrite {
  specId: string
  name: SectionName
  body: string
  baseVersion: number
}

export interface StoryWrite {
  /** An existing story of the revision; absent for a new one. */
  id?: string | undefined
  title: string
  narrative: string
  priority: string | null
  /** The acceptance criteria, in order. */
  criteria: readonly string[]
}

export interface TaskWrite {
  /** An existing task of the revision; absent for a new one. */
  id?: string | undefined
  title: string
  result: string
  type: string
  executor: TaskExecutor
  criteria: string
  /** The tasks this one waits for, by id or by title (D7-06). */
  dependsOn: readonly string[]
  /** The stories it covers, by id or by title. */
  stories: readonly string[]
}

export interface QuestionRaise {
  specId: string
  body: string
  blocking: boolean
  phase: PhaseId | null
  /** The answers offered; none is a question answered in free text only (D7-01). */
  options: readonly SpecQuestionOption[]
}

/** One of the question's options, or a text of the human's own: one of the two (D7-03). */
export interface QuestionAnswer {
  specId: string
  questionId: string
  optionId?: string | undefined
  text?: string | undefined
}

/** A section edited in the panel and not saved yet, kept across a restart (D7-12). */
export interface EditBuffer {
  specId: string
  name: SectionName
  body: string
  baseVersion: number
  updatedAt: number
}

export interface BufferSave {
  specId: string
  name: SectionName
  body: string
  baseVersion: number
}

/** A story, task or question named by a write that the revision does not hold. */
export class UnknownSpecItemError extends Data.TaggedError('UnknownSpecItemError')<{
  readonly kind: 'story' | 'task' | 'question'
  readonly name: string
}> {
  override get message(): string {
    return `No ${this.kind} of this revision is named "${this.name}".`
  }
}

/**
 * A proposal of the agent declined that its Session does not hold, or that no longer waits for
 * an answer: declined already, or the Session defines a Spec since (issue #130).
 */
export class ProposalRefusedError extends Data.TaggedError('ProposalRefusedError')<{
  readonly proposalId: string
  readonly why: 'unknown' | 'answered'
}> {
  override get message(): string {
    return this.why === 'unknown'
      ? `This Session has no proposal "${this.proposalId}".`
      : 'This proposal was already answered.'
  }
}

/** A proposal declined, as the agent proposed it: what it is told it was refused. */
export interface DeclinedProposal {
  title: string
  type: SpecType
}

/**
 * What the agent is handed when the user declined its proposal (issue #130): Hemera's words,
 * never the user's, so that it goes on in the Session it is in rather than waiting for an answer.
 */
export function declinedNotice(proposal: DeclinedProposal): string {
  return [
    '# Proposal declined',
    '',
    `The user declined your proposal to create the ${proposal.type} Spec "${proposal.title}": no Spec was created, and this Session stays free.`,
    "This is a note from Hemera, not a message of the user's. Carry on with the conversation where it was, and do not propose that Spec again unless the user asks for it.",
  ].join('\n')
}

/** What a `spec_proposal` entry carries, as `spec_propose` wrote it. */
const PROPOSED = z.object({ title: z.string(), type: z.enum(SPEC_TYPES) })

/** The proposal an entry holds; one whose payload does not read is named by its body alone. */
function proposedIn(payload: string, body: string): DeclinedProposal {
  try {
    const read = PROPOSED.safeParse(JSON.parse(payload))
    if (read.success) return read.data
  } catch {
    // Falls through to the body, which is the title the entry was written with.
  }
  return { title: body, type: 'feature' }
}

/** Everything a Spec use case can be refused with. */
export type SpecRefusal =
  | DatabaseError
  | ProposalRefusedError
  | UnknownSpecError
  | UnknownRevisionError
  | UnknownSessionError
  | UnknownProjectError
  | UnknownSpecItemError
  | SpecAnchorRefusedError
  | SpecNotWritableError
  | StaleSectionError
  | TaskCycleError
  | InvalidSpecTitleError
  | InvalidAnswerError
  | PhaseRefusedError
  | ReadyRefusedError
  | ReopenRefusedError
  | UnknownWorkspaceError

type Answer<A> = Effect.Effect<A, SpecRefusal>

export interface SpecsService {
  readonly list: (projectId: string) => Answer<SpecSummary[]>
  /** The current revision, or an older one by number, read-only (D7-05, Decided 5). */
  readonly read: (specId: string, revision?: number) => Answer<SpecSnapshot>
  readonly revisions: (specId: string) => Answer<SpecRevision[]>
  readonly gate: (specId: string) => Answer<Gate>
  /**
   * The agent's proposal accepted (D7-02, D7-07): the Spec is created, and the `free` Session it
   * was proposed in becomes its writer and turns `define`, in one transaction.
   */
  readonly create: (input: NewSpec) => Answer<DefiningSession>
  /**
   * The agent's proposal declined (issue #130): its entry is kept `declined`, which the thread
   * draws, and the Session stays `free`. Telling the agent is the runtime's.
   */
  readonly declineProposal: (sessionId: string, proposalId: string) => Answer<DeclinedProposal>
  /** A new `define` Session on a Spec: the writer if it has none, a reader otherwise (D7-11). */
  readonly openSession: (input: SessionOpening) => Answer<DefiningSession>
  readonly writeSection: (actor: SpecWriter, input: SectionWrite) => Answer<SpecSnapshot>
  /** Replaces the stories of the current revision; kept ids keep their rank when in order. */
  readonly writeStories: (
    actor: SpecWriter,
    input: { specId: string; stories: readonly StoryWrite[] },
  ) => Answer<SpecSnapshot>
  /** Replaces the tasks of the contract; a cycle is refused and nothing is written (D7-06). */
  readonly writeTasks: (
    actor: SpecWriter,
    input: { specId: string; tasks: readonly TaskWrite[] },
  ) => Answer<SpecSnapshot>
  /** Kept in the Spec, and asked in the chat of the actor's Session when it has one (D7-01). */
  readonly raiseQuestion: (actor: SpecWriter, input: QuestionRaise) => Answer<SpecSnapshot>
  /** Human only, answered beside the question in the chat it was asked in (D7-03). */
  readonly answerQuestion: (input: QuestionAnswer) => Answer<SpecSnapshot>
  /** The agent of the writer Session declares a phase finished (D7-08); on the wire in 1b. */
  readonly declarePhase: (
    specId: string,
    sessionId: string,
    phase: PhaseId,
    declaration: Declaration,
  ) => Answer<SpecSnapshot>
  /** The agent of the writer Session attests the current content (D7-10); on the wire in 1b. */
  readonly attest: (specId: string, sessionId: string) => Answer<SpecSnapshot>
  /** Human only (D7-10). */
  readonly markReady: (request: ReadyRequest) => Answer<SpecSnapshot>
  /** Human only: Rework (D7-05). */
  readonly reopen: (request: ReopenRequest) => Answer<SpecSnapshot>
  /**
   * Human only (D8-12): the Workspace the Spec's build will run in, given without asking for a
   * build — what "Prepare a Workspace only" writes. The launch proposes itself from the panel
   * once the Workspace is ready.
   */
  readonly useWorkspace: (specId: string, workspaceId: string) => Answer<SpecSnapshot>
  /**
   * Human only: "Take the write right" (D7-11). `running` says whether a Session has a turn
   * running, which the agents know and the Spec does not (Decided 14).
   */
  readonly transferWrite: (
    input: WriteRightTaking,
    running: (sessionId: string) => boolean,
  ) => Answer<SpecSnapshot>
  readonly buffers: {
    readonly read: (specId: string) => Answer<EditBuffer[]>
    readonly save: (input: BufferSave) => Answer<EditBuffer[]>
    readonly discard: (input: { specId: string; name: SectionName }) => Answer<EditBuffer[]>
  }
}

export class Specs extends Context.Service<Specs, SpecsService>()('Specs') {}

/** A human acting from the panel of no particular Session. */
const HUMAN: SpecWriter = { kind: 'human', sessionId: null }

/**
 * The one writability rule (D7-04), as a refusal. An agent refused for the write right is told
 * the writer Session by its title (D7-11), read only then.
 */
function guard(transaction: EngineTransaction, snapshot: SpecSnapshot, actor: SpecWriter) {
  return Effect.gen(function* () {
    const writer = snapshot.spec.writerSessionId
    const writerTitle =
      actor.kind === 'agent' && writer !== null && actor.sessionId !== writer
        ? (yield* sessionRow(transaction, writer)).title
        : null
    const refused = writable(snapshot.spec, snapshot.revision, actor, writerTitle)
    if (refused !== null) return yield* Effect.fail(new SpecNotWritableError(refused))
  })
}

function answered(question: SpecQuestion, input: QuestionAnswer) {
  return Effect.try({
    try: () => answerTo(question, input),
    catch: (cause) =>
      cause instanceof InvalidAnswerError ? cause : new InvalidAnswerError(String(cause)),
  })
}

function slugged(title: string) {
  return Effect.try({
    try: () => slugOf(title),
    catch: (cause) =>
      cause instanceof InvalidSpecTitleError ? cause : new InvalidSpecTitleError(),
  })
}

/** Every write to the content bumps the Spec's `content_version` (D7-04). */
function touch(transaction: EngineTransaction, specId: string) {
  return transaction
    .update(specs)
    .set({ contentVersion: sql`${specs.contentVersion} + 1`, updatedAt: now() })
    .where(eq(specs.id, specId))
    .pipe(Effect.mapError(failed('writing the Spec')))
}

/**
 * Ranks for items in their new order (D7-01): the longest run of existing ranks already in order
 * is kept as it is, and every other item gets a rank between its neighbours. Moving one item
 * rewrites that item's rank only.
 */
function ranked<T>(items: readonly T[], rankOf: (item: T) => string | null) {
  const ranks = items.map(rankOf)
  const chains: number[][] = []
  let longest: number[] = []
  ranks.forEach((rank, index) => {
    let best: number[] = []
    if (rank !== null) {
      chains.forEach((chain, before) => {
        const last = ranks[before] ?? null
        if (chain.length > best.length && last !== null && last < rank) best = chain
      })
    }
    const chain = rank === null ? [] : [...best, index]
    chains.push(chain)
    if (chain.length > longest.length) longest = chain
  })
  const kept = new Set(longest)
  let previous: string | null = null
  return items.map((item, index) => {
    const own = ranks[index] ?? null
    const next = ranks.find((_rank, later) => later > index && kept.has(later)) ?? null
    const rank = kept.has(index) && own !== null ? own : rankBetween(previous, next)
    previous = rank
    return { item, rank, moved: rank !== own }
  })
}

/**
 * Creates a Spec, its first revision and its phases, and switches the `free` Session it was
 * proposed in to `define` as its writer (D7-02, D7-07).
 */
function createIn(transaction: EngineTransaction, input: NewSpec) {
  return Effect.gen(function* () {
    const session = yield* definable(transaction, input.sessionId)
    const title = input.title.trim()
    const slug = yield* slugged(title)
    const found = yield* transaction
      .select()
      .from(projects)
      .where(eq(projects.id, session.projectId))
      .pipe(Effect.mapError(failed('reading the Project')))
    const project = found[0]
    if (project === undefined) return yield* Effect.fail(new UnknownProjectError(session.projectId))
    // The key is minted from the counter in this transaction and never reused (D7-02).
    yield* transaction
      .update(projects)
      .set({ nextSpecNumber: project.nextSpecNumber + 1 })
      .where(eq(projects.id, project.id))
      .pipe(Effect.mapError(failed('counting the Specs')))

    const specId = crypto.randomUUID()
    const revisionId = crypto.randomUUID()
    const at = now()
    yield* transaction
      .insert(specs)
      .values({
        id: specId,
        projectId: project.id,
        key: specKey(project.specPrefix, project.nextSpecNumber),
        slug,
        status: 'draft',
        currentRevisionId: revisionId,
        writerSessionId: session.id,
        createdAt: at,
        updatedAt: at,
      })
      .pipe(Effect.mapError(failed('writing the Spec')))
    yield* transaction
      .insert(specRevisions)
      .values({
        id: revisionId,
        specId,
        number: 1,
        title,
        type: input.type,
        createdBy: 'human',
        createdAt: at,
      })
      .pipe(Effect.mapError(failed('writing the revision')))
    // The type's contract, empty: the panel shows what is to be written (D7-06).
    yield* transaction
      .insert(specSections)
      .values(
        contractOf(input.type).map((name) => ({
          id: crypto.randomUUID(),
          revisionId,
          name,
          author: 'human',
          sessionId: session.id,
          updatedAt: at,
        })),
      )
      .pipe(Effect.mapError(failed('writing the sections')))
    yield* transaction
      .insert(taskSets)
      .values({ id: crypto.randomUUID(), revisionId, kind: 'contract' })
      .pipe(Effect.mapError(failed('writing the task set')))
    const phases = firstPhases(revisionId)
    yield* insertPhases(transaction, phases)
    yield* define(transaction, session.id, specId)

    const spec = yield* specRow(transaction, specId)
    const step = { author: 'human' as const, sessionId: session.id }
    const events: NewEvent[] = [
      specEvent(spec, revisionId, 'spec.created', {
        ...step,
        payload: { key: spec.key, title, type: input.type },
      }),
      {
        type: 'session.mission_set',
        entityKind: 'session',
        entityId: session.id,
        source: 'ui',
        author: 'human',
        projectId: project.id,
        sessionId: session.id,
        payload: { mission: 'define', specId },
      },
      ...phases
        .filter((phase) => phase.state === 'open')
        .map((phase) =>
          specEvent(spec, revisionId, 'spec.phase_opened', {
            ...step,
            phaseId: phase.phase,
            payload: { phase: phase.phase, state: phase.state },
          }),
        ),
    ]
    return { specId, sessionId: session.id, events }
  })
}

/**
 * Writes one section against the version it was read at (D7-12): a stale base is refused and
 * nothing is written. A section missing from the revision (the plan, another type's) is created
 * at version 1. A human write applies the text of its buffer, which goes. Then the protocol
 * marks the finished phases it feeds stale and opens what it may (D7-08).
 */
function writeSectionIn(
  transaction: EngineTransaction,
  snapshot: SpecSnapshot,
  actor: SpecWriter,
  input: SectionWrite,
) {
  return Effect.gen(function* () {
    const current = snapshot.sections.find((section) => section.name === input.name)
    const version = current?.version ?? 0
    if (input.baseVersion !== version) {
      return yield* Effect.fail(new StaleSectionError(input.name, input.baseVersion, version))
    }
    const written = {
      body: input.body,
      version: version + 1,
      author: actor.kind,
      sessionId: actor.sessionId,
      updatedAt: now(),
    }
    yield* (
      current === undefined
        ? transaction.insert(specSections).values({
            id: crypto.randomUUID(),
            revisionId: snapshot.revision.id,
            name: input.name,
            ...written,
          })
        : transaction.update(specSections).set(written).where(eq(specSections.id, current.id))
    ).pipe(Effect.mapError(failed('writing the section')))
    if (actor.kind === 'human') {
      yield* transaction
        .delete(specEditBuffers)
        .where(
          and(eq(specEditBuffers.specId, snapshot.spec.id), eq(specEditBuffers.name, input.name)),
        )
        .pipe(Effect.mapError(failed('discarding the edit')))
    }
    const phases = yield* afterSectionWrite(transaction, snapshot, input.name, actor)
    return [
      specEvent(snapshot.spec, snapshot.revision.id, 'spec.section_written', {
        author: actor.kind,
        sessionId: actor.sessionId,
        phaseId: sectionOwner(input.name),
        payload: { name: input.name, version: version + 1, author: actor.kind },
      }),
      ...phases,
    ]
  })
}

/**
 * Writes the criteria of one story, in order (D7-01): a criterion is matched by its text, keeps
 * its row and, when still in order, its rank; the others are created or removed.
 */
function writeCriteria(
  transaction: EngineTransaction,
  storyId: string,
  existing: readonly AcceptanceCriterion[],
  bodies: readonly string[],
) {
  return Effect.gen(function* () {
    const unused = [...existing]
    const matched = bodies.map((body) => {
      const at = unused.findIndex((criterion) => criterion.body === body)
      return { body, row: at === -1 ? null : (unused.splice(at, 1)[0] ?? null) }
    })
    const write = Effect.mapError(failed('writing the criteria'))
    if (unused.length > 0) {
      const gone = unused.map((criterion) => criterion.id)
      yield* transaction
        .delete(acceptanceCriteria)
        .where(inArray(acceptanceCriteria.id, gone))
        .pipe(write)
    }
    for (const { item, rank, moved } of ranked(matched, (match) => match.row?.rank ?? null)) {
      if (item.row === null) {
        yield* transaction
          .insert(acceptanceCriteria)
          .values({ id: crypto.randomUUID(), storyId, body: item.body, rank })
          .pipe(write)
      } else if (moved) {
        yield* transaction
          .update(acceptanceCriteria)
          .set({ rank })
          .where(eq(acceptanceCriteria.id, item.row.id))
          .pipe(write)
      }
    }
  })
}

/** Replaces the stories of the revision (D7-01): given ids are kept, missing rows removed. */
function writeStoriesIn(
  transaction: EngineTransaction,
  snapshot: SpecSnapshot,
  actor: SpecWriter,
  stories: readonly StoryWrite[],
) {
  return Effect.gen(function* () {
    const existing = new Map(snapshot.stories.map((story) => [story.id, story]))
    for (const story of stories) {
      if (story.id !== undefined && !existing.has(story.id)) {
        return yield* Effect.fail(new UnknownSpecItemError({ kind: 'story', name: story.id }))
      }
    }
    const planned = stories.map((story) => ({ story, id: story.id ?? crypto.randomUUID() }))
    const write = Effect.mapError(failed('writing the stories'))
    const gone = snapshot.stories
      .filter((story) => !planned.some((plan) => plan.id === story.id))
      .map((story) => story.id)
    if (gone.length > 0) {
      yield* transaction.delete(userStories).where(inArray(userStories.id, gone)).pipe(write)
    }
    for (const { item, rank } of ranked(planned, (plan) => existing.get(plan.id)?.rank ?? null)) {
      const row = {
        title: item.story.title,
        narrative: item.story.narrative,
        priority: item.story.priority,
        rank,
      }
      yield* (
        existing.has(item.id)
          ? transaction.update(userStories).set(row).where(eq(userStories.id, item.id))
          : transaction
              .insert(userStories)
              .values({ id: item.id, revisionId: snapshot.revision.id, ...row })
      ).pipe(write)
      const criteria = snapshot.criteria.filter((criterion) => criterion.storyId === item.id)
      yield* writeCriteria(transaction, item.id, criteria, item.story.criteria)
    }
    return [
      specEvent(snapshot.spec, snapshot.revision.id, 'spec.stories_written', {
        author: actor.kind,
        sessionId: actor.sessionId,
        phaseId: 'decompose',
        payload: { stories: stories.length },
      }),
    ]
  })
}

/** The tasks of a write as the graph reads them, references resolved by id or by title. */
function resolvedTasks(snapshot: SpecSnapshot, taskSetId: string, tasks: readonly TaskWrite[]) {
  return Effect.gen(function* () {
    const existing = new Map(snapshot.tasks.map((task) => [task.id, task]))
    for (const task of tasks) {
      if (task.id !== undefined && !existing.has(task.id)) {
        return yield* Effect.fail(new UnknownSpecItemError({ kind: 'task', name: task.id }))
      }
    }
    const planned = tasks.map((task) => ({ task, id: task.id ?? crypto.randomUUID() }))
    const rows: SpecTask[] = ranked(planned, (plan) => existing.get(plan.id)?.rank ?? null).map(
      ({ item, rank }) => ({
        id: item.id,
        taskSetId,
        title: item.task.title,
        result: item.task.result,
        type: item.task.type,
        executor: item.task.executor,
        criteria: item.task.criteria,
        rank,
      }),
    )
    const dependencies = new Map<string, TaskDependency>()
    const links = new Map<string, TaskStory>()
    for (const { task, id } of planned) {
      for (const reference of task.dependsOn) {
        const target =
          planned.find((plan) => plan.id === reference) ??
          planned.find((plan) => plan.task.title === reference)
        if (target === undefined) {
          return yield* Effect.fail(new UnknownSpecItemError({ kind: 'task', name: reference }))
        }
        dependencies.set(`${id} ${target.id}`, { taskId: id, dependsOnId: target.id })
      }
      for (const reference of task.stories) {
        const story =
          snapshot.stories.find((candidate) => candidate.id === reference) ??
          snapshot.stories.find((candidate) => candidate.title === reference)
        if (story === undefined) {
          return yield* Effect.fail(new UnknownSpecItemError({ kind: 'story', name: reference }))
        }
        links.set(`${id} ${story.id}`, { taskId: id, storyId: story.id })
      }
    }
    return { rows, dependencies: [...dependencies.values()], links: [...links.values()] }
  })
}

/**
 * Replaces the tasks of the contract (D7-06): references resolve by id or title within the
 * revision, and a graph with a cycle is refused before anything is written, naming the cycle.
 */
function writeTasksIn(
  transaction: EngineTransaction,
  snapshot: SpecSnapshot,
  actor: SpecWriter,
  tasks: readonly TaskWrite[],
) {
  return Effect.gen(function* () {
    const taskSetId = yield* taskSetOf(transaction, snapshot.revision.id)
    if (taskSetId === null) return yield* Effect.die('a revision without its contract task set')
    const { rows, dependencies, links } = yield* resolvedTasks(snapshot, taskSetId, tasks)
    const cycle = taskGraph(rows, dependencies, links, snapshot.stories).find(
      (problem) => problem.kind === 'cycle',
    )
    if (cycle !== undefined) return yield* Effect.fail(new TaskCycleError(cycle.path ?? []))

    const write = Effect.mapError(failed('writing the tasks'))
    const ids = rows.map((row) => row.id)
    const kept = snapshot.tasks.filter((task) => ids.includes(task.id)).map((task) => task.id)
    const gone = snapshot.tasks.filter((task) => !ids.includes(task.id)).map((task) => task.id)
    if (gone.length > 0) {
      yield* transaction.delete(specTasks).where(inArray(specTasks.id, gone)).pipe(write)
    }
    if (kept.length > 0) {
      yield* transaction
        .delete(taskDependencies)
        .where(inArray(taskDependencies.taskId, kept))
        .pipe(write)
      yield* transaction.delete(taskStories).where(inArray(taskStories.taskId, kept)).pipe(write)
    }
    for (const row of rows) {
      yield* (
        kept.includes(row.id)
          ? transaction.update(specTasks).set(row).where(eq(specTasks.id, row.id))
          : transaction.insert(specTasks).values(row)
      ).pipe(write)
    }
    if (dependencies.length > 0) {
      yield* transaction.insert(taskDependencies).values(dependencies).pipe(write)
    }
    if (links.length > 0) yield* transaction.insert(taskStories).values(links).pipe(write)
    return [
      specEvent(snapshot.spec, snapshot.revision.id, 'spec.tasks_written', {
        author: actor.kind,
        sessionId: actor.sessionId,
        phaseId: 'decompose',
        payload: { tasks: tasks.length },
      }),
    ]
  })
}

/**
 * Raises a question (D7-01): kept in the Spec's register, and asked in the chat of the actor's
 * Session when it has one — a `spec_question` entry of Hemera's, the question as its block
 * draws it, correlated to the question.
 */
function raiseIn(
  transaction: EngineTransaction,
  snapshot: SpecSnapshot,
  actor: SpecWriter,
  input: QuestionRaise,
) {
  return Effect.gen(function* () {
    const id = crypto.randomUUID()
    const options = input.options.map((option) => ({ ...option }))
    yield* transaction
      .insert(specQuestions)
      .values({
        id,
        revisionId: snapshot.revision.id,
        body: input.body,
        blocking: input.blocking,
        phase: input.phase,
        raisedBy: actor.kind,
        options: JSON.stringify(options),
        createdAt: now(),
      })
      .pipe(Effect.mapError(failed('writing the question')))
    const raised = specEvent(snapshot.spec, snapshot.revision.id, 'spec.question_raised', {
      author: actor.kind,
      sessionId: actor.sessionId,
      phaseId: input.phase,
      payload: { body: input.body, blocking: input.blocking, options: options.length },
    })
    if (actor.sessionId === null) return { events: [raised] }
    const asked = yield* appendEntry(transaction, actor.sessionId, {
      role: 'hemera',
      kind: 'spec_question',
      body: input.body,
      payload: JSON.stringify({
        id,
        body: input.body,
        blocking: input.blocking,
        phase: input.phase,
        options,
        answer: null,
      }),
      correlationId: id,
    })
    return {
      events: [raised, asked.event],
      wrote: [{ sessionId: actor.sessionId, entry: asked.entry }],
    }
  })
}

/**
 * Answers a question (D7-03): one of its options or a text, checked by the domain; the question
 * is resolved, and the answer is written beside the question in the chat it was asked in. It
 * reaches the agent with the next turn's brief (D7-09).
 */
function answerIn(transaction: EngineTransaction, snapshot: SpecSnapshot, input: QuestionAnswer) {
  return Effect.gen(function* () {
    const question = snapshot.questions.find((candidate) => candidate.id === input.questionId)
    if (question === undefined) {
      return yield* Effect.fail(
        new UnknownSpecItemError({ kind: 'question', name: input.questionId }),
      )
    }
    if (question.resolvedAt !== null) {
      return yield* Effect.fail(new InvalidAnswerError('the question is already answered'))
    }
    const answer = yield* answered(question, input)
    yield* transaction
      .update(specQuestions)
      .set({ answerOptionId: answer.optionId, answerText: answer.text, resolvedAt: now() })
      .where(eq(specQuestions.id, question.id))
      .pipe(Effect.mapError(failed('answering the question')))
    const sessionId = yield* askedIn(transaction, question.id)
    const resolved = specEvent(snapshot.spec, snapshot.revision.id, 'spec.question_answered', {
      author: 'human',
      sessionId,
      phaseId: question.phase,
      payload: { questionId: question.id, optionId: answer.optionId },
    })
    if (sessionId === null) return { events: [resolved] }
    const beside = yield* appendEntry(transaction, sessionId, {
      role: 'user',
      kind: 'spec_answer',
      body: answerWords({ ...question, answer }) ?? '',
      // Only the half of the answer that was given: `{ questionId, optionId }` or `{ questionId,
      // text }`.
      payload: JSON.stringify({
        questionId: question.id,
        optionId: answer.optionId ?? undefined,
        text: answer.text ?? undefined,
      }),
      correlationId: question.id,
    })
    return { events: [resolved, beside.event], wrote: [{ sessionId, entry: beside.entry }] }
  })
}

function attestIn(transaction: EngineTransaction, snapshot: SpecSnapshot, actor: SpecWriter) {
  return Effect.gen(function* () {
    yield* transaction
      .update(specRevisions)
      .set({ attestedContentVersion: snapshot.spec.contentVersion })
      .where(eq(specRevisions.id, snapshot.revision.id))
      .pipe(Effect.mapError(failed('attesting the revision')))
    return [
      specEvent(snapshot.spec, snapshot.revision.id, 'spec.attested', {
        author: actor.kind,
        sessionId: actor.sessionId,
        payload: { contentVersion: snapshot.spec.contentVersion },
      }),
    ]
  })
}

function buffersOf(transaction: EngineTransaction, specId: string) {
  return transaction
    .select()
    .from(specEditBuffers)
    .where(eq(specEditBuffers.specId, specId))
    .orderBy(asc(specEditBuffers.name))
    .pipe(
      Effect.mapError(failed('reading the edits')),
      Effect.map((rows) =>
        rows.map((row): EditBuffer => ({
          specId: row.specId,
          // SAFETY: the column is checked against exactly the section names the domain declares.
          name: row.name as SectionName,
          body: row.body,
          baseVersion: row.baseVersion,
          updatedAt: Date.parse(row.updatedAt),
        })),
      ),
    )
}

/** What a step journals, and the entries it wrote into threads. */
interface Outcome {
  events: readonly NewEvent[]
  wrote?: readonly Written[] | undefined
}

/** An outcome that wrote nothing into a thread. */
const only = (events: readonly NewEvent[]): Outcome => ({ events })

/** An outcome, and the Spec it was about. */
interface Step extends Outcome {
  specId: string
}

/** A step that switched a Session onto the Spec: the answer carries the Session too (D7-07). */
interface SessionStep extends Step {
  sessionId: string
}

export const specsLayer = Layer.effect(
  Specs,
  Effect.gen(function* () {
    const database = yield* Database
    const notices = yield* SpecNotices

    const withDatabase = <A, E>(effect: Effect.Effect<A, E, Database>): Effect.Effect<A, E> =>
      effect.pipe(Effect.provideService(Database, database))

    /**
     * One mutation of a Spec: its step, then the snapshot it leaves, then the window told — of
     * the Spec, and of every entry the step wrote into a thread.
     */
    const stepping = <S extends Step, A, E>(
      doing: string,
      body: (transaction: EngineTransaction) => Effect.Effect<S, E>,
      answering: (
        transaction: EngineTransaction,
        step: S,
        snapshot: SpecSnapshot,
      ) => Effect.Effect<A, SpecRefusal>,
    ) =>
      withDatabase(
        mutate(doing, (transaction) =>
          Effect.gen(function* () {
            const step = yield* body(transaction)
            const snapshot = yield* readSnapshot(transaction, step.specId)
            const result = yield* answering(transaction, step, snapshot)
            return { result: { result, snapshot, wrote: step.wrote ?? [] }, events: step.events }
          }),
        ),
      ).pipe(
        Effect.tap(({ snapshot, wrote }) =>
          Effect.sync(() => {
            notices.changed(snapshot.spec.id, snapshot.spec.projectId)
            for (const { sessionId, entry } of wrote) notices.wrote(sessionId, entry)
          }),
        ),
        Effect.map(({ result }) => result),
      )

    /** A step answered with the snapshot it leaves. */
    const changing = <E>(
      doing: string,
      body: (transaction: EngineTransaction) => Effect.Effect<Step, E>,
    ) => stepping(doing, body, (_transaction, _step, snapshot) => Effect.succeed(snapshot))

    /** A step answered with the Session it switched onto the Spec, and the Spec (D7-07). */
    const defining = <E>(
      doing: string,
      body: (transaction: EngineTransaction) => Effect.Effect<SessionStep, E>,
    ) =>
      stepping(doing, body, (transaction, step, snapshot) =>
        sessionNow(transaction, step.sessionId).pipe(
          Effect.map((session): DefiningSession => ({ session, snapshot })),
        ),
      )

    /** A mutation of the current revision of one Spec. */
    const onSpec = <E>(
      doing: string,
      specId: string,
      body: (transaction: EngineTransaction, snapshot: SpecSnapshot) => Effect.Effect<Outcome, E>,
    ) =>
      changing(doing, (transaction) =>
        Effect.gen(function* () {
          const snapshot = yield* readSnapshot(transaction, specId)
          return { specId, ...(yield* body(transaction, snapshot)) }
        }),
      )

    /** A write of the content (D7-04): writable by this actor, and `content_version` bumped. */
    const onContent = <E>(
      doing: string,
      specId: string,
      actor: SpecWriter,
      body: (transaction: EngineTransaction, snapshot: SpecSnapshot) => Effect.Effect<Outcome, E>,
    ) =>
      onSpec(doing, specId, (transaction, snapshot) =>
        Effect.gen(function* () {
          yield* guard(transaction, snapshot, actor)
          const outcome = yield* body(transaction, snapshot)
          yield* touch(transaction, specId)
          return outcome
        }),
      )

    const agent = (sessionId: string): SpecWriter => ({ kind: 'agent', sessionId })

    return {
      list: (projectId) =>
        withDatabase(
          reading('reading the Specs', (transaction) =>
            transaction
              .select({ spec: specs, title: specRevisions.title, type: specRevisions.type })
              .from(specs)
              .innerJoin(specRevisions, eq(specRevisions.id, specs.currentRevisionId))
              .where(eq(specs.projectId, projectId))
              .orderBy(desc(specs.createdAt))
              .pipe(
                Effect.mapError(failed('reading the Specs')),
                Effect.map((rows) =>
                  rows.map((row): SpecSummary => ({
                    ...specOf(row.spec),
                    title: row.title,
                    // SAFETY: the column is checked against exactly the types the domain declares.
                    type: row.type as SpecType,
                  })),
                ),
              ),
          ),
        ),

      read: (specId, revision) =>
        withDatabase(
          reading('reading the Spec', (transaction) => readSnapshot(transaction, specId, revision)),
        ),

      revisions: (specId) =>
        withDatabase(
          reading('reading the revisions', (transaction) =>
            Effect.gen(function* () {
              yield* specRow(transaction, specId)
              const rows = yield* transaction
                .select()
                .from(specRevisions)
                .where(eq(specRevisions.specId, specId))
                .orderBy(asc(specRevisions.number))
                .pipe(Effect.mapError(failed('reading the revisions')))
              return rows.map(revisionOf)
            }),
          ),
        ),

      gate: (specId) =>
        withDatabase(
          reading('reading the gate', (transaction) =>
            readSnapshot(transaction, specId).pipe(Effect.map(gateOf)),
          ),
        ),

      create: (input) => defining('creating a Spec', (transaction) => createIn(transaction, input)),

      declineProposal: (sessionId, proposalId) =>
        withDatabase(
          mutate('declining a proposal', (transaction) =>
            Effect.gen(function* () {
              const found = yield* transaction
                .select()
                .from(sessionEntries)
                .where(
                  and(
                    eq(sessionEntries.sessionId, sessionId),
                    eq(sessionEntries.kind, 'spec_proposal'),
                    eq(sessionEntries.correlationId, `proposal:${proposalId}`),
                  ),
                )
                .limit(1)
                .pipe(Effect.mapError(failed('reading the proposal')))
              const row = found[0]
              if (row === undefined) {
                return yield* Effect.fail(new ProposalRefusedError({ proposalId, why: 'unknown' }))
              }
              const session = yield* sessionRow(transaction, sessionId)
              // A Session that defines a Spec answered every proposal it held when it was made.
              if (row.state === 'declined' || session.mission !== 'free') {
                return yield* Effect.fail(new ProposalRefusedError({ proposalId, why: 'answered' }))
              }
              const rows = yield* transaction
                .update(sessionEntries)
                .set({ state: 'declined' })
                .where(eq(sessionEntries.id, row.id))
                .returning()
                .pipe(Effect.mapError(failed('declining the proposal')))
              const entry = entryOf(rows[0] ?? row)
              const event: NewEvent = {
                type: 'session.entry_written',
                entityKind: 'session',
                entityId: sessionId,
                source: 'ui',
                author: 'human',
                projectId: session.projectId,
                sessionId,
                payload: { seq: row.seq, kind: 'spec_proposal', role: 'hemera', state: 'declined' },
              }
              return {
                result: { entry, proposal: proposedIn(row.payload, row.body) },
                events: [event],
              }
            }),
          ),
        ).pipe(
          Effect.tap(({ entry }) => Effect.sync(() => notices.wrote(sessionId, entry))),
          Effect.map(({ proposal }) => proposal),
        ),

      openSession: (input) =>
        defining('opening a Session on a Spec', (transaction) =>
          Effect.gen(function* () {
            const snapshot = yield* readSnapshot(transaction, input.specId)
            const opened = yield* openSessionIn(transaction, snapshot, input.provider)
            return { specId: input.specId, ...opened }
          }),
        ),

      writeSection: (actor, input) =>
        onContent('writing a section', input.specId, actor, (transaction, snapshot) =>
          writeSectionIn(transaction, snapshot, actor, input).pipe(Effect.map(only)),
        ),

      writeStories: (actor, input) =>
        onContent('writing the stories', input.specId, actor, (transaction, snapshot) =>
          writeStoriesIn(transaction, snapshot, actor, input.stories).pipe(Effect.map(only)),
        ),

      writeTasks: (actor, input) =>
        onContent('writing the tasks', input.specId, actor, (transaction, snapshot) =>
          writeTasksIn(transaction, snapshot, actor, input.tasks).pipe(Effect.map(only)),
        ),

      raiseQuestion: (actor, input) =>
        onContent('raising a question', input.specId, actor, (transaction, snapshot) =>
          raiseIn(transaction, snapshot, actor, input),
        ),

      answerQuestion: (input) =>
        onContent('answering a question', input.specId, HUMAN, (transaction, snapshot) =>
          answerIn(transaction, snapshot, input),
        ),

      declarePhase: (specId, sessionId, phase, declaration) =>
        onSpec('declaring a phase', specId, (transaction, snapshot) =>
          Effect.gen(function* () {
            yield* guard(transaction, snapshot, agent(sessionId))
            return only(yield* declare(transaction, snapshot, phase, agent(sessionId), declaration))
          }),
        ),

      attest: (specId, sessionId) =>
        onSpec('attesting the Spec', specId, (transaction, snapshot) =>
          Effect.gen(function* () {
            yield* guard(transaction, snapshot, agent(sessionId))
            yield* attestable(snapshot)
            return only(yield* attestIn(transaction, snapshot, agent(sessionId)))
          }),
        ),

      markReady: (request) =>
        onSpec('marking the Spec ready', request.specId, (transaction, snapshot) =>
          Effect.gen(function* () {
            yield* guard(transaction, snapshot, HUMAN)
            return only(yield* markReady(transaction, snapshot, request))
          }),
        ),

      reopen: (request) =>
        onSpec('reworking the Spec', request.specId, (transaction, snapshot) =>
          reopen(transaction, snapshot, request),
        ),

      useWorkspace: (specId, workspaceId) =>
        onSpec('giving the Spec a Workspace', specId, (transaction, snapshot) =>
          Effect.gen(function* () {
            const found = yield* transaction
              .select({ id: workspaces.id, name: workspaces.name })
              .from(workspaces)
              .where(
                and(
                  eq(workspaces.id, workspaceId),
                  eq(workspaces.projectId, snapshot.spec.projectId),
                ),
              )
              .limit(1)
              .pipe(Effect.mapError(failed('reading the Workspace')))
            const workspace = found[0]
            if (workspace === undefined) {
              return yield* Effect.fail(new UnknownWorkspaceError(workspaceId))
            }
            const at = now()
            yield* transaction
              .update(specs)
              .set({ workspaceId: workspace.id, updatedAt: at })
              .where(eq(specs.id, specId))
              .pipe(Effect.mapError(failed('giving the Spec a Workspace')))
            return only([
              specEvent(snapshot.spec, snapshot.revision.id, 'spec.workspace_used', {
                author: 'human',
                sessionId: null,
                payload: { workspaceId: workspace.id, name: workspace.name },
              }),
            ])
          }),
        ),

      transferWrite: (input, running) =>
        onSpec('moving the write right', input.specId, (transaction, snapshot) =>
          transferWrite(transaction, snapshot, input.sessionId, running).pipe(Effect.map(only)),
        ),

      buffers: {
        read: (specId) =>
          withDatabase(
            reading('reading the edits', (transaction) =>
              Effect.gen(function* () {
                yield* specRow(transaction, specId)
                return yield* buffersOf(transaction, specId)
              }),
            ),
          ),

        save: (input) =>
          withDatabase(
            mutate('keeping the edit', (transaction) =>
              Effect.gen(function* () {
                yield* specRow(transaction, input.specId)
                const kept = { body: input.body, baseVersion: input.baseVersion, updatedAt: now() }
                yield* transaction
                  .insert(specEditBuffers)
                  .values({ specId: input.specId, name: input.name, ...kept })
                  .onConflictDoUpdate({
                    target: [specEditBuffers.specId, specEditBuffers.name],
                    set: kept,
                  })
                  .pipe(Effect.mapError(failed('keeping the edit')))
                return { result: yield* buffersOf(transaction, input.specId), events: [] }
              }),
            ),
          ),

        discard: (input) =>
          withDatabase(
            mutate('discarding the edit', (transaction) =>
              Effect.gen(function* () {
                yield* specRow(transaction, input.specId)
                yield* transaction
                  .delete(specEditBuffers)
                  .where(
                    and(
                      eq(specEditBuffers.specId, input.specId),
                      eq(specEditBuffers.name, input.name),
                    ),
                  )
                  .pipe(Effect.mapError(failed('discarding the edit')))
                return { result: yield* buffersOf(transaction, input.specId), events: [] }
              }),
            ),
          ),
      },
    } satisfies SpecsService
  }),
)
