/**
 * The order of decision behind the gate's `Verdicts` port, for local and judged calls (workflow
 * calls never come here):
 *
 *  1. the role's guards (the gate's own, before this is asked);
 *  2. the refusals: the Project's "never" list and Hemera's local refusal rules (a deletion that
 *     touches `.git`; for every agent of a mission, a write to a remote or to the history, a forge
 *     CLI's write, a package publication, `git commit` without the right). The only steps that
 *     may refuse;
 *  3. places: a sensitive place always asks, and so does a catalogue command that changes an
 *     exclusive resource (#88), whatever the judge would say; then the grants hook (a live "Allow
 *     for this mission" grant for the same action allows it); then a path outside the role's
 *     place, or words that do not read, ask, and so does a catalogue command marked "ask before
 *     running";
 *  4. the local allows, only for what is fully understood: a read inside, a plain listing, a
 *     catalogue command of the place that does not go through a shell;
 *  5. the judge, which allows or asks;
 *  6. any failure of the judge asks. Never an allow on an error path.
 *
 * Every decision is a `permission.decided` event (who decided, why, the policy version and its
 * level, the target masked; for a judged call the judge, its model and its scores; how it was
 * settled and how long it took) and one line of the diagnostic log.
 */

import { userInfo } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'

import {
  PERMISSION_POLICY,
  PLACE_NAMES,
  type PlaceContext,
  ROLE_NAMES,
  concernSaid,
  deletesGit,
  effectiveAction,
  chatMustAsk,
  missionRefusal,
  neverMatch,
  neverSaid,
  placesNamed,
  plainListing,
  runsAShell,
  wordsOf,
} from '@hemera/core/domain'
import { Clock, Duration, Effect, Layer, Option, Result } from 'effect'

import type { Log } from '../../main/diagnostic.ts'
import type { DomainEvents } from '../domain-events.ts'
import type { Database } from '../storage/database.ts'
import { findOnPath, hostLookup, invocationOf } from '../command-line.ts'
import type { NewEvent } from '../journal.ts'
import { Secrets } from '../secrets.ts'
import { mutate } from '../transaction.ts'
import { changedBy } from '../resources/declarations.ts'
import { resolvePath, shownPath } from '../tools/paths.ts'
import { type JudgedCall, SensitivePlaces, type Verdict, Verdicts } from '../tools/ports.ts'
import { neverList } from './never-list.ts'
import { CommitRights, Judge, type Judged, MissionGrants } from './ports.ts'

/** A question the step 3 asks about, besides a sensitive place. */
type Concern =
  | { readonly kind: 'outside'; readonly place: string }
  | { readonly kind: 'ask-before-running'; readonly command: string }

/** How long the judge is given before its silence asks. */
export const JUDGE_LIMIT = Duration.seconds(10)

/** The tools that only read, allowed inside the role's place with no place concern. */
const READS = new Set(['fs_read', 'fs_list', 'search'])
/** The local tools without a path: they read Hemera's own state for the session. */
const SESSION_READS = new Set(['commands_list', 'commands_output'])

export interface OrderSettings {
  readonly log: Log
  /** What `~` stands for. */
  readonly home: string
  readonly platform: NodeJS.Platform
}

/** A verdict with every reason behind it, before it is recorded. */
interface Decision {
  readonly verdict: 'allow' | 'ask' | 'deny'
  readonly by: 'rules' | 'judge' | 'grant'
  readonly reasons: ReadonlyArray<string>
  /** It asks because of a sensitive place. */
  readonly sensitive: boolean
  /** The grant that allowed it. */
  readonly grantId: string | null
  /** How it was settled: by the rules, a grant, the judge now or reused, or asked for want of one. */
  readonly settled: 'rules' | 'grant' | 'jev' | 'reused' | 'asked'
  /** The judge's rating, when one rated it. */
  readonly judged: Judged | null
  /** Why the judge failed, as a safe category, when it did. */
  readonly failure: string | null
  /** The round trip to the judge, when it was asked now. */
  readonly roundTripMs: number | null
  /** The settings section that would settle such a call (`hemera-auto`), when one would. */
  readonly settingsSection: string | null
}

const decided = (
  verdict: Decision['verdict'],
  reasons: ReadonlyArray<string>,
  by: Decision['by'] = 'rules',
): Decision => ({
  verdict,
  by,
  reasons,
  sensitive: false,
  grantId: null,
  settled: verdict === 'ask' ? 'asked' : 'rules',
  judged: null,
  failure: null,
  roundTripMs: null,
  settingsSection: null,
})

export const userName = (): string => {
  try {
    return userInfo().username
  } catch {
    return ''
  }
}

/** What the call acts on, as a decision records it: the line, or the path from the home. */
const targetOf = (call: JudgedCall, home: string): string =>
  call.command !== null
    ? `${call.command.name}: ${call.command.line}`
    : (call.line ?? (call.path === null ? '' : shownPath(call.path.resolved, home)))

export const decisionOrderLayer = (settings: OrderSettings) =>
  Layer.effect(
    Verdicts,
    Effect.gen(function* () {
      const services = yield* Effect.context<
        Database | DomainEvents | Secrets | SensitivePlaces | Judge | MissionGrants | CommitRights
      >()
      const { home, platform, log } = settings
      const context: PlaceContext = { home, user: userName(), platform }

      /** Where a path a call names leads, from the folder it runs in. */
      const place = (call: JudgedCall, folder: string, named: string) =>
        Effect.promise(() => resolvePath(call.session.place.root, folder, named, home))

      /** The sensitive place a path is, as written and as it leads, or null. */
      const sensitiveOf = (call: JudgedCall, written: string, resolved: string, writes: boolean) =>
        Effect.gen(function* () {
          const places = yield* SensitivePlaces
          const asked = { session: call.session, writes }
          return (
            (yield* places.sensitive(written, asked)) ?? (yield* places.sensitive(resolved, asked))
          )
        })

      /** Step 2: the refusals, on the effective action. Null when none refuses. */
      const refusals = (call: JudgedCall) =>
        Effect.gen(function* () {
          if (call.tool !== 'commands_run') return null
          const line = call.command?.line ?? call.line ?? ''
          const words = wordsOf(line)
          const action = effectiveAction(words, context)
          const never = yield* neverList(call.session.projectId).pipe(Effect.result)
          if (Result.isFailure(never)) {
            return decided('ask', ['the never list of the Project could not be read'])
          }
          const entry = neverMatch(
            never.success,
            action.sequences,
            call.command?.id ?? null,
            platform,
          )
          if (entry !== null) {
            const name = neverSaid(entry, (id) =>
              id === call.command?.id ? call.command.name : id,
            )
            return decided('deny', [`the Project never allows ${name}`])
          }
          if (deletesGit(words)) {
            return decided('deny', ['a deletion that touches a .git folder'])
          }
          if (call.session.missionId !== null) {
            const commits = yield* CommitRights.use((rights) =>
              rights.agentsCommit(call.session.projectId),
            )
            const refused = missionRefusal(action.sequences, commits)
            if (refused !== null) return decided('deny', [refused])
          }
          return null
        })

      /** What the Chat always asks before, read on the effective action; null otherwise. */
      const chatMustAskOf = (call: JudgedCall): string | null => {
        if (call.tool !== 'commands_run' || call.session.role !== 'chat') return null
        const line = call.command?.line ?? call.line ?? ''
        return chatMustAsk(effectiveAction(wordsOf(line), context).sequences)
      }

      /** Step 3: what the call points at, sensitive or not, and what may be lifted by a grant. */
      const places = (call: JudgedCall) =>
        Effect.gen(function* () {
          const sensitive: string[] = []
          const concerns: Concern[] = []
          const writes =
            call.tool !== 'fs_read' && call.tool !== 'fs_list' && call.tool !== 'search'
          const root = call.session.place.root
          const pointAt = (
            written: string,
            resolved: { path: string; inside: boolean; certain: boolean },
          ) =>
            Effect.gen(function* () {
              const found = yield* sensitiveOf(call, written, resolved.path, writes)
              if (found !== null) sensitive.push(found)
              if (!resolved.inside || !resolved.certain) {
                concerns.push({ kind: 'outside', place: shownPath(resolved.path, home) })
              }
            })
          if (call.path !== null) {
            const named = /^~(?:$|[\\/])/.test(call.path.named)
              ? join(home, call.path.named.slice(1))
              : call.path.named
            const written = isAbsolute(named) ? resolve(named) : resolve(root, named)
            yield* pointAt(written, {
              path: call.path.resolved,
              inside: call.path.inside,
              certain: call.path.certain,
            })
          }
          if (call.tool === 'commands_run' && call.command === null) {
            const folder = yield* place(call, root, call.folder ?? '.')
            yield* pointAt(folder.path, folder)
            const named = placesNamed(wordsOf(call.line ?? ''), context)
            if (named.unreadable !== null) {
              concerns.push({
                kind: 'outside',
                place: `words that do not read (${named.unreadable})`,
              })
            }
            for (const path of named.paths) {
              const resolved = yield* place(call, folder.path, path)
              const written = isAbsolute(path) ? resolve(path) : resolve(folder.path, path)
              yield* pointAt(written, resolved)
            }
          }
          if (call.command?.askBeforeRunning === true) {
            concerns.push({ kind: 'ask-before-running', command: call.command.name })
          }
          // An action on a shared resource asks every time, as a sensitive place does (#88).
          if (call.tool === 'commands_run' && call.command !== null) {
            for (const name of yield* changedBy(call.session.projectId, call.command.id)) {
              sensitive.push(`action on a shared resource: ${name}`)
            }
          }
          return { sensitive: [...new Set(sensitive)], concerns }
        })

      const said = (call: JudgedCall, concern: Concern): string =>
        concern.kind === 'ask-before-running'
          ? `ask before running: ${concern.command}`
          : concernSaid(concern, PLACE_NAMES[call.session.place.kind])

      /** Step 4: whether the rules allow it, all being understood. */
      const allowedLocally = (call: JudgedCall): boolean => {
        if (READS.has(call.tool) || SESSION_READS.has(call.tool)) return true
        if (call.tool !== 'commands_run') return false
        const line = call.command?.line ?? call.line ?? ''
        const [program = '', ...args] = wordsOf(line)
        const folder = call.session.place.root
        const lookup = hostLookup(folder)
        const shell =
          runsAShell(program) ||
          (invocationOf([program, ...args], platform, lookup)?.verbatim ?? false)
        if (call.command !== null) return !call.command.askBeforeRunning && !shell
        return plainListing({
          program,
          args,
          shell,
          resolved: findOnPath(program, lookup, platform),
        })
      }

      /** Steps 5 and 6: the judge, whose every failure asks. */
      const judged = (call: JudgedCall) =>
        Judge.use((judge) => judge.judge(call)).pipe(
          Effect.timeoutOption(JUDGE_LIMIT),
          Effect.map(
            Option.match({
              onNone: (): Decision => ({
                ...decided('ask', ['the judge did not answer in time']),
                failure: 'timeout',
              }),
              onSome: (answer): Decision =>
                answer.verdict === 'unavailable'
                  ? {
                      ...decided('ask', [`no judge could rate it: ${answer.reason}`]),
                      failure: answer.failure ?? null,
                      roundTripMs: answer.roundTripMs ?? null,
                      settingsSection: answer.settingsSection ?? null,
                    }
                  : {
                      ...decided(answer.verdict, [answer.reason], 'judge'),
                      settled: answer.judged?.settled ?? 'jev',
                      judged: answer.judged ?? null,
                      roundTripMs: answer.judged?.roundTripMs ?? null,
                    },
            }),
          ),
          Effect.catchCause(() =>
            Effect.succeed({ ...decided('ask', ['the judge failed']), failure: 'failed' }),
          ),
        )

      const order = (call: JudgedCall) =>
        Effect.gen(function* () {
          const refused = yield* refusals(call)
          if (refused !== null) return refused
          // The Chat always asks before a push, a forge write or a publication (#43).
          const chatAsks = chatMustAskOf(call)
          if (chatAsks !== null) return decided('ask', [chatAsks])
          const pointed = yield* places(call)
          // A sensitive place always asks, and no grant lifts it: every concern is said.
          if (pointed.sensitive.length > 0) {
            const also = pointed.concerns.map((one) => said(call, one))
            return {
              ...decided('ask', [...new Set([...also, ...pointed.sensitive])]),
              sensitive: true,
            }
          }
          const grantId = yield* MissionGrants.use((grants) => grants.allowing(call))
          if (grantId !== null) {
            return {
              ...decided('allow', [], 'grant'),
              grantId,
              settled: 'grant',
            } satisfies Decision
          }
          if (pointed.concerns.length > 0) {
            return decided('ask', [...new Set(pointed.concerns.map((one) => said(call, one)))])
          }
          if (allowedLocally(call)) return decided('allow', [])
          return yield* judged(call)
        })

      /** The decision told: one event for the Journal, one line of the diagnostic log. */
      const record = (call: JudgedCall, decision: Decision, latencyMs: number) =>
        Effect.gen(function* () {
          const secrets = yield* Secrets
          const target = secrets.mask(targetOf(call, home).slice(0, 500))
          const reasons = decision.reasons.map((reason) => secrets.mask(reason))
          const rating = decision.judged
          const owner =
            call.session.missionId === null
              ? { entityKind: 'project', entityId: call.session.projectId }
              : { entityKind: 'mission', entityId: call.session.missionId }
          const event: NewEvent = {
            type: 'permission.decided',
            ...owner,
            source: 'system',
            author: 'hemera',
            payload: {
              sessionId: call.session.sessionId,
              role: call.session.role,
              tool: call.tool,
              target,
              verdict: decision.verdict,
              by: decision.by,
              grantId: decision.grantId,
              reasons,
              policyVersion: PERMISSION_POLICY.policyVersion,
              level: PERMISSION_POLICY.level,
              judge: rating?.judge ?? null,
              model: rating?.model ?? null,
              risk: rating?.scores.risk ?? null,
              approval: rating?.scores.approval ?? null,
              userRequested: rating?.scores.userRequested ?? null,
              settled: decision.settled,
              latencyMs,
              roundTripMs: decision.roundTripMs,
              failure: decision.failure,
            },
          }
          yield* mutate('recording a permission decision', () =>
            Effect.succeed({ result: undefined, events: [event] }),
          ).pipe(
            Effect.catch((failed) =>
              Effect.sync(() => log(`permissions: a decision was not recorded: ${failed.message}`)),
            ),
          )
          const line = [
            `permissions: ${ROLE_NAMES[call.session.role]} ${call.tool} ${target.slice(0, 200)}: ${decision.verdict} by ${decision.by}${reasons.length === 0 ? '' : ` (${reasons.join('; ')})`}`,
            `[policy ${String(PERMISSION_POLICY.policyVersion)}, ${PERMISSION_POLICY.level}]`,
            ...(rating === null
              ? []
              : [
                  `judge=${rating.judge} model=${rating.model} risk=${String(rating.scores.risk)} approval=${String(rating.scores.approval)} userRequested=${String(rating.scores.userRequested)}`,
                ]),
            ...(decision.roundTripMs === null ? [] : [`jev=${String(decision.roundTripMs)}ms`]),
            ...(decision.failure === null ? [] : [`failure=${decision.failure}`]),
            `settled=${decision.settled} in ${String(latencyMs)}ms`,
          ]
          log(secrets.mask(line.join(' ')))
        })

      return {
        judge: (call) =>
          Effect.gen(function* () {
            const began = yield* Clock.currentTimeMillis
            const decision = yield* order(call).pipe(
              Effect.catchCause(() =>
                Effect.succeed(decided('ask', ['the rules could not read this call'])),
              ),
            )
            const ended = yield* Clock.currentTimeMillis
            yield* record(call, decision, Math.max(0, Math.round(ended - began)))
            const reason = decision.reasons.join('; ')
            if (decision.verdict === 'allow') {
              return { verdict: 'allow', by: decision.by } satisfies Verdict
            }
            if (decision.verdict === 'deny') {
              return { verdict: 'deny', reason, by: decision.by } satisfies Verdict
            }
            const asked = {
              verdict: 'ask',
              reason,
              by: decision.by,
              sensitive: decision.sensitive,
            } as const
            return decision.settingsSection === null
              ? (asked satisfies Verdict)
              : ({ ...asked, settingsSection: decision.settingsSection } satisfies Verdict)
          }).pipe(Effect.provide(services)),
        refusal: (call) =>
          refusals(call).pipe(
            Effect.map((decision) =>
              decision?.verdict === 'deny' ? decision.reasons.join('; ') : null,
            ),
            Effect.catchCause(() => Effect.succeed('the rules could not read this call')),
            Effect.provide(services),
          ),
      }
    }),
  )
