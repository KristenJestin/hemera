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

/** What the agent of a `free` Session proposed, from its marker line. */
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

/** The folded line of a turn's brief: `Mission brief · shape`, its time, and what was handed. */
export function briefOf(entry: SessionEntry): MissionBriefProps {
  const phase = parsed(briefSchema, entry.payload)?.phase ?? null
  return {
    title: phase === null ? 'Mission brief' : `Mission brief · ${phase}`,
    detail: timeOf(entry.createdAt),
    brief: entry.body,
  }
}

/**
 * A question asked in the thread, answered once the `spec_answer` entry written beside it is in
 * the thread too: the two share the question's id. A question tied to no phase is drawn under
 * `shape`, as the register draws it.
 */
export function questionEntryOf(
  entry: SessionEntry,
  thread: readonly SessionEntry[],
): SpecQuestionView | null {
  const question = parsed(questionSchema, entry.payload)
  if (question === null) return null
  return {
    id: question.id,
    body: question.body,
    blocking: question.blocking,
    phase: question.phase ?? 'shape',
    options: question.options,
    answer: answeredIn(question.id, thread),
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

/** What the thread finds a question's block by: the page scrolls to it from the register. */
export function questionAnchor(questionId: string): string {
  return `ask-${questionId}`
}

/**
 * A proposal of the agent, and where it stands: `created` once the Session defines a Spec,
 * `declined` when `Not now` was pressed in this window — which nothing keeps — and `proposed`
 * otherwise.
 */
export function proposalOf(
  entry: SessionEntry,
  specId: string | null,
  declined: boolean,
): { title: string; type: SpecType; state: ProposalState } | null {
  const proposal = parsed(proposalSchema, entry.payload)
  if (proposal === null) return null
  const state: ProposalState = specId !== null ? 'created' : declined ? 'declined' : 'proposed'
  return { title: proposal.title, type: proposal.type, state }
}
