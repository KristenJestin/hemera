/**
 * The Planner's questions (#86): asked in waves, answered by the user at their own pace, kept apart
 * from the Spec.
 *
 * - The Planner asks a wave with `ask_wave` and its turn goes on; it withdraws a question, says a
 *   decision made it moot, or replaces it, always with the reason; it drafts a message the user
 *   sends; and it marks each input integrated (CT-26).
 * - The user answers (a changed answer is a new version, never an overwrite) or says the question
 *   waits on someone, with an optional note: the mission carries the mark `waiting` while one does.
 *   Each is an input, received here; `calls.ts` hands it to the Planner once committed.
 * - Nothing here creates a need: the questions wait for the user in Home's Questions group.
 *
 * Every change writes its domain event in the same transaction (the Journal's lines and Since you
 * left read them).
 */

import {
  type Answer,
  type AskedQuestion,
  type QuestionOption,
  type QuestionState,
  type RetireHow,
  QUESTION_STATES,
  WaitingOnSomeoneMark,
  answerChangeSaid,
  answerTo,
  answerWords,
  missionKey,
  optionIdAt,
  waveRefusal,
} from '@hemera/core/domain'
import {
  InvalidAnswer,
  type OpenQuestion,
  type PlanningInput,
  PlanningRefused,
  type Question,
  type Wave,
} from '@hemera/ipc'
import { and, asc, count, eq, inArray, max } from 'drizzle-orm'
import { Effect, Option, Schema, Stream } from 'effect'

import { DomainEvents } from '../domain-events.ts'
import type { NewEvent } from '../journal.ts'
import { markIn, clearMarkIn } from '../missions.ts'
import { Secrets } from '../secrets.ts'
import { Database, type EngineTransaction, refusedWhile } from '../storage/database.ts'
import {
  answers,
  discussions,
  missions,
  planningInputs,
  projects,
  questionDrafts,
  questions,
  waves,
} from '../storage/schema.ts'
import { mutate } from '../transaction.ts'
import { deliveredIn, inputKindOf, receiveInput } from './inputs.ts'
import { findingsAskRefusal, findingsAskedIn, findingsReopenedIn } from './cold-read-findings.ts'
import {
  type SpecWriter,
  type Written,
  hemeraNext,
  inPlanning,
  missionRow,
  plannerEvent,
  standingOf,
} from './store.ts'

const now = (): string => new Date().toISOString()

const refused = <A>(sentence: string): Written<A> => ({ refused: sentence })

/** A question as a wave asks it, with what it may point at. */
export interface WaveQuestion extends AskedQuestion {
  readonly section?: string | undefined
  readonly fromFinding?: string | undefined
  readonly replaces?: string | undefined
}

const Options = Schema.Array(
  Schema.Struct({ id: Schema.String, label: Schema.String, detail: Schema.String }),
)
const readOptions = Schema.decodeUnknownOption(Schema.fromJsonString(Options))

type QuestionRow = typeof questions.$inferSelect

const optionsOf = (row: QuestionRow): ReadonlyArray<QuestionOption> =>
  Option.getOrElse(readOptions(row.options), () => [])

const stateOf = (row: QuestionRow): QuestionState =>
  QUESTION_STATES.find((one) => one === row.state) ?? 'open'

const answerOf = (row: {
  readonly optionId: string | null
  readonly text: string | null
}): Answer =>
  row.optionId === null
    ? { optionId: null, text: row.text ?? '' }
    : { optionId: row.optionId, text: null }

const RETIRED: ReadonlyArray<QuestionState> = ['withdrawn', 'replaced', 'moot']

/** The waiting mark of a question, as the mission carries it. */
const waitingMark = (question: string, note: string | null) =>
  WaitingOnSomeoneMark.make({ question, note })

/** How many questions of a mission wait for the user's answer. */
const openCount = (transaction: EngineTransaction, missionId: string) =>
  Effect.map(
    transaction
      .select({ total: count() })
      .from(questions)
      .where(and(eq(questions.missionId, missionId), eq(questions.state, 'open')))
      .pipe(Effect.mapError(refusedWhile('counting the questions'))),
    ([row]) => row?.total ?? 0,
  )

/** Now's next step while questions wait: "3 questions wait for you". */
const waitingForYou = (open: number): string =>
  open === 1 ? '1 question waits for you' : `${String(open)} questions wait for you`

const questionRow = (transaction: EngineTransaction, missionId: string, id: string) =>
  Effect.map(
    transaction
      .select()
      .from(questions)
      .where(and(eq(questions.missionId, missionId), eq(questions.id, id)))
      .pipe(Effect.mapError(refusedWhile('reading a question'))),
    ([row]) => row ?? null,
  )

// --- The Planner's side ----------------------------------------------------------------------

/** What a wave came to: its number, its questions, and the questions they replaced. */
export interface Asked {
  readonly number: number
  readonly ids: ReadonlyArray<string>
  readonly replaced: ReadonlyArray<readonly [string, string]>
}

/**
 * Records the next wave of a mission's questions, `Q<n>` numbered on from the last, with
 * `planning.wave_asked` and Now's next step. A question that replaces another marks it replaced,
 * keeping the link both ways. Several waves may be open at once.
 */
export const askWave = (writer: SpecWriter, asked: ReadonlyArray<WaveQuestion>) =>
  Effect.gen(function* () {
    const secrets = yield* Secrets
    return yield* mutate('asking a wave of questions', (transaction) =>
      Effect.gen(function* () {
        const answer = (result: Written<Asked>, events: ReadonlyArray<NewEvent> = []) => ({
          result,
          events,
        })
        const standing = yield* standingOf(transaction, writer)
        if (standing.refusal !== null) return answer(refused(standing.refusal))
        const invalid = waveRefusal(asked)
        if (invalid !== null) return answer(refused(invalid))
        const replacing = asked.flatMap((one) => (one.replaces === undefined ? [] : [one.replaces]))
        if (new Set(replacing).size !== replacing.length) {
          return answer(refused('refused: two questions of the wave replace the same one.'))
        }
        // A question from a cold read's finding: only a blocking one on the Spec (#91).
        const fromFinding = yield* findingsAskRefusal(transaction, writer.missionId, asked)
        if (fromFinding !== null) return answer(refused(fromFinding))
        const replaced: QuestionRow[] = []
        for (const id of replacing) {
          const row = yield* questionRow(transaction, writer.missionId, id)
          if (row === null) return answer(refused(`refused: this mission has no question ${id}.`))
          if (RETIRED.includes(stateOf(row))) {
            return answer(refused(`refused: ${id} is ${row.state} already: nothing replaces it.`))
          }
          replaced.push(row)
        }
        const [last] = yield* transaction
          .select({ wave: max(waves.number) })
          .from(waves)
          .where(eq(waves.missionId, writer.missionId))
          .pipe(Effect.mapError(refusedWhile('numbering the wave')))
        const [counted] = yield* transaction
          .select({ total: count() })
          .from(questions)
          .where(eq(questions.missionId, writer.missionId))
          .pipe(Effect.mapError(refusedWhile('numbering the questions')))
        const number = (last?.wave ?? 0) + 1
        const first = (counted?.total ?? 0) + 1
        const at = now()
        yield* transaction
          .insert(waves)
          .values({ missionId: writer.missionId, number, sessionId: writer.sessionId, askedAt: at })
          .pipe(Effect.mapError(refusedWhile('asking a wave')))
        const ids: string[] = []
        const texts: string[] = []
        const events: NewEvent[] = []
        const pairs: Array<readonly [string, string]> = []
        for (const [index, one] of asked.entries()) {
          const id = `Q${String(first + index)}`
          const text = secrets.mask(one.text.trim())
          ids.push(id)
          texts.push(text)
          const options = one.options.map((option, place) => ({
            id: optionIdAt(place),
            label: option.label.trim(),
            detail: option.detail.trim(),
          }))
          yield* transaction
            .insert(questions)
            .values({
              missionId: writer.missionId,
              id,
              number: first + index,
              wave: number,
              text,
              why: secrets.mask(one.why.trim()),
              options: secrets.mask(JSON.stringify(options)),
              recommended: optionIdAt(one.recommended),
              recommendedReason: secrets.mask(one.recommendedReason.trim()),
              section: one.section?.trim() ?? null,
              fromFinding: one.fromFinding?.trim() ?? null,
              replaces: one.replaces ?? null,
              state: 'open',
              askedAt: at,
              changedAt: at,
            })
            .pipe(Effect.mapError(refusedWhile('asking a question')))
          const old = replaced.find((row) => row.id === one.replaces)
          if (old === undefined) continue
          pairs.push([old.id, id])
          yield* transaction
            .update(questions)
            .set({ state: 'replaced', replacedBy: id, changedAt: at })
            .where(and(eq(questions.missionId, writer.missionId), eq(questions.id, old.id)))
            .pipe(Effect.mapError(refusedWhile('replacing a question')))
          if (old.state === 'waiting') {
            events.push(
              ...(yield* clearMarkIn(
                transaction,
                writer.missionId,
                waitingMark(old.id, old.waitingNote),
              )),
            )
          }
          events.push(
            plannerEvent(writer, 'planning.question_replaced', { question: old.id, by: id }),
          )
        }
        yield* findingsAskedIn(
          transaction,
          writer.missionId,
          asked.flatMap((one, place) =>
            one.fromFinding === undefined
              ? []
              : [[one.fromFinding.trim(), ids[place] ?? ''] as const],
          ),
        )
        const next = yield* hemeraNext(
          transaction,
          writer.missionId,
          waitingForYou(yield* openCount(transaction, writer.missionId)),
        )
        return answer({ done: { number, ids, replaced: pairs } }, [
          plannerEvent(writer, 'planning.wave_asked', { number, questions: ids, texts }),
          ...events,
          next,
        ])
      }),
    )
  })

/** The Planner withdraws a question, or says a decision made it moot, with the reason. */
export const retireQuestion = (
  writer: SpecWriter,
  asked: {
    readonly question: string
    readonly how: RetireHow
    readonly reason: string
    readonly decision: string | null
  },
) =>
  Effect.gen(function* () {
    const secrets = yield* Secrets
    const reason = secrets.mask(asked.reason.trim())
    const decision = secrets.mask(asked.decision?.trim() ?? '')
    return yield* mutate('retiring a question', (transaction) =>
      Effect.gen(function* () {
        const answer = (result: Written<RetireHow>, events: ReadonlyArray<NewEvent> = []) => ({
          result,
          events,
        })
        const standing = yield* standingOf(transaction, writer)
        if (standing.refusal !== null) return answer(refused(standing.refusal))
        if (asked.how === 'moot' && decision === '') {
          return answer(refused('refused: a moot question names the decision that made it moot.'))
        }
        const row = yield* questionRow(transaction, writer.missionId, asked.question)
        if (row === null) {
          return answer(refused(`refused: this mission has no question ${asked.question}.`))
        }
        if (RETIRED.includes(stateOf(row))) {
          return answer(refused(`refused: ${row.id} is ${row.state} already.`))
        }
        const moot = asked.how === 'moot' ? decision : null
        yield* transaction
          .update(questions)
          .set({ state: asked.how, retiredReason: reason, mootDecision: moot, changedAt: now() })
          .where(and(eq(questions.missionId, writer.missionId), eq(questions.id, row.id)))
          .pipe(Effect.mapError(refusedWhile('retiring a question')))
        // A finding of the cold read asked as it is open again (#91): a moot one is settled by
        // the decision that made it moot.
        if (asked.how === 'withdrawn')
          yield* findingsReopenedIn(transaction, writer.missionId, row.id)
        const unmarked =
          row.state === 'waiting'
            ? yield* clearMarkIn(
                transaction,
                writer.missionId,
                waitingMark(row.id, row.waitingNote),
              )
            : []
        return answer({ done: asked.how }, [
          plannerEvent(
            writer,
            asked.how === 'moot' ? 'planning.question_moot' : 'planning.question_withdrawn',
            { question: row.id, reason, decision: moot },
          ),
          ...unmarked,
        ])
      }),
    )
  })

/** A message the Planner drafts for a question, kept for the user to copy; never sent. */
export const draftMessage = (
  writer: SpecWriter,
  asked: { readonly question: string; readonly text: string },
) =>
  Effect.gen(function* () {
    const secrets = yield* Secrets
    const text = secrets.mask(asked.text.trim())
    return yield* mutate('drafting a message', (transaction) =>
      Effect.gen(function* () {
        const answer = (result: Written<true>, events: ReadonlyArray<NewEvent> = []) => ({
          result,
          events,
        })
        const standing = yield* standingOf(transaction, writer)
        if (standing.refusal !== null) return answer(refused(standing.refusal))
        const row = yield* questionRow(transaction, writer.missionId, asked.question)
        if (row === null) {
          return answer(refused(`refused: this mission has no question ${asked.question}.`))
        }
        yield* transaction
          .insert(questionDrafts)
          .values({
            missionId: writer.missionId,
            questionId: row.id,
            text,
            sessionId: writer.sessionId,
            at: now(),
          })
          .pipe(Effect.mapError(refusedWhile('keeping a draft')))
        return answer({ done: true }, [
          plannerEvent(writer, 'planning.draft_message', { question: row.id }),
        ])
      }),
    )
  })

/** Where an input went, as the Planner says it: a Spec item, or no change and why. */
export type IntegratedWhere = string | { readonly no_change: string }

const isText = Schema.is(Schema.String)

/** What `input_integrated` came to: where it went, and whether it was integrated before. */
export interface Integration {
  readonly where: string
  readonly again: boolean
}

/** The Planner marks a delivered input integrated (CT-26): refused before its delivery. */
export const integrateInput = (writer: SpecWriter, id: string, where: IntegratedWhere) =>
  Effect.gen(function* () {
    const secrets = yield* Secrets
    const said = secrets.mask(isText(where) ? where.trim() : `no change: ${where.no_change.trim()}`)
    return yield* mutate('marking an input integrated', (transaction) =>
      Effect.gen(function* () {
        const standing = yield* standingOf(transaction, writer)
        if (standing.refusal !== null) {
          return { result: refused<Integration>(standing.refusal), events: [] }
        }
        // Taken by the session meanwhile: delivered now, in this transaction.
        const delivered = yield* deliveredIn(transaction, writer.missionId)
        const answer = (result: Written<Integration>, events: ReadonlyArray<NewEvent> = []) => ({
          result,
          events: [...delivered, ...events],
        })
        const [row] = yield* transaction
          .select()
          .from(planningInputs)
          .where(and(eq(planningInputs.missionId, writer.missionId), eq(planningInputs.id, id)))
          .pipe(Effect.mapError(refusedWhile('reading an input')))
        if (row === undefined) return answer(refused(`refused: this mission has no input ${id}.`))
        if (row.state === 'received') {
          return answer(
            refused(
              `refused: ${id} has not been delivered to you yet: it comes with your next delivery.`,
            ),
          )
        }
        if (row.state === 'superseded') {
          const by = row.supersededBy
          return answer(
            refused(
              by === null
                ? `refused: ${id} was withdrawn: nothing to integrate.`
                : `refused: ${id} is superseded by ${by}: integrate ${by}.`,
            ),
          )
        }
        if (row.state === 'integrated') {
          return answer({ done: { where: row.where ?? '', again: true } })
        }
        yield* transaction
          .update(planningInputs)
          .set({ state: 'integrated', integratedAt: now(), where: said })
          .where(and(eq(planningInputs.missionId, writer.missionId), eq(planningInputs.id, id)))
          .pipe(Effect.mapError(refusedWhile('marking an input integrated')))
        return answer({ done: { where: said, again: false } }, [
          plannerEvent(writer, 'planning.input_integrated', { id, where: said }),
        ])
      }),
    )
  })

// --- The user's side -------------------------------------------------------------------------

/** A question the user acts on: in Planning, asked, and not retired. */
const actedOn = (
  transaction: EngineTransaction,
  missionId: string,
  questionId: string,
  doing: string,
) =>
  Effect.gen(function* () {
    const { key } = yield* inPlanning(transaction, missionId, doing)
    const row = yield* questionRow(transaction, missionId, questionId)
    if (row === null) {
      return yield* new PlanningRefused({ reason: `${key} has no question ${questionId}.` })
    }
    if (RETIRED.includes(stateOf(row))) {
      return yield* new PlanningRefused({
        reason: `${questionId} is ${row.state}: it takes nothing more.`,
      })
    }
    return row
  })

const sameAnswer = (one: Answer, other: Answer): boolean =>
  one.optionId === other.optionId && one.text === other.text

/**
 * The user answers a question: exactly one of an option it offers and a text of their own. An
 * answered question takes a new version, received as a change; the same answer again changes
 * nothing (false). The caller hands the input to the Planner.
 */
export const recordAnswer = (
  missionId: string,
  questionId: string,
  given: { readonly optionId?: string | undefined; readonly text?: string | undefined },
) =>
  Effect.gen(function* () {
    const secrets = yield* Secrets
    return yield* mutate('answering a question', (transaction) =>
      Effect.gen(function* () {
        const row = yield* actedOn(transaction, missionId, questionId, 'an answer')
        const options = optionsOf(row)
        const checked = answerTo(options, given)
        if ('refused' in checked) return yield* new InvalidAnswer({ reason: checked.refused })
        const kept: Answer =
          checked.answer.optionId === null
            ? { optionId: null, text: secrets.mask(checked.answer.text) }
            : checked.answer
        const earlier = yield* transaction
          .select()
          .from(answers)
          .where(and(eq(answers.missionId, missionId), eq(answers.questionId, row.id)))
          .orderBy(asc(answers.version))
          .pipe(Effect.mapError(refusedWhile('reading the answers')))
        const last = earlier.at(-1)
        const was = last === undefined ? null : answerOf(last)
        if (was !== null && sameAnswer(was, kept)) return { result: false, events: [] }
        const version = (last?.version ?? 0) + 1
        const at = now()
        yield* transaction
          .insert(answers)
          .values({
            missionId,
            questionId: row.id,
            version,
            optionId: kept.optionId,
            text: kept.text === null ? null : secrets.mask(kept.text),
            author: 'user',
            at,
          })
          .pipe(Effect.mapError(refusedWhile('keeping the answer')))
        yield* transaction
          .update(questions)
          .set({ state: 'answered', changedAt: at })
          .where(and(eq(questions.missionId, missionId), eq(questions.id, row.id)))
          .pipe(Effect.mapError(refusedWhile('answering the question')))
        const unmarked =
          row.state === 'waiting'
            ? yield* clearMarkIn(transaction, missionId, waitingMark(row.id, row.waitingNote))
            : []
        const input = yield* receiveInput(transaction, {
          missionId,
          kind: 'answer',
          item: row.id,
          version,
          said: answerChangeSaid(row.id, version, options, kept, was),
          supersedes: true,
        })
        const chosen = options.find((option) => option.id === kept.optionId)
        const open = yield* openCount(transaction, missionId)
        const events: NewEvent[] = [
          {
            type: 'planning.answered',
            entityKind: 'mission',
            entityId: missionId,
            source: 'ui',
            author: 'human',
            payload: {
              question: row.id,
              version,
              answer: chosen?.label ?? kept.text,
              optionId: kept.optionId,
              author: 'user',
              input,
            },
          },
          ...unmarked,
        ]
        if (open > 0) events.push(yield* hemeraNext(transaction, missionId, waitingForYou(open)))
        return { result: true, events }
      }),
    )
  })

/**
 * The user says a question waits on someone, with an optional note: the question waits, the
 * mission carries the mark `waiting` for it, and an input tells the Planner. Said again with the
 * same note, nothing changes (false).
 */
export const recordWaiting = (missionId: string, questionId: string, note: string | null) =>
  Effect.gen(function* () {
    const secrets = yield* Secrets
    const trimmed = note?.trim() ?? ''
    const kept = trimmed === '' ? null : secrets.mask(trimmed)
    return yield* mutate('marking a question waiting on someone', (transaction) =>
      Effect.gen(function* () {
        const row = yield* actedOn(transaction, missionId, questionId, 'waiting on someone')
        if (row.state === 'answered') {
          return yield* new PlanningRefused({
            reason: `${row.id} is answered: only an open question waits on someone.`,
          })
        }
        if (row.state === 'waiting' && row.waitingNote === kept) {
          return { result: false, events: [] }
        }
        yield* transaction
          .update(questions)
          .set({ state: 'waiting', waitingNote: kept, changedAt: now() })
          .where(and(eq(questions.missionId, missionId), eq(questions.id, row.id)))
          .pipe(Effect.mapError(refusedWhile('marking a question waiting')))
        const unmarked =
          row.state === 'waiting'
            ? yield* clearMarkIn(transaction, missionId, waitingMark(row.id, row.waitingNote))
            : []
        const marked = yield* markIn(transaction, missionId, waitingMark(row.id, kept))
        const input = yield* receiveInput(transaction, {
          missionId,
          kind: 'waiting',
          item: row.id,
          version: null,
          said: [
            `${row.id} waits on someone${kept === null ? '' : `: “${kept}”`}.`,
            'Keep it in Open questions and go on; you may draft a message with question_draft_message, which the user sends.',
          ].join(' '),
          supersedes: true,
        })
        const next = yield* hemeraNext(transaction, missionId, `${row.id} waits on someone`)
        const event: NewEvent = {
          type: 'planning.waiting_on_someone',
          entityKind: 'mission',
          entityId: missionId,
          source: 'ui',
          author: 'human',
          payload: { question: row.id, note: kept, input },
        }
        return { result: true, events: [event, ...unmarked, ...marked, next] }
      }),
    )
  })

// --- Reading -----------------------------------------------------------------------------------

const inputOf = (row: typeof planningInputs.$inferSelect): PlanningInput => ({
  id: row.id,
  kind: inputKindOf(row.kind),
  item: row.item,
  itemVersion: row.itemVersion,
  state:
    row.state === 'delivered' || row.state === 'integrated' || row.state === 'superseded'
      ? row.state
      : 'received',
  receivedAt: row.receivedAt,
  deliveredAt: row.deliveredAt,
  integratedAt: row.integratedAt,
  where: row.where,
  supersededBy: row.supersededBy,
})

/** A mission's inputs, in the order received. */
export const inputsOf = (missionId: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    return yield* database.transaction((transaction) =>
      Effect.gen(function* () {
        yield* missionRow(transaction, missionId)
        const rows = yield* transaction
          .select()
          .from(planningInputs)
          .where(eq(planningInputs.missionId, missionId))
          .orderBy(asc(planningInputs.number))
          .pipe(Effect.mapError(refusedWhile('reading the inputs')))
        return rows.map(inputOf)
      }),
    )
  })

/** A mission's waves, each with its questions, their answer versions and drafts. */
export const wavesOf = (missionId: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    return yield* database.transaction((transaction) =>
      Effect.gen(function* () {
        yield* missionRow(transaction, missionId)
        const read = refusedWhile('reading the questions')
        const waveRows = yield* transaction
          .select()
          .from(waves)
          .where(eq(waves.missionId, missionId))
          .orderBy(asc(waves.number))
          .pipe(Effect.mapError(read))
        const questionRows = yield* transaction
          .select()
          .from(questions)
          .where(eq(questions.missionId, missionId))
          .orderBy(asc(questions.number))
          .pipe(Effect.mapError(read))
        const answerRows = yield* transaction
          .select()
          .from(answers)
          .where(eq(answers.missionId, missionId))
          .orderBy(asc(answers.version))
          .pipe(Effect.mapError(read))
        const draftRows = yield* transaction
          .select()
          .from(questionDrafts)
          .where(eq(questionDrafts.missionId, missionId))
          .orderBy(asc(questionDrafts.sequence))
          .pipe(Effect.mapError(read))
        const inputRows = yield* transaction
          .select()
          .from(planningInputs)
          .where(and(eq(planningInputs.missionId, missionId), eq(planningInputs.kind, 'answer')))
          .pipe(Effect.mapError(read))
        const questionOf = (row: QuestionRow): Question => ({
          id: row.id,
          wave: row.wave,
          text: row.text,
          why: row.why,
          options: optionsOf(row),
          recommended: row.recommended,
          recommendedReason: row.recommendedReason,
          section: row.section,
          fromFinding: row.fromFinding,
          replaces: row.replaces,
          replacedBy: row.replacedBy,
          state: stateOf(row),
          waitingNote: row.waitingNote,
          retiredReason: row.retiredReason,
          mootDecision: row.mootDecision,
          askedAt: row.askedAt,
          answers: answerRows
            .filter((one) => one.questionId === row.id)
            .map((one) => {
              const input = inputRows.find(
                (candidate) => candidate.item === row.id && candidate.itemVersion === one.version,
              )
              return {
                version: one.version,
                optionId: one.optionId,
                text: one.text,
                author: one.author,
                at: one.at,
                input: input?.id ?? null,
                inputState: input === undefined ? null : inputOf(input).state,
              }
            }),
          drafts: draftRows
            .filter((one) => one.questionId === row.id)
            .map((one) => ({ text: one.text, at: one.at })),
        })
        return waveRows.map((wave): Wave => ({
          number: wave.number,
          askedAt: wave.askedAt,
          questions: questionRows.filter((one) => one.wave === wave.number).map(questionOf),
        }))
      }),
    )
  })

/** Every open or waiting question of the missions in Planning, by mission then wave. */
export const openQuestions = Effect.gen(function* () {
  const database = yield* Database
  const rows = yield* database
    .select({
      question: questions,
      prefix: missions.keyPrefix,
      number: missions.keyNumber,
      projectId: projects.id,
      projectName: projects.name,
    })
    .from(questions)
    .innerJoin(missions, eq(missions.id, questions.missionId))
    .innerJoin(projects, eq(projects.id, missions.projectId))
    .where(and(inArray(questions.state, ['open', 'waiting']), eq(missions.stage, 'planning')))
    .orderBy(asc(missions.createdAt), asc(missions.id), asc(questions.wave), asc(questions.number))
    .pipe(Effect.mapError(refusedWhile('reading the open questions')))
  return rows.map(({ question, prefix, number, projectId, projectName }): OpenQuestion => {
    const recommended = optionsOf(question).find((one) => one.id === question.recommended)
    return {
      missionId: question.missionId,
      missionKey: missionKey(prefix, number),
      projectId,
      projectName,
      wave: question.wave,
      questionId: question.id,
      text: question.text,
      recommended: recommended ?? { id: question.recommended, label: '', detail: '' },
      state: question.state === 'waiting' ? 'waiting' : 'open',
      waitingNote: question.waitingNote,
      since: question.state === 'waiting' ? question.changedAt : question.askedAt,
    }
  })
})

/** The open questions now, then again after each change of a mission, while the caller listens. */
export const questionsChanged = Stream.unwrap(
  Effect.gen(function* () {
    const committed = yield* DomainEvents.use((events) => events.subscribe)
    return Stream.concat(
      Stream.fromEffect(openQuestions),
      committed.pipe(
        Stream.filter(
          (event) =>
            event.entityKind === 'mission' &&
            (event.type.startsWith('planning.') || event.type.startsWith('mission.')),
        ),
        Stream.mapEffect(() => openQuestions),
      ),
    )
  }),
)

/**
 * What a Planner's brief says of the questions: each with its wave, state, latest answer, note
 * or reason; the inputs delivered to an earlier session and not integrated; and whether any input
 * waits on the Planner, which puts it in the `answers` mode (a pending Discuss proposal waits on
 * the user instead).
 */
export const questionsBriefOf = (missionId: string) =>
  Effect.gen(function* () {
    const all = yield* wavesOf(missionId)
    const inputs = yield* inputsOf(missionId)
    const database = yield* Database
    const delivered = yield* database
      .select({ id: planningInputs.id, said: planningInputs.said })
      .from(planningInputs)
      .where(and(eq(planningInputs.missionId, missionId), eq(planningInputs.state, 'delivered')))
      .orderBy(asc(planningInputs.number))
      .pipe(Effect.mapError(refusedWhile('reading the inputs')))
    // A Discuss proposal still pending in its open discussion (#87) waits on the user, not here.
    const open = yield* database
      .select({ number: discussions.number })
      .from(discussions)
      .where(and(eq(discussions.missionId, missionId), eq(discussions.state, 'open')))
      .pipe(Effect.mapError(refusedWhile('reading the open discussions')))
    const proposed = (input: (typeof inputs)[number]) =>
      input.kind === 'discuss_decision' &&
      open.some((one) => input.item === `#${String(one.number)}`)
    const lines = all.flatMap((wave) =>
      wave.questions.map((one) => {
        const last = one.answers.at(-1)
        const answered =
          last === undefined
            ? ''
            : ` → ${answerWords(one.options, answerOf(last))} (version ${String(last.version)})`
        const note =
          one.state === 'waiting' && one.waitingNote !== null ? ` (“${one.waitingNote}”)` : ''
        const retired = one.retiredReason === null ? '' : `: ${one.retiredReason}`
        return `- ${one.id} (wave ${String(one.wave)}, ${one.state}): ${one.text}${answered}${note}${retired}`
      }),
    )
    return {
      questions: lines.length === 0 ? null : lines.join('\n'),
      toIntegrate:
        delivered.length === 0
          ? null
          : delivered.map((one) => `- ${one.id} · ${one.said}`).join('\n'),
      pending: inputs.some(
        (one) => (one.state === 'received' || one.state === 'delivered') && !proposed(one),
      ),
    }
  })
