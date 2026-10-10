/**
 * The Planner's tools (#85, #86), as the gate executes them once it let a call through: reading the
 * Spec with every item's version, writing a section or a requirement on the version read, naming
 * the mission, answering the triage and declaring the Spec complete; asking a wave of questions,
 * retiring one, drafting a message for one, and marking an input integrated. The mission is always the
 * one the session's token works for, never one an argument names.
 */

import {
  SECTION_TITLES,
  SPEC_PAGE_BYTES,
  type ToolArguments,
  renderSpecMarkdown,
  specPartMarkdown,
} from '@hemera/core/domain'
import { Effect } from 'effect'

import { buildingPartOf } from '../building/tasks.ts'
import type { Grant } from '../tools/access.ts'
import { type ToolAnswer, answered, failure, refusal } from '../tools/files.ts'
import {
  type SpecWriter,
  type Written,
  answerTriage,
  declareComplete,
  describeMission,
  readSpec,
  removeRequirement,
  writeRequirement,
  writeSection,
} from './store.ts'
import { askWave, draftMessage, integrateInput, retireQuestion } from './questions.ts'
import { coldReadSpec } from './cold-read-store.ts'

/** The writer a grant stands for, when its session works for a mission. */
const writerOf = (grant: Grant): SpecWriter | null =>
  grant.missionId === null
    ? null
    : { sessionId: grant.sessionId, role: grant.role, missionId: grant.missionId }

const NO_MISSION = refusal('refused: this session works for no mission')

const refusedSaid = (sentence: string): ToolAnswer =>
  refusal(sentence.startsWith('refused:') ? sentence : `refused: ${sentence}`)

/** A write's answer: its refusal as the agent reads it, or what it wrote; a failure in words. */
const settledWith = <
  A,
  E extends { readonly message: string },
  R,
  E2 extends { readonly message: string },
  R2,
>(
  effect: Effect.Effect<Written<A>, E, R>,
  done: (value: A) => Effect.Effect<ToolAnswer, E2, R2>,
) =>
  effect.pipe(
    Effect.flatMap((outcome) =>
      'refused' in outcome ? Effect.succeed(refusedSaid(outcome.refused)) : done(outcome.done),
    ),
    Effect.catch((failed) => Effect.succeed(failure(`the call failed: ${failed.message}`))),
  )

const settled = <A, E extends { readonly message: string }, R>(
  effect: Effect.Effect<Written<A>, E, R>,
  done: (value: A) => ToolAnswer,
) => settledWith(effect, (value) => Effect.succeed(done(value)))

/** The Spec, or one part of it, with every item's version, paged with a cursor. */
export const specRead = (grant: Grant, args: ToolArguments<'spec_read'>) =>
  Effect.gen(function* () {
    if (grant.missionId === null) return NO_MISSION
    // A cold read reads the Spec at the version its pass was launched on (#91).
    if (grant.role === 'cold-read') {
      const kept = yield* coldReadSpec(grant, args.section)
      if (kept === null) return refusal('refused: this session is no cold read')
      return paged(kept.text, kept.header, args.cursor)
    }
    const spec = yield* readSpec(grant.missionId)
    // In Building, the whole Spec ends with the decisions taken since the Freeze and the plan (#141).
    const building = args.section === undefined ? yield* buildingPartOf(grant.missionId) : null
    const text =
      args.section === undefined
        ? [renderSpecMarkdown(spec, { versions: true }), building]
            .filter((part) => part !== null)
            .join('\n\n')
        : specPartMarkdown(spec, args.section)
    return paged(
      text,
      `The Spec of ${spec.key} is at version ${String(spec.version)}; write on each item's own version.\n\n`,
      args.cursor,
    )
  }).pipe(Effect.catch((failed) => Effect.succeed(failure(`the call failed: ${failed.message}`))))

/** A page of a Spec's text from a cursor, the header on the first page only. */
const paged = (text: string, header: string, cursor: string | undefined): ToolAnswer => {
  const start = cursor === undefined ? 0 : Number(cursor)
  if (!Number.isInteger(start) || start < 0 || start > text.length) {
    return refusal('refused: this cursor is not one a page of this Spec gave')
  }
  const lines = text.slice(start).split('\n')
  let page = ''
  for (const line of lines) {
    const next = page === '' ? line : `${page}\n${line}`
    if (page !== '' && Buffer.byteLength(next) > SPEC_PAGE_BYTES) break
    page = next
  }
  const end = start + page.length + 1
  const more =
    end < text.length
      ? `More follows: spec_read with cursor ${String(end)}.`
      : 'This is the end of the Spec.'
  return answered(`${start === 0 ? header : ''}${page}\n\n${more}`)
}

export const specWriteSection = (grant: Grant, args: ToolArguments<'spec_write_section'>) => {
  const writer = writerOf(grant)
  if (writer === null) return Effect.succeed(NO_MISSION)
  return settled(writeSection(writer, args.section, args.content, args.base_version), (done) =>
    answered(
      done.version === args.base_version
        ? `${SECTION_TITLES[args.section]} already reads so: nothing changed (version ${String(done.version)}).`
        : `Written: ${SECTION_TITLES[args.section]} is at version ${String(done.version)}; the Spec at version ${String(done.spec)}.`,
    ),
  )
}

export const requirementWrite = (grant: Grant, args: ToolArguments<'requirement_write'>) => {
  const writer = writerOf(grant)
  if (writer === null) return Effect.succeed(NO_MISSION)
  return settledWith(
    writeRequirement(writer, {
      id: args.id,
      domain: args.domain,
      delta: args.delta,
      livingRef: args.living_ref,
      livingVersion: args.living_version,
      text: args.text,
      scenarios: args.scenarios,
      base: args.base_version,
    }),
    (done) =>
      Effect.gen(function* () {
        const spec = yield* readSpec(writer.missionId)
        const scenarios =
          spec.requirements
            .find((one) => one.id === done.id)
            ?.scenarios.map((one) => `${one.id} (version ${String(one.version)})`) ?? []
        const what = done.items.length === 0 ? 'Nothing changed' : 'Written'
        return answered(
          `${what}: ${done.id} is at version ${String(done.version)}. Its scenarios: ${scenarios.length === 0 ? 'none' : scenarios.join(', ')}.`,
        )
      }),
  )
}

export const requirementRemove = (grant: Grant, args: ToolArguments<'requirement_remove'>) => {
  const writer = writerOf(grant)
  if (writer === null) return Effect.succeed(NO_MISSION)
  return settled(removeRequirement(writer, args.id, args.base_version), () =>
    answered(`Removed: ${args.id}. Its id is never reused.`),
  )
}

export const missionDescribe = (grant: Grant, args: ToolArguments<'mission_describe'>) => {
  const writer = writerOf(grant)
  if (writer === null) return Effect.succeed(NO_MISSION)
  return settled(describeMission(writer, { title: args.title, type: args.type }), (done) =>
    answered(`The mission is now “${done.title}”, a ${done.type}.`),
  )
}

export const triageAnswer = (grant: Grant, args: ToolArguments<'triage_answer'>) => {
  const writer = writerOf(grant)
  if (writer === null) return Effect.succeed(NO_MISSION)
  return settled(
    answerTriage(writer, { kind: args.kind, ref: args.ref ?? null, text: args.text }),
    () =>
      answered(
        'Your answer is kept and shown to the user, who opens the other mission, drops this one, or keeps planning it. End your turn now.',
      ),
  )
}

export const declareCompleteTool = (grant: Grant, args: ToolArguments<'declare_complete'>) => {
  const writer = writerOf(grant)
  if (writer === null) return Effect.succeed(NO_MISSION)
  return settled(declareComplete(writer, args.why), (done) => {
    if ('failures' in done) {
      return refusal(
        [
          'refused: the Spec is not complete, and nothing was recorded. Fix each of these, then declare again:',
          ...done.failures.map((one) => `- ${one.target}: ${one.sentence}`),
        ].join('\n'),
      )
    }
    return answered(
      done.again
        ? `Already declared complete at version ${String(done.declared)}: nothing changed since.`
        : `Declared complete at version ${String(done.declared)}. The user is told, with your reason.`,
    )
  })
}

export const askWaveTool = (grant: Grant, args: ToolArguments<'ask_wave'>) => {
  const writer = writerOf(grant)
  if (writer === null) return Effect.succeed(NO_MISSION)
  const asked = args.questions.map((one) => ({
    text: one.text,
    why: one.why,
    options: one.options,
    recommended: one.recommended,
    recommendedReason: one.recommended_reason,
    section: one.section,
    fromFinding: one.from_finding,
    replaces: one.replaces,
  }))
  return settled(askWave(writer, asked), (done) => {
    const named = done.ids.map((id) => {
      const old = done.replaced.find(([, by]) => by === id)
      return old === undefined ? id : `${id} (it replaces ${old[0]})`
    })
    return answered(
      `Wave ${String(done.number)} asked: ${named.join(', ')}. Your turn goes on: work on what does not depend on the answers; they arrive as [hemera:answers].`,
    )
  })
}

export const questionRetireTool = (grant: Grant, args: ToolArguments<'question_retire'>) => {
  const writer = writerOf(grant)
  if (writer === null) return Effect.succeed(NO_MISSION)
  return settled(
    retireQuestion(writer, {
      question: args.question,
      how: args.how,
      reason: args.reason,
      decision: args.decision ?? null,
    }),
    (how) => answered(`${args.question} is ${how}. It stays readable with your reason.`),
  )
}

export const questionDraftMessageTool = (
  grant: Grant,
  args: ToolArguments<'question_draft_message'>,
) => {
  const writer = writerOf(grant)
  if (writer === null) return Effect.succeed(NO_MISSION)
  return settled(draftMessage(writer, args), () =>
    answered(
      `Draft kept under ${args.question}, for the user to copy. Nothing is sent: the user writes and sends it.`,
    ),
  )
}

export const inputIntegratedTool = (grant: Grant, args: ToolArguments<'input_integrated'>) => {
  const writer = writerOf(grant)
  if (writer === null) return Effect.succeed(NO_MISSION)
  return settled(integrateInput(writer, args.id, args.where), (done) =>
    answered(
      done.again
        ? `${args.id} is already integrated (${done.where}): nothing changed.`
        : `${args.id} is integrated (${done.where}).`,
    ),
  )
}
