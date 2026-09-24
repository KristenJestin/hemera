/**
 * The three Spec tools: how a `define` Session's agent reads and writes its Spec (design D7-14).
 *
 * Everything a call is about is deduced from the Session its token was minted for, never from its
 * arguments: the Spec is the Session's, and whether it may write is the Spec's writer. The writes
 * are the engine's own use cases of `specs/`, so the tool is one more door onto the one
 * writability rule (D7-04) and not a second rule: a frozen Spec, an older revision, a stale
 * section and a Session that does not hold the write right are refused there, with the sentence
 * the agent is answered with, and nothing is written. `declarePhase` and `attest` have no other
 * door than `spec_propose` (Decided 6, 16).
 */

import {
  PHASE_IDS,
  type Session,
  type SpecSnapshot,
  SPEC_PAGE_CHARACTERS,
  SPEC_TYPES,
  StaleSectionError,
  focusOf,
  renderSpecMarkdown,
  writable,
} from '@hemera/core'
import { Effect, Option, Result } from 'effect'
import { z } from 'zod'

import type { HeldWordsService } from '../agents/held.ts'
import type { SessionsService, ThreadWrite } from '../sessions.ts'
import type { SpecRefusal, SpecsService } from '../specs/specs.ts'
import { DatabaseError } from '../storage/database.ts'
import { OPTION_SENT, STORY_SENT, TASK_SENT, type ParsedCall, jsonList } from './arguments.ts'
import type { Answer } from './catalogue.ts'

/** A call to one of the three, as `parseCall` read it. */
type SpecCall = Extract<ParsedCall, { tool: 'spec_read' | 'spec_write' | 'spec_propose' }>

/**
 * What the Spec tools stand on: the Specs, the Sessions, what the agent holds unwritten, and the
 * catalogue's own way of writing an entry into a thread below it.
 */
export interface SpecToolsNeeds {
  readonly specs: SpecsService
  readonly sessions: SessionsService
  readonly held: HeldWordsService
  readonly inThread: (sessionId: string, entry: ThreadWrite) => ReturnType<SessionsService['write']>
}

/** The phase a `phase_done` names, which its schema requires it to send. */
const PHASE_NAMED = z.object({ phase: z.enum(PHASE_IDS) })

/** The Spec a `spec` proposal names, which its schema requires it to send. */
const SPEC_PROPOSED = z.object({ title: z.string(), type: z.enum(SPEC_TYPES) })

function completed(summary: string, text: string): Answer {
  return { ok: true, summary, text, paths: [] }
}

/** The Spec said no: the call is refused with its sentence, and nothing was changed. */
function refused(reason: string, text = reason): Answer {
  return { ok: false, refused: true, summary: reason, text, paths: [] }
}

/** What a phase rail reads, in one line: each phase and its state, and the focus. */
function phasesLine(snapshot: SpecSnapshot): string {
  const states = snapshot.phases.map((phase) => `${phase.phase} ${phase.state}`).join(', ')
  const focus = focusOf(snapshot.phases)
  return `phases: ${states}; ${focus === null ? 'no phase in focus' : `the focus is ${focus}`}`
}

/**
 * A refusal of the Spec, as the agent is answered. A stale section is answered with the text it
 * holds now (D7-12): the agent writes again on it rather than over it.
 */
function refusalOf(refusal: SpecRefusal, current: SpecSnapshot | null): Answer {
  if (refusal instanceof DatabaseError) {
    return { ok: false, summary: 'the Spec could not be written', text: refusal.message, paths: [] }
  }
  if (refusal instanceof StaleSectionError) {
    const section = current?.sections.find((one) => one.name === refusal.section)
    return refused(
      refusal.message,
      [
        `${refusal.message}; nothing was written.`,
        `The ${refusal.section} section as it stands, at version ${refusal.currentVersion}:`,
        section?.body ?? '',
      ].join('\n'),
    )
  }
  return refused(refusal.message, `${refusal.message}; nothing was changed.`)
}

/** One page of a text, ending on a whole line when it does not reach the end. */
function pageOf(text: string, offset: number, limit: number) {
  const start = Math.min(offset, text.length)
  const cut = Math.min(start + limit, text.length)
  const line = text.lastIndexOf('\n', cut - 1)
  const end = cut < text.length && line >= start ? line + 1 : cut
  const truncated = end < text.length
  return {
    page: text.slice(start, end),
    range: { offset: start, end, size: text.length, truncated, next: truncated ? end : null },
  }
}

/** The three tools, over the services they need. */
export function specTools({ specs, sessions, held, inThread }: SpecToolsNeeds) {
  /** The Session as its row says now, its mission and its Spec: read at every call. */
  const sessionNow = (sessionId: string) =>
    sessions.one(sessionId).pipe(
      Effect.map(({ session }): Session | null => session),
      Effect.orElseSucceed(() => null),
    )

  /** An answer, or the refusal the Spec gave, with the Spec as it stands for a stale section. */
  const settled = (specId: string, effect: Effect.Effect<Answer, SpecRefusal>) =>
    effect.pipe(
      Effect.catch((refusal: SpecRefusal) =>
        specs.read(specId).pipe(
          Effect.option,
          Effect.map((current) => refusalOf(refusal, Option.getOrNull(current))),
        ),
      ),
    )

  const read = (specId: string, call: Extract<SpecCall, { tool: 'spec_read' }>['arguments']) =>
    Effect.gen(function* () {
      const snapshot = yield* specs.read(specId, call.revision)
      const old = snapshot.revision.id !== snapshot.spec.currentRevisionId
      const head = old
        ? `revision ${snapshot.revision.number} of ${snapshot.spec.key} is not its current revision: it is read-only\n\n`
        : ''
      const { page, range } = pageOf(
        `${head}${renderSpecMarkdown(snapshot)}`,
        call.offset ?? 0,
        call.limit ?? SPEC_PAGE_CHARACTERS,
      )
      const more = range.truncated
        ? `(that is characters ${range.offset}-${range.end} of ${range.size}; the next page starts at offset ${range.end})`
        : `(that is characters ${range.offset}-${range.end} of ${range.size}, the end of the Spec)`
      return completed(
        `read ${snapshot.spec.key} (revision ${snapshot.revision.number}, characters ${range.offset}-${range.end} of ${range.size})`,
        [page, more, JSON.stringify(range)].join('\n'),
      )
    })

  const write = (
    specId: string,
    sessionId: string,
    call: Extract<SpecCall, { tool: 'spec_write' }>['arguments'],
  ) =>
    Effect.gen(function* () {
      const agent = { kind: 'agent' as const, sessionId }
      // A write names the revision it was read on when it names one: an older one is refused by
      // the same rule as any write, before anything is attempted (D7-04).
      if (call.revision !== undefined) {
        const named = yield* specs.read(specId, call.revision)
        const refusal = writable(
          named.spec,
          named.revision,
          { kind: 'human', sessionId: null },
          null,
        )
        if (refusal !== null) return refused(refusal, `${refusal}; nothing was written.`)
      }
      if (call.section !== undefined) {
        const snapshot = yield* specs.writeSection(agent, {
          specId,
          name: call.section,
          body: call.body ?? '',
          baseVersion: call.baseVersion ?? 0,
        })
        const version =
          snapshot.sections.find((section) => section.name === call.section)?.version ?? 0
        return completed(
          `wrote the ${call.section} section of ${snapshot.spec.key} (version ${version})`,
          `The ${call.section} section of ${snapshot.spec.key} is at version ${version}.\n${phasesLine(snapshot)}`,
        )
      }
      if (call.stories !== undefined) {
        const stories = jsonList(STORY_SENT)
          .parse(call.stories)
          .map(({ id, title, narrative, priority, criteria }) => ({
            id,
            title,
            narrative,
            priority: priority ?? null,
            criteria,
          }))
        const snapshot = yield* specs.writeStories(agent, { specId, stories })
        return completed(
          `wrote ${stories.length} stor${stories.length === 1 ? 'y' : 'ies'} of ${snapshot.spec.key}`,
          `${snapshot.spec.key} holds ${snapshot.stories.length} stories and ${snapshot.criteria.length} criteria.`,
        )
      }
      if (call.tasks !== undefined) {
        const tasks = jsonList(TASK_SENT).parse(call.tasks)
        const snapshot = yield* specs.writeTasks(agent, { specId, tasks })
        return completed(
          `wrote ${tasks.length} task(s) of ${snapshot.spec.key}`,
          `${snapshot.spec.key} holds ${snapshot.tasks.length} tasks and ${snapshot.dependencies.length} dependencies.`,
        )
      }
      const question = call.question ?? ''
      // What the agent said before it asked is written before the question: the thread reads in
      // the order things were said, and the question is asked after them.
      yield* held.flushed(sessionId)
      const snapshot = yield* specs.raiseQuestion(agent, {
        specId,
        body: question,
        blocking: call.blocking ?? false,
        phase: call.phase ?? null,
        options: call.options === undefined ? [] : jsonList(OPTION_SENT).parse(call.options),
      })
      return completed(
        `asked the user${call.blocking === true ? ' a blocking question' : ''}: ${question}`,
        `The question is asked in the chat and kept in ${snapshot.spec.key}; the answer comes with a later turn.`,
      )
    })

  const propose = (
    specId: string,
    sessionId: string,
    call: Extract<SpecCall, { tool: 'spec_propose' }>['arguments'],
  ) =>
    Effect.gen(function* () {
      if (call.kind === 'ready') {
        const attested = yield* specs.attest(specId, sessionId)
        const gate = yield* specs.gate(specId)
        const left = gate.failures.map((failure) => `- ${failure.message}`)
        return completed(
          `attested ${attested.spec.key} at content version ${attested.spec.contentVersion}`,
          [
            `${attested.spec.key} is attested at content version ${attested.spec.contentVersion}. It stays a draft: only the user's Mark ready freezes it.`,
            left.length === 0
              ? 'The ready gate lists nothing: the user can mark it ready.'
              : `The ready gate still lists:\n${left.join('\n')}`,
          ].join('\n'),
        )
      }
      const { phase } = PHASE_NAMED.parse(call)
      const snapshot = yield* specs.declarePhase(specId, sessionId, phase, {
        summary: call.summary ?? '',
        assumptions:
          call.assumptions === undefined ? [] : jsonList(z.string()).parse(call.assumptions),
        supporting: call.supporting,
      })
      return completed(
        `declared the ${phase} phase of ${snapshot.spec.key} finished`,
        `The ${phase} phase of ${snapshot.spec.key} is finished.\n${phasesLine(snapshot)}`,
      )
    })

  /**
   * The Spec a `free` Session's agent proposes (D7-07): the entry the human accepts or not, and
   * nothing else — the Spec is created, and the Session turns `define`, only when they accept.
   */
  const proposeSpec = (
    session: Session,
    call: Extract<SpecCall, { tool: 'spec_propose' }>['arguments'],
  ) =>
    Effect.gen(function* () {
      if (session.mission !== 'free') {
        return refused(
          `the Session "${session.title}" is ${session.mission}: only a free Session proposes a Spec`,
        )
      }
      const { title, type } = SPEC_PROPOSED.parse(call)
      const written = yield* inThread(session.id, {
        role: 'hemera',
        kind: 'spec_proposal',
        body: title,
        payload: JSON.stringify({ title, type }),
        correlationId: `proposal:${crypto.randomUUID()}`,
        settled: true,
      }).pipe(Effect.result)
      if (Result.isFailure(written)) {
        return {
          ok: false,
          summary: 'the proposal could not be written',
          text: written.failure.message,
          paths: [],
        }
      }
      return completed(
        `proposed the ${type} Spec "${title}"`,
        `The user is asked in the chat to create the ${type} Spec "${title}"; this Session defines it once they accept.`,
      )
    })

  /** One call to a Spec tool, for the Session its token was minted for. */
  return (sessionId: string, call: SpecCall): Effect.Effect<Answer> =>
    Effect.gen(function* () {
      const session = yield* sessionNow(sessionId)
      if (session !== null && call.tool === 'spec_propose' && call.arguments.kind === 'spec') {
        return yield* proposeSpec(session, call.arguments)
      }
      const specId = session?.specId ?? null
      if (specId === null) {
        return refused(
          'this Session defines no Spec',
          `${call.tool} acts on the Spec this Session defines, and it defines none: a free Session proposes one with spec_propose and kind spec.`,
        )
      }
      switch (call.tool) {
        case 'spec_read':
          return yield* settled(specId, read(specId, call.arguments))
        case 'spec_write':
          return yield* settled(specId, write(specId, sessionId, call.arguments))
        case 'spec_propose':
          return yield* settled(specId, propose(specId, sessionId, call.arguments))
      }
    })
}
