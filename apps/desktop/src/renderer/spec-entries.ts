import {
  phaseIdSchema,
  specQuestionOptionSchema,
  specTypeSchema,
  type SessionEntry,
  type SpecType,
} from '@hemera/ipc'
import type { MissionBriefProps, ProposalState, SpecAnswer, SpecQuestionView } from '@hemera/ui'
import { z } from 'zod'

/**
 * What the Spec entries of a thread are drawn from (design D7-01, D7-07, D7-09).
 *
 * A `define` step writes four kinds into a Session's thread: the brief a turn rode on, a
 * question of the Spec asked in the chat, the answer given beside it, and — in a `free`
 * Session — the Spec its agent proposes. `agent-blocks.tsx` draws them; this reads them, pure
 * and free of what `@hemera/ui` runs when it loads, so it is tested on Node. A payload that does
 * not parse is an entry this version does not draw, as everywhere in the thread.
 */

/** The brief of a `define` turn, titled with the phase it was composed for. */
const briefSchema = z.object({ phase: phaseIdSchema.nullable() })

/** A question as its entry carries it: the question view, open when it was asked. */
const questionSchema = z.object({
  id: z.string(),
  body: z.string(),
  blocking: z.boolean(),
  phase: phaseIdSchema.nullable(),
  options: z.array(specQuestionOptionSchema),
})

/** The answer written beside it: one of its options, or a text. */
const answerSchema = z.object({
  questionId: z.string(),
  optionId: z.string().optional(),
  text: z.string().optional(),
})

/** What the agent of a `free` Session proposed, through `spec_propose`. */
const proposalSchema = z.object({ title: z.string(), type: specTypeSchema })

function parsed<S extends z.ZodType>(schema: S, payload: string): z.infer<S> | null {
  try {
    const read = schema.safeParse(JSON.parse(payload))
    return read.success ? read.data : null
  } catch {
    return null
  }
}

/** When an entry was written, `HH:MM`, as the thread says a time. */
function timeOf(at: number): string {
  return new Date(at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

/**
 * The folded line of a turn's brief: `What the agent was told · Shape`, its time, and what was
 * handed. Said as the reader would say it: `mission brief` is the engine's word for it.
 */
export function briefOf(entry: SessionEntry): MissionBriefProps {
  const phase = parsed(briefSchema, entry.payload)?.phase ?? null
  return {
    title:
      phase === null
        ? 'What the agent was told'
        : `What the agent was told · ${phase.charAt(0).toUpperCase()}${phase.slice(1)}`,
    detail: timeOf(entry.createdAt),
    brief: entry.body,
  }
}

/** A question as its block draws it, and whether it was left behind by a Rework. */
export interface QuestionBlock {
  question: SpecQuestionView
  cancelled: boolean
}

/**
 * A question asked in the thread, answered once the `spec_answer` entry written beside it is in
 * the thread too: the two share the question's id. A question tied to no phase is drawn under
 * `shape`, as the register draws it.
 *
 * `asked` is the questions of the Spec's current revision, null until it is read. A question
 * without an answer that is not among them was left behind by a Rework, which asks the open
 * questions again under new ids (D7-05): its block is `cancelled` — it stays open in the Spec,
 * asked again further down — and never offers an answer the engine would refuse.
 */
export function questionEntryOf(
  entry: SessionEntry,
  thread: readonly SessionEntry[],
  asked: ReadonlySet<string> | null,
): QuestionBlock | null {
  const question = parsed(questionSchema, entry.payload)
  if (question === null) return null
  const answer = answeredIn(question.id, thread)
  return {
    question: {
      id: question.id,
      body: question.body,
      blocking: question.blocking,
      phase: question.phase ?? 'shape',
      options: question.options,
      answer,
    },
    cancelled: answer === null && asked !== null && !asked.has(question.id),
  }
}

/** The answer given to a question in this thread, or null while it has none. */
function answeredIn(questionId: string, thread: readonly SessionEntry[]): SpecAnswer | null {
  for (const entry of thread) {
    if (entry.kind !== 'spec_answer') continue
    const answer = parsed(answerSchema, entry.payload)
    if (answer?.questionId === questionId) {
      return { optionId: answer.optionId, text: answer.text }
    }
  }
  return null
}

/**
 * What the reader said, read off a `spec_answer` entry: the option they chose, in the words the
 * question offered it, or the words they typed (issue #149). It is drawn as the reader's own
 * message where it was given, which is what it is — not as Hemera saying it passed it on.
 *
 * Null when the entry does not parse, and when it names an option the question it answers does
 * not hold: an answer drawn from a guess would be words put in the reader's mouth.
 */
export function answerOf(entry: SessionEntry, thread: readonly SessionEntry[]): string | null {
  const answer = parsed(answerSchema, entry.payload)
  if (answer === null) return null
  if (answer.optionId === undefined) return answer.text ?? null
  for (const asked of thread) {
    if (asked.kind !== 'spec_question') continue
    const question = parsed(questionSchema, asked.payload)
    if (question?.id !== answer.questionId) continue
    return question.options.find((option) => option.id === answer.optionId)?.label ?? null
  }
  return null
}

/** What the thread finds a question's block by: the page scrolls to it from the register. */
export function questionAnchor(questionId: string): string {
  return `ask-${questionId}`
}

/** The Spec a `define` Session defines, as a proposal would have named it: its first revision. */
export interface DefinedSpec {
  key: string
  title: string
  type: SpecType
}

/** A proposal as its block draws it. */
export interface ProposalView {
  title: string
  type: SpecType
  state: ProposalState
}

/**
 * Which proposal of the thread the Spec was created from: the one whose title and type are the
 * Spec's first revision's, or — the title edited in the card before `Create` — the last one the
 * thread holds.
 */
function createdFrom(thread: readonly SessionEntry[], spec: DefinedSpec): string | null {
  const proposals = thread.filter((entry) => entry.kind === 'spec_proposal')
  const same = proposals.find((entry) => {
    const said = parsed(proposalSchema, entry.payload)
    return said?.title === spec.title && said.type === spec.type
  })
  return (same ?? proposals.at(-1))?.id ?? null
}

/**
 * A proposal of the agent, and where it stands (D7-07). While the Session is `free`, `proposed`,
 * or `declined` once `Not now` was pressed, which the engine keeps on the entry (issue #130).
 * Once it defines a Spec, the proposal the Spec came from is `created` and every other one
 * `declined`; until that Spec is read, `spec` is null and the proposal is not drawn, rather than
 * drawn as a guess.
 */
export function proposalOf(
  entry: SessionEntry,
  thread: readonly SessionEntry[],
  specId: string | null,
  spec: DefinedSpec | null,
): ProposalView | null {
  const proposal = parsed(proposalSchema, entry.payload)
  if (proposal === null) return null
  const { title, type } = proposal
  if (specId === null) {
    return { title, type, state: entry.state === 'declined' ? 'declined' : 'proposed' }
  }
  if (spec === null) return null
  return { title, type, state: createdFrom(thread, spec) === entry.id ? 'created' : 'declined' }
}

/** What the engine names a proposal by: its entry's correlation, without the prefix. */
export function proposalIdOf(entry: SessionEntry): string {
  return (entry.correlationId ?? '').replace(/^proposal:/, '')
}

/**
 * Whether a Spec entry waits for the reader's answer (issue #130): a proposal of a `free` Session
 * still proposed, a question neither answered nor left behind by a Rework. The page pins it above
 * the composer while it waits — the agent's words go on under it and would scroll it out of
 * sight — and draws it back in the thread once it is answered.
 */
export function waitsForAnswer(
  entry: SessionEntry,
  thread: readonly SessionEntry[],
  specId: string | null,
  asked: ReadonlySet<string> | null,
): boolean {
  if (entry.kind === 'spec_proposal') {
    return specId === null && proposalOf(entry, thread, null, null)?.state === 'proposed'
  }
  if (entry.kind === 'spec_question') {
    const block = questionEntryOf(entry, thread, asked)
    return block !== null && block.question.answer === null && !block.cancelled
  }
  return false
}
