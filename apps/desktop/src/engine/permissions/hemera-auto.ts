/**
 * Hemera Auto: Jev as step 5 of the order of decision, and what it stands on.
 *
 * - The key and the consent (`HemeraAuto`): the key is sealed by the operating system in main,
 *   which hands the engine only its ciphertext to store; at each start main decrypts it and hands
 *   the key over, and the engine holds it in memory only, registered as a secret. Jev is used only
 *   once a key is held and the user consented. A key Jev rejects (401, 403) is not sent again.
 * - What Jev is told of the user's intent (`HumanIntent`): only the user's own words, bounded.
 * - The judge (`jevJudgeLayer`): the call as Hemera will run it, masked; the verdict from the
 *   scores at the Normal level; a verdict reused for an identical call within the same turn; a
 *   verdict judged again when the user said something new before the call runs; and every
 *   failure `unavailable`, which asks.
 * - Who judges (`whoJudgesFor`) and the live decisions (`decisionChanges`), for the settings.
 */

import { resolve } from 'node:path'

import {
  type AgentProvider,
  type HumanItem,
  NeedAnswer,
  NeedFields,
  PERMISSION_POLICY,
  type WhoJudges,
  boundedHumanContext,
  runsAShell,
  verdictFromScores,
  whoJudges,
  wordsOf,
} from '@hemera/core/domain'
import { PermissionDecision } from '@hemera/ipc'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { Context, Effect, Layer, Option, Predicate, Result, Schema, Stream } from 'effect'

import type { Log } from '../../main/diagnostic.ts'
import { findOnPath, hostLookup, invocationOf } from '../command-line.ts'
import { DomainEvents } from '../domain-events.ts'
import { Secrets } from '../secrets.ts'
import { Database, type DatabaseError, refusedWhile } from '../storage/database.ts'
import { answers, appPreferences, needs, questions } from '../storage/schema.ts'
import { shownPath } from '../tools/paths.ts'
import type { CallSession, JudgedCall } from '../tools/ports.ts'
import { type JevResult, type JevTransport, askJev } from './jev.ts'
import { Judge, type JudgeAnswer, SessionTurns } from './ports.ts'

/** The rows of the preferences the key's ciphertext and the consent are kept in. */
const CIPHERTEXT_KEY = 'hemera-auto.jev-ciphertext'
const CONSENT_KEY = 'hemera-auto.consent'

/** The source the key is registered under in the registry of secrets. */
const KEY_SOURCE = 'jev-key'

/** The settings section a call that asks for want of a judge links to. */
export const HEMERA_AUTO_SECTION = 'hemera-auto'

/** Where the key stands in the engine; main adds whether the system can protect it at all. */
export interface HemeraAutoState {
  /** A ciphertext is stored. */
  readonly stored: boolean
  /** The key is held in memory: main decrypted it and handed it over. */
  readonly held: boolean
  /** Jev rejected the key held (401 or 403). */
  readonly refused: boolean
  readonly consent: boolean
}

/** Whether Jev may be asked now, with the key; or why not. */
export type JevReadiness =
  | { readonly ready: true; readonly key: string }
  | { readonly ready: false; readonly why: 'no-key' | 'undecrypted' | 'no-consent' | 'refused' }

export class HemeraAuto extends Context.Service<
  HemeraAuto,
  {
    readonly state: Effect.Effect<HemeraAutoState, DatabaseError>
    /** The ciphertext main stored, for main to decrypt; null when none is. */
    readonly ciphertext: Effect.Effect<string | null, DatabaseError>
    /** Stores a new key's ciphertext; the key held before is let go until main hands the new one. */
    readonly storeKey: (ciphertext: string) => Effect.Effect<void, DatabaseError>
    /** The key, decrypted by main: held in memory only, registered as a secret. */
    readonly restoreKey: (key: string) => Effect.Effect<void>
    readonly removeKey: Effect.Effect<void, DatabaseError>
    readonly setConsent: (consent: boolean) => Effect.Effect<void, DatabaseError>
    readonly readiness: Effect.Effect<JevReadiness>
    /** Jev rejected this key: it is not sent again until another one is handed over. */
    readonly refuse: (key: string) => Effect.Effect<void>
  }
>()('HemeraAuto') {}

export const hemeraAutoLayer = (log: Log) =>
  Layer.effect(
    HemeraAuto,
    Effect.gen(function* () {
      const database = yield* Database
      const secrets = yield* Secrets
      let key: string | null = null
      let refused = false
      const valueOf = (name: string) =>
        database
          .select({ value: appPreferences.value })
          .from(appPreferences)
          .where(eq(appPreferences.key, name))
          .pipe(
            Effect.map(([row]) => row?.value ?? null),
            Effect.mapError(refusedWhile('reading the Hemera Auto settings')),
          )
      const write = (name: string, value: string) =>
        database
          .insert(appPreferences)
          .values({ key: name, value })
          .onConflictDoUpdate({ target: appPreferences.key, set: { value } })
          .pipe(Effect.mapError(refusedWhile('writing the Hemera Auto settings')), Effect.asVoid)
      const forget = () => {
        key = null
        refused = false
        secrets.unregister(KEY_SOURCE)
      }
      const consented = Effect.map(valueOf(CONSENT_KEY), (value) => value === 'true')
      return {
        state: Effect.gen(function* () {
          const stored = (yield* valueOf(CIPHERTEXT_KEY)) !== null
          return { stored, held: key !== null, refused, consent: yield* consented }
        }),
        ciphertext: valueOf(CIPHERTEXT_KEY),
        storeKey: (ciphertext) =>
          write(CIPHERTEXT_KEY, ciphertext).pipe(
            Effect.tap(() =>
              Effect.sync(() => {
                forget()
                log('hemera auto: a new Jev key was stored, sealed by the system')
              }),
            ),
          ),
        restoreKey: (given) =>
          Effect.sync(() => {
            if (given !== key) refused = false
            key = given
            secrets.register(KEY_SOURCE, [given])
          }),
        removeKey: database
          .delete(appPreferences)
          .where(eq(appPreferences.key, CIPHERTEXT_KEY))
          .pipe(
            Effect.mapError(refusedWhile('removing the Jev key')),
            Effect.tap(() =>
              Effect.sync(() => {
                forget()
                log('hemera auto: the Jev key was removed')
              }),
            ),
            Effect.asVoid,
          ),
        setConsent: (consent) =>
          write(CONSENT_KEY, String(consent)).pipe(
            Effect.tap(() =>
              Effect.sync(() => log(`hemera auto: consent ${consent ? 'given' : 'withdrawn'}`)),
            ),
          ),
        readiness: Effect.gen(function* () {
          if (key === null) {
            const stored = yield* valueOf(CIPHERTEXT_KEY)
            return { ready: false, why: stored === null ? 'no-key' : 'undecrypted' } as const
          }
          if (refused) return { ready: false, why: 'refused' } as const
          if (!(yield* consented)) return { ready: false, why: 'no-consent' } as const
          return { ready: true, key } as const
        }).pipe(Effect.orElseSucceed(() => ({ ready: false, why: 'no-consent' }) as const)),
        refuse: (rejected) =>
          Effect.sync(() => {
            if (key !== rejected || refused) return
            refused = true
            log(
              'hemera auto: Jev refused the saved key; it is not sent again until a new one is saved',
            )
          }),
      }
    }),
  )

/** Who judges a call of this agent in this mode: neither changes it in this version. */
export const whoJudgesFor = (
  _agent: AgentProvider,
  _mode: string | null,
): Effect.Effect<WhoJudges, never, HemeraAuto> =>
  HemeraAuto.use((auto) => auto.readiness).pipe(
    Effect.map((readiness) => whoJudges(readiness.ready)),
  )

// ---------------------------------------------------------------------------------------------
// The user's intent.

/** What the user said that bears on a session's calls, and its version. */
export interface Intent {
  /** Oldest first. */
  readonly items: ReadonlyArray<HumanItem>
  /** Changes whenever the user says something new: a verdict seen on another version is stale. */
  readonly version: string
}

/**
 * The user's intent for a session. In a mission: the frozen Spec and its decisions, and the
 * user's answers to the waves and to Needs you; in a Chat: the user's latest messages. Never the
 * agent's text, a file's content or a tool's result.
 */
export class HumanIntent extends Context.Service<
  HumanIntent,
  { readonly of: (session: CallSession) => Effect.Effect<Intent> }
>()('HumanIntent') {}

const readFields = Schema.decodeUnknownOption(Schema.fromJsonString(NeedFields))
const readAnswer = Schema.decodeUnknownOption(Schema.fromJsonString(NeedAnswer))

const readOptions = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Array(Schema.Struct({ id: Schema.String, label: Schema.String }))),
)

/**
 * The user's answers in the session's mission, as this version stores them, oldest first:
 * - to its Needs you: the words the user wrote, and an option the user chose (its text, marked as
 *   chosen by the user); a question is the agent's, so it is never told, and a permission's answer
 *   says nothing of intent;
 * - to its Planning questions (#86): the latest version of each answer to a question still
 *   answered, as the option the user chose or the words they wrote; the question is the Planner's,
 *   so it is never told either.
 * The frozen Spec and the Chat's messages are not stored yet: they add nothing here.
 */
export const humanIntentLayer = Layer.effect(
  HumanIntent,
  Effect.gen(function* () {
    const database = yield* Database
    const answered = (missionId: string) =>
      Effect.gen(function* () {
        const needRows = yield* database
          .select({ id: needs.id, fields: needs.fields, answer: needs.answer, at: needs.endedAt })
          .from(needs)
          .where(
            and(
              eq(needs.missionId, missionId),
              eq(needs.state, 'answered'),
              inArray(needs.kind, ['Decision', 'Error']),
            ),
          )
          .orderBy(asc(needs.endedAt), asc(needs.id))
        const answerRows = yield* database
          .select({
            question: questions.id,
            options: questions.options,
            version: answers.version,
            optionId: answers.optionId,
            written: answers.text,
            at: answers.at,
          })
          .from(answers)
          .innerJoin(
            questions,
            and(eq(questions.missionId, answers.missionId), eq(questions.id, answers.questionId)),
          )
          .where(and(eq(answers.missionId, missionId), eq(questions.state, 'answered')))
          .orderBy(asc(answers.at), asc(answers.version))
        const told: Array<{ readonly at: string; readonly item: HumanItem }> = []
        for (const row of needRows) {
          const answer = Option.getOrNull(readAnswer(row.answer ?? ''))
          if (answer === null || Option.isNone(readFields(row.fields))) continue
          const at = row.at ?? ''
          if (Predicate.isTagged(answer, 'Written')) {
            told.push({ at, item: { source: 'answer', text: answer.text } })
          } else if (Predicate.isTagged(answer, 'Chosen')) {
            told.push({ at, item: { source: 'chosen-option', text: answer.option } })
          }
        }
        // The latest version of each answer only: a changed answer replaces what it said.
        const latest = answerRows.filter(
          (row) =>
            !answerRows.some(
              (other) => other.question === row.question && other.version > row.version,
            ),
        )
        for (const row of latest) {
          const chosen = row.optionId
          if (chosen === null) {
            told.push({ at: row.at, item: { source: 'answer', text: row.written ?? '' } })
            continue
          }
          const label = Option.match(readOptions(row.options), {
            onNone: () => chosen,
            onSome: (options) => options.find((one) => one.id === chosen)?.label ?? chosen,
          })
          told.push({ at: row.at, item: { source: 'chosen-option', text: label } })
        }
        const items = told
          .toSorted((one, other) => one.at.localeCompare(other.at))
          .map((one) => one.item)
        const lastNeed = needRows.at(-1)
        const lastAnswer = answerRows.at(-1)
        return {
          items,
          version: [
            String(needRows.length),
            lastNeed?.at ?? '',
            lastNeed?.id ?? '',
            String(answerRows.length),
            lastAnswer?.at ?? '',
          ].join(':'),
        }
      })
    return {
      of: (session) =>
        session.missionId === null
          ? Effect.succeed({ items: [], version: 'none' })
          : answered(session.missionId).pipe(
              // What does not read is judged without it: nothing the user said lifts the call.
              Effect.orElseSucceed(() => ({ items: [], version: 'unreadable' })),
            ),
    }
  }),
)

// ---------------------------------------------------------------------------------------------
// The judge.

export interface JudgeSettings {
  readonly log: Log
  /** What `~` stands for. */
  readonly home: string
  readonly platform: NodeJS.Platform
}

/**
 * The call as Hemera will run it, as Jev is told it: the tool; for a command, the line, the
 * program as the `PATH` resolves it and its arguments, whether a shell reads it, the platform and
 * the folder; for a file, its path; and whether it stays inside the role's place. Paths are said
 * from the home. Never a file's content.
 */
export const jevAction = (call: JudgedCall, home: string, platform: string): Schema.JsonObject => {
  if (call.tool !== 'commands_run') {
    return {
      tool: call.tool,
      path: call.path === null ? null : shownPath(call.path.resolved, home),
      platform,
      inside: call.path?.inside ?? true,
    }
  }
  const line = call.command?.line ?? call.line ?? ''
  const [program = '', ...args] = wordsOf(line)
  const folder = resolve(call.session.place.root, call.folder ?? '.')
  const lookup = hostLookup(folder)
  const found = findOnPath(program, lookup, platform)
  return {
    tool: call.tool,
    line,
    program: found === null ? program : shownPath(found, home),
    args,
    shell:
      runsAShell(program) ||
      (invocationOf([program, ...args], platform, lookup)?.verbatim ?? false),
    platform,
    cwd: shownPath(folder, home),
    // Step 3 asked whatever pointed outside: what reaches Jev stays inside.
    inside: true,
  }
}

/** How many sessions keep their turn's verdicts, the least recently judged let go of first. */
const SESSIONS_KEPT = 64
/** How many times a call is judged again because the user said something new meanwhile. */
const ROUNDS = 3

type Evaluated = Extract<JevResult, { readonly kind: 'evaluated' }>

const FAILURES: Readonly<Record<Exclude<JevResult, Evaluated>['failure'], string>> = {
  input: 'the call could not be sent to Jev whole',
  response: 'Jev’s answer could not be read',
  network: 'Jev could not be reached',
  timeout: 'Jev did not answer within 10 seconds',
  http: 'Jev answered HTTP',
}

const NOT_READY = {
  'no-key': 'no judge is set up to rate it',
  undecrypted: 'the saved Jev key could not be read on this system',
  'no-consent': 'Hemera Auto waits for consent to send calls to Jev',
  refused: 'Jev refused the saved key',
} as const

const rated = (scores: Evaluated['scores']): string =>
  `Jev rates it risk ${String(scores.risk)}, approval ${String(scores.approval)}, asked by the user ${String(scores.userRequested)}`

/** Jev as the judge of step 5: allows or asks, never refuses; any failure is `unavailable`. */
export const jevJudgeLayer = (settings: JudgeSettings) =>
  Layer.effect(
    Judge,
    Effect.gen(function* () {
      const services = yield* Effect.context<
        HemeraAuto | HumanIntent | SessionTurns | JevTransport | Secrets
      >()
      /** The verdicts of each session's current turn, by call. */
      const turns = new Map<string, { turn: number; verdicts: Map<string, Evaluated> }>()
      const verdictsOf = (sessionId: string, turn: number) => {
        const kept = turns.get(sessionId)
        turns.delete(sessionId)
        const now = kept?.turn === turn ? kept : { turn, verdicts: new Map<string, Evaluated>() }
        turns.set(sessionId, now)
        if (turns.size > SESSIONS_KEPT) turns.delete(turns.keys().next().value ?? '')
        return now.verdicts
      }

      const judge = (call: JudgedCall): Effect.Effect<JudgeAnswer> =>
        Effect.gen(function* () {
          const readiness = yield* HemeraAuto.use((auto) => auto.readiness)
          if (!readiness.ready) {
            return {
              verdict: 'unavailable',
              reason: NOT_READY[readiness.why],
              settingsSection: HEMERA_AUTO_SECTION,
            } satisfies JudgeAnswer
          }
          const action = jevAction(call, settings.home, settings.platform)
          const sessionId = call.session.sessionId
          const intent = HumanIntent.use((human) => human.of(call.session))
          for (let round = 0; round < ROUNDS; round += 1) {
            const seen = yield* intent
            const told = boundedHumanContext(seen.items)
            const turn = yield* SessionTurns.use((one) => one.current(sessionId))
            const verdicts = verdictsOf(sessionId, turn)
            const identity = JSON.stringify([PERMISSION_POLICY.policyVersion, seen.version, action])
            const kept = verdicts.get(identity)
            let evaluated: Evaluated
            if (kept === undefined) {
              const known = yield* Secrets.useSync((secrets) => secrets.values())
              const result = yield* askJev({ action, humanContext: told }, readiness.key, known)
              if (result.kind === 'unavailable') {
                const rejected =
                  result.failure === 'http' && (result.status === 401 || result.status === 403)
                const failure =
                  result.failure === 'http' ? `http ${String(result.status)}` : result.failure
                if (rejected) {
                  yield* HemeraAuto.use((auto) => auto.refuse(readiness.key))
                  return {
                    verdict: 'unavailable',
                    reason: NOT_READY.refused,
                    failure,
                    roundTripMs: result.ms,
                    settingsSection: HEMERA_AUTO_SECTION,
                  } satisfies JudgeAnswer
                }
                return {
                  verdict: 'unavailable',
                  reason:
                    result.failure === 'http'
                      ? `${FAILURES.http} ${String(result.status)}`
                      : FAILURES[result.failure],
                  failure,
                  roundTripMs: result.ms,
                } satisfies JudgeAnswer
              }
              evaluated = result
              verdicts.set(identity, result)
            } else {
              evaluated = kept
            }
            // The verdict holds only for what the user had said: something new, and it is judged
            // again before the call runs.
            if ((yield* intent).version !== seen.version) continue
            return {
              verdict: verdictFromScores(evaluated.scores, told.length > 0),
              reason: rated(evaluated.scores),
              judged: {
                judge: 'Jev',
                model: evaluated.model,
                scores: evaluated.scores,
                settled: kept === undefined ? 'jev' : 'reused',
                roundTripMs: kept === undefined ? evaluated.ms : null,
              },
            } satisfies JudgeAnswer
          }
          return {
            verdict: 'unavailable',
            reason: 'the user kept saying something new meanwhile',
          } satisfies JudgeAnswer
        }).pipe(Effect.provide(services))

      return { judge }
    }),
  )

// ---------------------------------------------------------------------------------------------
// The live decisions.

const readDecision = Schema.decodeUnknownOption(PermissionDecision)

/** Every decision on a call, as it is recorded, for Settings › Developer. */
export const decisionChanges: Stream.Stream<PermissionDecision, never, DomainEvents> =
  Stream.unwrap(
    Effect.map(
      DomainEvents.use((events) => events.subscribe),
      (committed) =>
        committed.pipe(
          Stream.filterMap((event) => {
            if (event.type !== 'permission.decided') return Result.fail(event)
            const decision = readDecision({
              ...event.payload,
              sequence: event.sequence,
              occurredAt: event.occurredAt,
              ownerKind: event.entityKind,
              ownerId: event.entityId,
            })
            return Option.isSome(decision) ? Result.succeed(decision.value) : Result.fail(event)
          }),
        ),
    ),
  )
