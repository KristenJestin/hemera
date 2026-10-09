/**
 * The cold reads as they are kept (#91): each pass and its findings, the Spec it reads kept at its
 * launch, and every change of them, each written with its domain event in the same transaction.
 *
 * - **A pass is recorded** by Hemera with the first declaration of completeness of a Planning
 *   cycle, in its transaction (one per cycle, CT-29, `store.ts`), or by the user's "another pass",
 *   refused while one waits or runs and before the first of the cycle. It reads the Spec as it is
 *   in the transaction that records it (`cold-read-pass.ts`).
 * - **The report** (`cold_read_report`) is checked, its findings stored bound to that version, the
 *   pass done, and its delivery to the Planner stored, in one transaction; the cold reads' layer
 *   then ends its session and hands the delivery over.
 * - **The Planner** marks fixed a blocker on the tasks only, a warning or a suggestion
 *   (`cold_read_fixed`); a blocker on the Spec is asked in a wave (`cold-read-findings.ts`).
 * - **The user** dismisses a finding: a question asked from it and still open is withdrawn, and
 *   the dismissal is a human input the Planner integrates (#86, CT-26).
 */

import {
  type ColdReadAsker,
  type ColdReadSeverity,
  type ColdReadState,
  COLD_READ_ASKERS,
  COLD_READ_SEVERITIES,
  COLD_READ_STATES,
  FINDING_FATES,
  type FindingFate,
  type FindingKept,
  type FindingStanding,
  type ToolArguments,
  WaitingOnSomeoneMark,
  coldReadDelivery,
  coldReadLabel,
  coldReadReportRefusal,
  coldReadUnsettled,
  findingIdOf,
  missionKey,
  severityCounts,
  tasksOnly,
} from '@hemera/core/domain'
import {
  AgentAuthor,
  type ColdReadFindingSeen,
  type ColdReadFreshness,
  type ColdReadPass,
  HemeraAuthor,
  type MemoryAuthor,
  PlanningRefused,
  UserAuthor,
} from '@hemera/ipc'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { Effect, Option, Schema, Stream } from 'effect'

import { DomainEvents } from '../domain-events.ts'
import type { EventPayload, NewEvent } from '../journal.ts'
import type { JournalMapper } from '../memory/index.ts'
import { clearMarkIn } from '../missions.ts'
import { expireNeedIn } from '../needs.ts'
import { Secrets } from '../secrets.ts'
import { Cap } from '../sessions/cap.ts'
import { storeDeliveryIn } from '../sessions/deliveries.ts'
import { getSession } from '../sessions/store.ts'
import { Database, type EngineTransaction, refusedWhile } from '../storage/database.ts'
import {
  agentSessions,
  coldReadFindings,
  coldReads,
  discussions,
  planningInputs,
  questions,
  sessionNeeds,
  specs,
} from '../storage/schema.ts'
import type { Grant } from '../tools/access.ts'
import { type ToolAnswer, answered, failure, refusal } from '../tools/files.ts'
import { mutate } from '../transaction.ts'
import { deliverInputs } from './calls.ts'
import { findingRow, liveQuestionIn } from './cold-read-findings.ts'
import { COLD_READ_WAITS, coldReadEvent, insertPassIn, passesIn } from './cold-read-pass.ts'
import { type ColdReadRow, coldReadOfLineage, snapshotOf } from './cold-read-rows.ts'
import { receiveInput } from './inputs.ts'
import { changesSince, hemeraNext, missionRow, plannerEvent, specIn, standingOf } from './store.ts'

type FindingRow = typeof coldReadFindings.$inferSelect
type QuestionRow = typeof questions.$inferSelect

/** Why a pass failed when its mission left Planning before it ended. */
export const LEFT_PLANNING = 'the mission left Planning'

/** Why a pass failed when its session stopped and nothing took its lineage up. */
export const SESSION_STOPPED = 'its session stopped'

/** Why what a failed pass's sessions asked the user expires. */
const PASS_ENDED = 'this cold read has ended: launch another'

const Where = Schema.fromJsonString(Schema.Array(Schema.String))
const readWhere = Schema.decodeUnknownOption(Where)
const writeWhere = Schema.encodeSync(Where)

const now = (): string => new Date().toISOString()

const stateOf = (row: ColdReadRow): ColdReadState =>
  COLD_READ_STATES.find((one) => one === row.state) ?? 'failed'
const askerOf = (row: ColdReadRow): ColdReadAsker =>
  COLD_READ_ASKERS.find((one) => one === row.requestedBy) ?? 'hemera'
const severityOf = (row: FindingRow): ColdReadSeverity =>
  COLD_READ_SEVERITIES.find((one) => one === row.severity) ?? 'suggestion'
const fateOf = (row: FindingRow): FindingFate =>
  FINDING_FATES.find((one) => one === row.fate) ?? 'open'
const whereOf = (row: FindingRow): ReadonlyArray<string> =>
  Option.getOrElse(readWhere(row.where), () => [])

export const coldReadRow = (id: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const [row] = yield* database
      .select()
      .from(coldReads)
      .where(eq(coldReads.id, id))
      .pipe(Effect.mapError(refusedWhile('reading a cold read')))
    return row ?? null
  })

/** Every pass of the Profile in one of the states, the first asked first. */
export const coldReadsIn = (states: ReadonlyArray<ColdReadState>) =>
  Effect.gen(function* () {
    const database = yield* Database
    return yield* database
      .select()
      .from(coldReads)
      .where(inArray(coldReads.state, [...states]))
      .orderBy(asc(coldReads.askedAt))
      .pipe(Effect.mapError(refusedWhile('reading the cold reads')))
  })

const findingsIn = (transaction: EngineTransaction, missionId: string) =>
  transaction
    .select()
    .from(coldReadFindings)
    .where(eq(coldReadFindings.missionId, missionId))
    .orderBy(asc(coldReadFindings.number))
    .pipe(Effect.mapError(refusedWhile('reading the findings')))

const findingSeen = (row: FindingRow): ColdReadFindingSeen => ({
  id: row.id,
  severity: severityOf(row),
  where: whereOf(row),
  text: row.text,
  question: row.question,
  tasksOnly: row.tasksOnly,
  fate: fateOf(row),
  questionId: row.questionId,
  fixedWhat: row.fixedWhat,
})

const passSeen = (row: ColdReadRow, findings: ReadonlyArray<FindingRow>): ColdReadPass => ({
  id: row.id,
  missionId: row.missionId,
  number: row.number,
  label: coldReadLabel(row.number),
  cycle: row.cycle,
  specVersion: row.specVersion,
  requestedBy: askerOf(row),
  state: stateOf(row),
  stuck: row.stuck,
  askedAt: row.askedAt,
  startedAt: row.startedAt,
  endedAt: row.endedAt,
  failure: row.failure,
  findings: findings.filter((one) => one.coldReadId === row.id).map(findingSeen),
})

// --- recording a pass -------------------------------------------------------------------------

/** Why the user may not ask for another pass now, or null. */
const againRefusal = (key: string, cycle: number, passes: ReadonlyArray<ColdReadRow>) => {
  const live = passes.find((one) => one.state === 'waiting_for_slot' || one.state === 'running')
  if (live !== undefined) {
    const label = coldReadLabel(live.number)
    return live.state === 'running'
      ? `Cold read ${label} is running: another pass waits for it to end.`
      : `Cold read ${label} waits for a free slot: another pass waits for it to end.`
  }
  if (!passes.some((one) => one.cycle === cycle)) {
    return `${key} has had no cold read in this Planning: the Spec is not declared complete yet.`
  }
  return null
}

const LIVE_SESSION = ['starting', 'working', 'idle', 'stuck']

/**
 * The user asks for another pass of a mission in Planning, bound to the Spec as it is now: refused
 * while one waits or runs, and before the first of the cycle. A pass running whose lineage has no
 * live session and holds no slot stopped without anything taking it up: it fails here, and the
 * new one is recorded. Hemera's own pass is recorded with the declaration (`store.ts`).
 */
const recordAgain = (missionId: string) =>
  Effect.gen(function* () {
    const cap = yield* Cap
    return yield* mutate('recording a cold read', (transaction) =>
      Effect.gen(function* () {
        const mission = yield* missionRow(transaction, missionId)
        const key = missionKey(mission.keyPrefix, mission.keyNumber)
        if (mission.stage !== 'planning') {
          return yield* new PlanningRefused({
            reason: `${key} is not in Planning: another pass is for a mission in Planning.`,
          })
        }
        const found = yield* passesIn(transaction, missionId)
        const events: NewEvent[] = []
        const passes: ColdReadRow[] = []
        for (const one of found) {
          const stale =
            one.state === 'running' &&
            !(yield* cap.holds(one.lineage)) &&
            (yield* transaction
              .select({ id: agentSessions.id })
              .from(agentSessions)
              .where(
                and(
                  eq(agentSessions.lineage, one.lineage),
                  inArray(agentSessions.state, LIVE_SESSION),
                ),
              )
              .pipe(Effect.mapError(refusedWhile('reading the sessions')))).length === 0
          if (!stale) {
            passes.push(one)
            continue
          }
          const { failed, events: more } = yield* failPassIn(transaction, one, SESSION_STOPPED)
          passes.push(failed ?? one)
          events.push(...more)
        }
        const refused = againRefusal(key, mission.planningCycle, passes)
        if (refused !== null) return yield* new PlanningRefused({ reason: refused })
        const spec = yield* specIn(transaction, missionId)
        const { row, event } = yield* insertPassIn(transaction, {
          mission,
          spec,
          asker: 'user',
          passes,
        })
        return {
          result: row,
          events: [...events, event, yield* hemeraNext(transaction, missionId, COLD_READ_WAITS)],
        }
      }),
    )
  })

/** The user asks for another pass. */
export const againColdRead = (missionId: string) =>
  Effect.map(recordAgain(missionId), (row) => passSeen(row, []))

/** Moves a pass from one of the states, with its events; answers the row as it is now, or null. */
export const movePass = (
  row: Pick<ColdReadRow, 'id'>,
  from: ReadonlyArray<ColdReadState>,
  set: Partial<typeof coldReads.$inferInsert>,
  events: (fresh: ColdReadRow) => ReadonlyArray<NewEvent>,
) =>
  mutate('moving a cold read', (transaction) =>
    Effect.gen(function* () {
      const [fresh] = yield* transaction
        .update(coldReads)
        .set(set)
        .where(and(eq(coldReads.id, row.id), inArray(coldReads.state, [...from])))
        .returning()
        .pipe(Effect.mapError(refusedWhile('moving a cold read')))
      return { result: fresh ?? null, events: fresh === undefined ? [] : events(fresh) }
    }),
  )

/**
 * A pass waiting or running, failed with why, in the transaction given, with its event: what its
 * sessions still ask the user goes with it, so no Retry starts its lineage again. Null when it was
 * neither waiting nor running.
 */
const failPassIn = (transaction: EngineTransaction, row: Pick<ColdReadRow, 'id'>, why: string) =>
  Effect.gen(function* () {
    const secrets = yield* Secrets
    const masked = secrets.mask(why)
    const [fresh] = yield* transaction
      .update(coldReads)
      .set({ state: 'failed', failure: masked, stuck: false, endedAt: now() })
      .where(
        and(eq(coldReads.id, row.id), inArray(coldReads.state, ['waiting_for_slot', 'running'])),
      )
      .returning()
      .pipe(Effect.mapError(refusedWhile('failing a cold read')))
    if (fresh === undefined) return { failed: null, events: [] }
    const asked = yield* transaction
      .select({ id: sessionNeeds.needId })
      .from(sessionNeeds)
      .innerJoin(agentSessions, eq(agentSessions.id, sessionNeeds.sessionId))
      .where(eq(agentSessions.lineage, fresh.lineage))
      .pipe(Effect.mapError(refusedWhile('reading the needs of a cold read')))
    const expired: NewEvent[] = []
    for (const need of asked) {
      expired.push(...(yield* expireNeedIn(transaction, need.id, PASS_ENDED)))
    }
    return {
      failed: fresh,
      events: [coldReadEvent('planning.cold_read_failed', fresh, { why: masked }), ...expired],
    }
  })

/** A pass waiting or running, failed with why; null when it was neither. */
export const failPass = (row: Pick<ColdReadRow, 'id'>, why: string) =>
  mutate('failing a cold read', (transaction) =>
    Effect.map(failPassIn(transaction, row, why), ({ failed, events }) => ({
      result: failed,
      events,
    })),
  )

// --- the tools --------------------------------------------------------------------------------

const failed = (cause: { readonly message: string }) => failure(`the call failed: ${cause.message}`)

/**
 * `cold_read_report`: checked, its findings stored bound to the version read, the pass done, and
 * its delivery to the Planner stored, in one transaction. An empty report is delivered to nobody.
 */
export const coldReadReportTool = (grant: Grant, args: ToolArguments<'cold_read_report'>) =>
  Effect.gen(function* () {
    const secrets = yield* Secrets
    const session = yield* getSession(grant.sessionId)
    const found = yield* coldReadOfLineage(session.lineage)
    if (found === null) return refusal('refused: this session is no cold read')
    const refused = coldReadReportRefusal(args.findings)
    if (refused !== null) return refusal(refused)
    const label = coldReadLabel(found.number)
    return yield* mutate('keeping a cold read’s report', (transaction) =>
      Effect.gen(function* () {
        const [row] = yield* transaction
          .select()
          .from(coldReads)
          .where(eq(coldReads.id, found.id))
          .pipe(Effect.mapError(refusedWhile('reading a cold read')))
        if (row?.state !== 'running') {
          return {
            result: refusal(`refused: cold read ${label} already ended (${row?.state ?? 'gone'})`),
            events: [],
          }
        }
        // A Cancel or a move committed before this report: the pass fails with its mission.
        const mission = yield* missionRow(transaction, row.missionId)
        if (mission.stage !== 'planning') {
          const key = missionKey(mission.keyPrefix, mission.keyNumber)
          return {
            result: refusal(
              `refused: ${key} is not in Planning any more: this cold read ends without its report.`,
            ),
            events: [],
          }
        }
        const kept: FindingKept[] = args.findings.map((finding, at) => ({
          id: findingIdOf(row.number, at + 1),
          severity: finding.severity,
          where: finding.where.map((one) => one.trim()),
          text: secrets.mask(finding.text.trim()),
          question:
            finding.question === undefined || finding.question.trim() === ''
              ? null
              : secrets.mask(finding.question.trim()),
          tasksOnly: tasksOnly(finding.where),
        }))
        const at = now()
        for (const [index, one] of kept.entries()) {
          yield* transaction
            .insert(coldReadFindings)
            .values({
              missionId: row.missionId,
              id: one.id,
              coldReadId: row.id,
              number: index + 1,
              severity: one.severity,
              where: secrets.mask(writeWhere(one.where)),
              text: secrets.mask(one.text),
              question: one.question === null ? null : secrets.mask(one.question),
              tasksOnly: one.tasksOnly,
              fate: 'open',
              questionId: null,
              fixedWhat: null,
              inputId: null,
              changedAt: at,
            })
            .pipe(Effect.mapError(refusedWhile('keeping a finding')))
        }
        // Every kind here is a lowercase word: a refusal would be a defect.
        const deliveryId =
          kept.length === 0
            ? null
            : yield* storeDeliveryIn(transaction, {
                owner: { kind: 'mission', missionId: row.missionId },
                target: { role: 'planner' },
                kind: 'cold-read',
                body: coldReadDelivery(label, row.specVersion, kept),
              }).pipe(Effect.catchTag('DeliveryKindRefused', Effect.die))
        yield* transaction
          .update(coldReads)
          .set({ state: 'done', stuck: false, endedAt: at, deliveryId })
          .where(eq(coldReads.id, row.id))
          .pipe(Effect.mapError(refusedWhile('ending a cold read')))
        return {
          result: answered(
            `Kept: cold read ${label} ended with ${String(kept.length)} finding(s) about version ${String(row.specVersion)}. Your work ends here.`,
          ),
          events: [
            coldReadEvent('planning.cold_read_ended', row, {
              version: row.specVersion,
              ...severityCounts(kept),
              deliveryId,
            }),
          ],
        }
      }),
    )
  }).pipe(Effect.catch((cause) => Effect.succeed(failed(cause))))

/** `cold_read_fixed`: the Planner marks fixed a finding it may fix, with what it changed. */
export const coldReadFixedTool = (grant: Grant, args: ToolArguments<'cold_read_fixed'>) =>
  Effect.gen(function* () {
    const missionId = grant.missionId
    if (missionId === null) return refusal('refused: this session works for no mission')
    const writer = { sessionId: grant.sessionId, role: grant.role, missionId }
    const secrets = yield* Secrets
    const what = secrets.mask(args.what.trim())
    const id = args.finding.trim()
    return yield* mutate('marking a finding fixed', (transaction) =>
      Effect.gen(function* () {
        const answer = (result: ToolAnswer, events: ReadonlyArray<NewEvent> = []) => ({
          result,
          events,
        })
        const standing = yield* standingOf(transaction, writer)
        if (standing.refusal !== null) return answer(refusal(`refused: ${standing.refusal}`))
        const row = yield* findingRow(transaction, missionId, id)
        if (row === null) return answer(refusal(`refused: this mission has no finding ${id}.`))
        if (row.fate === 'dismissed') {
          return answer(refusal(`refused: the user dismissed ${id}: nothing to fix.`))
        }
        if (row.fate === 'fixed') {
          return answer(
            answered(`${id} is already fixed (${row.fixedWhat ?? ''}): nothing changed.`),
          )
        }
        if (row.severity === 'blocking' && !row.tasksOnly) {
          return answer(
            refusal(
              `refused: ${id} is blocking on the Spec: ask it in your next wave with from_finding "${id}".`,
            ),
          )
        }
        yield* transaction
          .update(coldReadFindings)
          .set({ fate: 'fixed', fixedWhat: what, changedAt: now() })
          .where(and(eq(coldReadFindings.missionId, missionId), eq(coldReadFindings.id, id)))
          .pipe(Effect.mapError(refusedWhile('marking a finding fixed')))
        return answer(answered(`${id} is fixed (${what}).`), [
          plannerEvent(writer, 'planning.cold_read_fixed', { finding: id, what }),
        ])
      }),
    )
  }).pipe(Effect.catch((cause) => Effect.succeed(failed(cause))))

/**
 * What `spec_read` hands a cold read: the Spec at the version its pass was launched on, whole or
 * one part, with the header it opens with; null for a session that is no cold read.
 */
export const coldReadSpec = (grant: Grant, part: string | undefined) =>
  Effect.gen(function* () {
    const session = yield* getSession(grant.sessionId)
    const row = yield* coldReadOfLineage(session.lineage)
    const snapshot = row === null ? null : snapshotOf(row)
    if (row === null || snapshot === null) return null
    return {
      text: part === undefined ? snapshot.whole : (snapshot.parts[part] ?? ''),
      header: `Cold read ${coldReadLabel(row.number)} reads the Spec of ${snapshot.key} at version ${String(row.specVersion)}.\n\n`,
    }
  })

// --- the user's side --------------------------------------------------------------------------

/** Why a question asked from a finding the user dismissed is withdrawn. */
const DISMISSED = 'finding dismissed by you'

/** The question an asked finding is asked as, withdrawn when still open or waiting. */
const withdrawIn = (transaction: EngineTransaction, missionId: string, questionId: string) =>
  Effect.gen(function* () {
    const secrets = yield* Secrets
    const [question] = yield* transaction
      .select()
      .from(questions)
      .where(and(eq(questions.missionId, missionId), eq(questions.id, questionId)))
      .pipe(Effect.mapError(refusedWhile('reading a question')))
    if (question?.state !== 'open' && question?.state !== 'waiting') {
      return { withdrawn: null, events: [] }
    }
    yield* transaction
      .update(questions)
      .set({ state: 'withdrawn', retiredReason: secrets.mask(DISMISSED), changedAt: now() })
      .where(and(eq(questions.missionId, missionId), eq(questions.id, question.id)))
      .pipe(Effect.mapError(refusedWhile('withdrawing a question')))
    const events =
      question.state === 'waiting'
        ? yield* clearMarkIn(
            transaction,
            missionId,
            WaitingOnSomeoneMark.make({ question: question.id, note: question.waitingNote }),
          )
        : []
    return { withdrawn: question.id, events }
  })

/**
 * The user dismisses a finding of any severity: a question asked from it and still open is
 * withdrawn, and the dismissal is received as an input (CT-26), then delivered to the Planner. A
 * second dismissal changes nothing.
 */
export const dismissFinding = (missionId: string, findingId: string) =>
  Effect.gen(function* () {
    const dismissed = yield* mutate('dismissing a finding', (transaction) =>
      Effect.gen(function* () {
        const mission = yield* missionRow(transaction, missionId)
        const key = missionKey(mission.keyPrefix, mission.keyNumber)
        if (mission.stage !== 'planning') {
          return yield* new PlanningRefused({
            reason: `${key} is not in Planning: dismissing a finding is for a mission in Planning.`,
          })
        }
        const row = yield* findingRow(transaction, missionId, findingId)
        if (row === null) {
          return yield* new PlanningRefused({ reason: `${key} has no finding ${findingId}.` })
        }
        if (row.fate === 'dismissed') return { result: false, events: [] }
        if (row.fate === 'fixed') {
          return yield* new PlanningRefused({
            reason: `${findingId} is fixed already: nothing to dismiss.`,
          })
        }
        // Its question, or the one that replaced it: the one asked now.
        const live =
          row.fate === 'asked' && row.questionId !== null
            ? yield* liveQuestionIn(transaction, missionId, row.questionId)
            : null
        const { withdrawn, events } =
          live === null
            ? { withdrawn: null, events: [] }
            : yield* withdrawIn(transaction, missionId, live)
        const [pass] = yield* transaction
          .select({ version: coldReads.specVersion })
          .from(coldReads)
          .where(eq(coldReads.id, row.coldReadId))
          .pipe(Effect.mapError(refusedWhile('reading a cold read')))
        const input = yield* receiveInput(transaction, {
          missionId,
          kind: 'dismissed_finding',
          item: row.id,
          version: pass?.version ?? null,
          // The user's gesture is the dismissal alone: the finding is the cold read's, quoted.
          said: [
            `The user dismissed ${row.id}.`,
            withdrawn === null ? null : `Its question ${withdrawn} is withdrawn.`,
            `What the cold read said in ${row.id} (${row.severity} · ${whereOf(row).join(', ')}), its words and not the user’s: “${row.text}”`,
            'Do not apply it: mark this input integrated with no change, unless something else requires one.',
          ]
            .filter((one) => one !== null)
            .join(' '),
          supersedes: false,
        })
        yield* transaction
          .update(coldReadFindings)
          .set({ fate: 'dismissed', inputId: input, changedAt: now() })
          .where(and(eq(coldReadFindings.missionId, missionId), eq(coldReadFindings.id, row.id)))
          .pipe(Effect.mapError(refusedWhile('dismissing a finding')))
        const event: NewEvent = {
          type: 'planning.cold_read_dismissed',
          entityKind: 'mission',
          entityId: missionId,
          source: 'ui',
          author: 'human',
          payload: { finding: row.id, author: 'user', withdrawn, input },
        }
        return { result: true, events: [event, ...events] }
      }),
    )
    if (dismissed) yield* deliverInputs(missionId)
  })

// --- what the Planning page reads -------------------------------------------------------------

/** A mission's passes, the first first, each with its findings. */
export const listColdReads = (missionId: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    return yield* database.transaction((transaction) =>
      Effect.gen(function* () {
        yield* missionRow(transaction, missionId)
        const findings = yield* findingsIn(transaction, missionId)
        return (yield* passesIn(transaction, missionId)).map((row) => passSeen(row, findings))
      }),
    )
  })

/** The passes now, then again at each event of the mission, for as long as the caller listens. */
export const coldReadChanges = (missionId: string) =>
  Stream.unwrap(
    Effect.gen(function* () {
      const events = yield* DomainEvents.use((domain) => domain.subscribe)
      return Stream.concat(
        Stream.fromEffect(listColdReads(missionId)),
        events.pipe(
          Stream.filter((event) => event.entityKind === 'mission' && event.entityId === missionId),
          Stream.mapEffect(() => listColdReads(missionId)),
        ),
      )
    }),
  )

/** The version the last finished pass read, the Spec's version now, and what changed between. */
export const coldReadFreshness = (missionId: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const { passes, version } = yield* database.transaction((transaction) =>
      Effect.gen(function* () {
        yield* missionRow(transaction, missionId)
        const [spec] = yield* transaction
          .select({ version: specs.version })
          .from(specs)
          .where(eq(specs.missionId, missionId))
          .pipe(Effect.mapError(refusedWhile('reading the Spec')))
        return { passes: yield* passesIn(transaction, missionId), version: spec?.version ?? 0 }
      }),
    )
    const read = passes.filter((one) => one.state === 'done').at(-1)?.specVersion ?? null
    const freshness: ColdReadFreshness = {
      readVersion: read,
      specVersion: version,
      changes: read === null ? [] : yield* changesSince(missionId, read),
    }
    return freshness
  })

/** Whether inputs are all integrated, and there is at least one. */
const allIntegrated = (inputs: ReadonlyArray<{ readonly state: string }>) =>
  inputs.some((one) => one.state === 'integrated') &&
  !inputs.some((one) => one.state === 'received' || one.state === 'delivered')

/**
 * Whether a question made moot is settled: a discussion on it closed on a decision (#87), and that
 * decision is integrated. A question made moot otherwise is not.
 */
const mootSettledIn = (transaction: EngineTransaction, missionId: string, id: string) =>
  Effect.gen(function* () {
    const decided = yield* transaction
      .select({ number: discussions.number })
      .from(discussions)
      .where(
        and(
          eq(discussions.missionId, missionId),
          eq(discussions.itemKind, 'question'),
          eq(discussions.itemId, id),
          eq(discussions.outcome, 'decision'),
        ),
      )
      .pipe(Effect.mapError(refusedWhile('reading the discussions')))
    if (decided.length === 0) return false
    const inputs = yield* transaction
      .select({ state: planningInputs.state })
      .from(planningInputs)
      .where(
        and(
          eq(planningInputs.missionId, missionId),
          eq(planningInputs.kind, 'discuss_decision'),
          inArray(
            planningInputs.item,
            decided.map((one) => `#${String(one.number)}`),
          ),
        ),
      )
      .pipe(Effect.mapError(refusedWhile('reading the inputs')))
    return allIntegrated(inputs)
  })

/**
 * Whether an asked finding's question is settled: its question, or the one that replaced it, is
 * answered and every input of its answers integrated, or made moot by a decision of a discussion
 * that is integrated.
 */
const questionSettledIn = (transaction: EngineTransaction, missionId: string, id: string) =>
  Effect.gen(function* () {
    const seen = new Set<string>()
    let current: string | null = id
    while (current !== null && !seen.has(current)) {
      seen.add(current)
      const found: ReadonlyArray<QuestionRow> = yield* transaction
        .select()
        .from(questions)
        .where(and(eq(questions.missionId, missionId), eq(questions.id, current)))
        .pipe(Effect.mapError(refusedWhile('reading a question')))
      const question = found[0]
      if (question?.state !== 'replaced') {
        if (question?.state === 'moot') return yield* mootSettledIn(transaction, missionId, current)
        if (question?.state !== 'answered') return false
        const inputs = yield* transaction
          .select({ state: planningInputs.state })
          .from(planningInputs)
          .where(and(eq(planningInputs.missionId, missionId), eq(planningInputs.item, question.id)))
          .pipe(Effect.mapError(refusedWhile('reading the inputs')))
        return allIntegrated(inputs)
      }
      current = question.replacedBy
    }
    return false
  })

/** Whether the cold read lets the Freeze appear (#92), and every reason it does not. */
export const coldReadSettled = (missionId: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const reasons = yield* database.transaction((transaction) =>
      Effect.gen(function* () {
        yield* missionRow(transaction, missionId)
        const passes = yield* passesIn(transaction, missionId)
        const latest = passes.at(-1)
        if (latest === undefined) return coldReadUnsettled(null, null)
        const head = { label: coldReadLabel(latest.number), state: stateOf(latest) }
        // A failed pass leaves the findings of the last pass done in its cycle to settle.
        const judged = passes.findLast((one) => one.state === 'done' && one.cycle === latest.cycle)
        if (judged === undefined) return coldReadUnsettled(head, null)
        const findings = (yield* findingsIn(transaction, missionId)).filter(
          (one) => one.coldReadId === judged.id,
        )
        const standing: FindingStanding[] = []
        for (const row of findings) {
          standing.push({
            id: row.id,
            severity: severityOf(row),
            tasksOnly: row.tasksOnly,
            fate: fateOf(row),
            questionId: row.questionId,
            questionSettled:
              row.questionId !== null &&
              (yield* questionSettledIn(transaction, missionId, row.questionId)),
          })
        }
        return coldReadUnsettled(head, standing)
      }),
    )
    return { settled: reasons.length === 0, reasons }
  })

// --- the Journal ------------------------------------------------------------------------------

const readString = Schema.decodeUnknownOption(Schema.String)
const readNumber = Schema.decodeUnknownOption(Schema.Number)
const stringOf = (payload: EventPayload, key: string): string =>
  Option.getOrElse(readString(payload[key]), () => '')
const numberOf = (payload: EventPayload, key: string): number =>
  Option.getOrElse(readNumber(payload[key]), () => 0)
const labelOf = (payload: EventPayload): string => coldReadLabel(numberOf(payload, 'number'))

const lineOf =
  (
    author: (payload: EventPayload) => MemoryAuthor,
    text: (payload: EventPayload) => string,
  ): JournalMapper =>
  (event) =>
    Effect.succeed({
      missionId: event.entityId,
      kind: 'planning',
      author: author(event.payload),
      text: text(event.payload),
    })

const byHemera = (): MemoryAuthor => HemeraAuthor.make({})
const byUser = (): MemoryAuthor => UserAuthor.make({})

/** The cold reads' lines in the Journal: launched, ended, failed, a finding fixed or dismissed. */
export const COLD_READ_MAPPERS: ReadonlyMap<string, JournalMapper> = new Map([
  [
    'planning.cold_read_started',
    lineOf(
      (payload) => (stringOf(payload, 'requestedBy') === 'user' ? byUser() : byHemera()),
      (payload) =>
        `Cold read ${labelOf(payload)} launched by ${stringOf(payload, 'requestedBy') === 'user' ? 'the user' : 'Hemera'}, on version ${String(numberOf(payload, 'version'))} of the Spec`,
    ),
  ],
  [
    'planning.cold_read_ended',
    lineOf(
      byHemera,
      (payload) =>
        `Cold read ${labelOf(payload)} ended on version ${String(numberOf(payload, 'version'))}: ${String(numberOf(payload, 'blocking'))} blocking, ${String(numberOf(payload, 'warning'))} warning(s), ${String(numberOf(payload, 'suggestion'))} suggestion(s)`,
    ),
  ],
  [
    'planning.cold_read_failed',
    lineOf(
      byHemera,
      (payload) => `Cold read ${labelOf(payload)} failed: ${stringOf(payload, 'why')}`,
    ),
  ],
  [
    'planning.cold_read_fixed',
    lineOf(
      (payload) => AgentAuthor.make({ role: 'planner', sessionId: stringOf(payload, 'sessionId') }),
      (payload) =>
        `The Planner fixed ${stringOf(payload, 'finding')}: ${stringOf(payload, 'what')}`,
    ),
  ],
  [
    'planning.cold_read_dismissed',
    lineOf(byUser, (payload) => {
      const withdrawn = stringOf(payload, 'withdrawn')
      return `The user dismissed ${stringOf(payload, 'finding')}${withdrawn === '' ? '' : `; ${withdrawn} is withdrawn`}`
    }),
  ],
])
