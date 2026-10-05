/**
 * `HemeraRunConsent`: the "ask before running" question of Hemera's own runs, implementing the
 * `AskBeforeRunning` port. A run by a rule the user recorded (a `run` step of the preparation
 * recipe, a command run at each opening, and later the checks, proofs, End and delivery steps) or
 * a service the user starts, of a catalogue command marked "ask before running", creates a
 * permission need and runs only once it is allowed.
 *
 * The need belongs to the run's mission, or to the Project for a command run at opening and every
 * run outside a mission: a Project's need offers Allow once and Deny only. A mission's need offers
 * Allow for this mission too: the grant is written with the answer, for the identity of the
 * command (CT-19: its catalogue id, its line, its program, its folder), and the next run of the
 * same command in the mission, by Hemera or by an agent of any role, is allowed by it without a
 * question. The run waits for the answer for as long as the user takes; a run stopped meanwhile
 * withdraws its need. An engine that stops leaves no run waiting (its runs end `interrupted`), so
 * the needs it left are withdrawn at the next start.
 */

import {
  type ActionIdentity,
  type Masked,
  MissionOwner,
  PERMISSION_POLICY,
  PermissionFields,
  ProjectOwner,
  actionSaid,
} from '@hemera/core/domain'
import type { Need } from '@hemera/ipc'
import { and, eq } from 'drizzle-orm'
import { Deferred, Effect, Layer, Predicate } from 'effect'

import type { Log } from '../../main/diagnostic.ts'
import {
  AskBeforeRunning,
  type PermissionAnswer,
  type PermissionAsk,
} from '../ask-before-running.ts'
import type { DomainEvents } from '../domain-events.ts'
import { type NeedHandler, createNeed, needService, withdrawNeed } from '../needs.ts'
import { Secrets } from '../secrets.ts'
import { Database, refusedWhile } from '../storage/database.ts'
import { needs, projects, workspaces } from '../storage/schema.ts'
import { mutate } from '../transaction.ts'
import { grantWritten, useGrant } from './grants.ts'
import { lineIdentity } from './identity.ts'

/** The engine service the consent needs belong to. */
export const RUN_CONSENT = needService('run-consent')

/** A run waiting for its answer, and the action a grant would be for. */
interface WaitingRun {
  readonly answered: Deferred.Deferred<PermissionAnswer>
  readonly grant: {
    readonly missionId: string
    readonly identity: ActionIdentity
    readonly action: Masked<string>
  } | null
}

/** The runs waiting for their answer, by need. */
type Waiting = Map<string, WaitingRun>

/** The answer a permission need carries, as a run takes it. */
const answerOf = (need: Need): PermissionAnswer =>
  need.answer !== null &&
  Predicate.isTagged(need.answer, 'Permission') &&
  need.answer.choice !== 'deny'
    ? 'allowed'
    : 'denied'

/** The consent of Hemera's own runs: the port's layer, and the handler its needs' answers reach. */
export const hemeraRunConsent = (log: Log) => {
  const waiting: Waiting = new Map()
  const handler: NeedHandler = {
    deliver: (need, transaction) =>
      Effect.gen(function* () {
        const run = waiting.get(need.id)
        waiting.delete(need.id)
        if (run === undefined) return []
        const forMission =
          need.answer !== null &&
          Predicate.isTagged(need.answer, 'Permission') &&
          need.answer.choice === 'allow-for-mission'
        const granted =
          forMission && run.grant !== null
            ? yield* grantWritten(transaction, {
                missionId: run.grant.missionId,
                identity: run.grant.identity,
                action: run.grant.action,
                requestId: null,
              })
            : null
        Deferred.doneUnsafe(run.answered, Effect.succeed(answerOf(need)))
        return granted?.events ?? []
      }),
  }
  const layer = Layer.effect(
    AskBeforeRunning,
    Effect.gen(function* () {
      const services = yield* Effect.context<Database | DomainEvents | Secrets>()
      /** The identity of the run's command, in the folder of its place (CT-19). */
      const identityOf = (asked: PermissionAsk) =>
        Effect.gen(function* () {
          const database = yield* Database
          const [place] =
            asked.workspaceId === null
              ? yield* database
                  .select({ folder: projects.mainCheckout })
                  .from(projects)
                  .where(eq(projects.id, asked.projectId))
                  .pipe(Effect.mapError(refusedWhile('reading the Project')))
              : yield* database
                  .select({ folder: workspaces.folder })
                  .from(workspaces)
                  .where(eq(workspaces.id, asked.workspaceId))
                  .pipe(Effect.mapError(refusedWhile('reading the Workspace')))
          if (place === undefined) return null
          return yield* Effect.promise(() =>
            lineIdentity({
              tool: 'commands_run',
              root: place.folder,
              folder: '.',
              repository: null,
              catalogue: { id: asked.commandId, line: asked.line },
              line: asked.line,
              platform: process.platform,
            }),
          )
        })
      const ask = (asked: PermissionAsk) =>
        Effect.gen(function* () {
          const missionId = asked.level === 'project' ? null : asked.missionId
          const identity = missionId === null ? null : yield* identityOf(asked)
          // A grant of the mission for the same command answers without a question.
          if (missionId !== null && identity !== null) {
            const grantId = yield* useGrant(missionId, identity)
            if (grantId !== null) {
              const secrets = yield* Secrets
              yield* mutate('recording a permission decision', () =>
                Effect.succeed({
                  result: undefined,
                  events: [
                    {
                      type: 'permission.decided',
                      entityKind: 'mission',
                      entityId: missionId,
                      source: 'system',
                      author: 'hemera',
                      payload: {
                        runId: asked.runId,
                        tool: 'commands_run',
                        target: secrets.mask(`${asked.name}: ${asked.line}`),
                        verdict: 'allow',
                        by: 'grant',
                        grantId,
                        reasons: [],
                        policyVersion: PERMISSION_POLICY.policyVersion,
                        level: PERMISSION_POLICY.level,
                      },
                    },
                  ],
                }),
              )
              return 'allowed'
            }
          }
          const owner =
            asked.level === 'project' || asked.missionId === null
              ? ProjectOwner.make({ projectId: asked.projectId })
              : MissionOwner.make({
                  projectId: asked.projectId,
                  missionId: asked.missionId,
                  taskId: null,
                })
          const answered = yield* Deferred.make<PermissionAnswer>()
          const need = yield* createNeed(
            RUN_CONSENT,
            owner,
            PermissionFields.make({
              call: `${asked.name}: ${asked.line}`,
              agentReason:
                asked.startedBy === 'user'
                  ? 'You started it.'
                  : 'Hemera runs it, by a rule you recorded.',
              hemeraReason: `ask before running: ${asked.name}`,
              sensitive: false,
            }),
          )
          waiting.set(need.id, {
            answered,
            grant:
              missionId === null || identity === null
                ? null
                : {
                    missionId,
                    identity,
                    action: (yield* Secrets).mask(actionSaid(identity, asked.name)),
                  },
          })
          return yield* Deferred.await(answered).pipe(
            Effect.onInterrupt(() =>
              Effect.andThen(
                Effect.sync(() => waiting.delete(need.id)),
                withdrawNeed(need.id, 'the run was stopped').pipe(Effect.ignore),
              ),
            ),
          )
        }).pipe(
          Effect.catch((failed) =>
            Effect.sync((): PermissionAnswer => {
              log(`${asked.name} was not run: its permission could not be asked: ${failed.message}`)
              return 'denied'
            }),
          ),
          Effect.provide(services),
        )
      return { decide: ask }
    }),
  )
  return { layer, handler }
}

/** At the start: the consent needs a stopped engine left are withdrawn, no run waits on them. */
export const withdrawLeftConsents = Effect.gen(function* () {
  const database = yield* Database
  const left = yield* database
    .select({ id: needs.id })
    .from(needs)
    .where(and(eq(needs.service, RUN_CONSENT), eq(needs.state, 'pending')))
    .pipe(Effect.mapError(refusedWhile('reading the needs')))
  for (const { id } of left) {
    yield* withdrawNeed(id, 'the run it asked for ended with the engine')
  }
})
