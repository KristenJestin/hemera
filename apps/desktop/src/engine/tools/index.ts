/**
 * Hemera's tools as the engine holds them: the MCP server, the single gate behind it, the grants
 * of the sessions, and the `HemeraEndpoint` agents are started with.
 *
 * Minting a session's token reads the session as it was opened (its role, its owner, its folder)
 * and grants the role's tools on the role's place, rooted at the session's folder. The ports the
 * gate calls (the verdict, the human question, the sensitive places, the guards) are parts later
 * tickets fill; their defaults never allow what they cannot judge.
 */

import { homedir } from 'node:os'
import { resolve } from 'node:path'

import { ROLE_PLACES, Role, toolsOf } from '@hemera/core/domain'
import { and, eq } from 'drizzle-orm'
import { Effect, Layer, Option, Schema } from 'effect'

import type { Log } from '../../main/diagnostic.ts'
import { HemeraEndpoint } from '../agents/endpoint.ts'
import { getAgentSession } from '../agents/sessions.ts'
import { getProject } from '../projects.ts'
import { Database, refusedWhile } from '../storage/database.ts'
import { missions, workspaces } from '../storage/schema.ts'
import { ToolAccess, toolAccessLayer } from './access.ts'
import { effectfulActionsLayer } from './actions.ts'
import { ToolGate, toolGateLayer } from './gate.ts'
import { type Delivery, queuedDelivery } from '../permissions/delivery.ts'
import { missionGrantsLayer } from '../permissions/grants.ts'
import {
  HemeraAuto,
  type HumanIntent,
  hemeraAutoLayer,
  humanIntentLayer,
  jevJudgeLayer,
} from '../permissions/hemera-auto.ts'
import { JevTransport, jevTransport } from '../permissions/jev.ts'
import { decisionOrderLayer } from '../permissions/order.ts'
import {
  type CommitRights,
  type Judge,
  type MissionGrants,
  missionPlacesLayer,
  noAgentCommits,
} from '../permissions/ports.ts'
import {
  type TaskStates,
  approvalsLayer,
  everyTaskHolds,
  permissionRequestsLayer,
} from '../permissions/requests.ts'
import { sensitivePlacesLayer } from '../permissions/sensitive.ts'
import {
  type GateGuards,
  type PermissionRequests,
  type SensitivePlaces,
  type Verdicts,
  noGateGuards,
} from './ports.ts'
import { ToolServer, toolServerLayer } from './server.ts'

export { HemeraAuto, ToolAccess, ToolGate, ToolServer }

/** What later tickets plug into the gate; the defaults otherwise. */
export interface ToolsParts {
  readonly verdicts?: Layer.Layer<Verdicts>
  readonly permissionRequests?: Layer.Layer<PermissionRequests>
  readonly sensitivePlaces?: Layer.Layer<SensitivePlaces>
  readonly guards?: Layer.Layer<GateGuards>
  /** Step 5 of the order of decision: Jev, through Hemera Auto, otherwise. */
  readonly judge?: Layer.Layer<Judge>
  /** How Jev is reached; the pinned endpoint otherwise. Suites hand a fake Jev. */
  readonly jevTransport?: Layer.Layer<JevTransport>
  /** What the user said that Jev is told; the user's answers in the database otherwise. */
  readonly humanIntent?: Layer.Layer<HumanIntent>
  /** The grants of "Allow for this mission"; the mission's stored grants otherwise. */
  readonly grants?: Layer.Layer<MissionGrants>
  /** Where the result of an answered request goes (#40); queued for its owner otherwise. */
  readonly delivery?: Layer.Layer<Delivery>
  /** Whether a request's task still holds (later tickets); every task does otherwise. */
  readonly taskStates?: Layer.Layer<TaskStates>
  /** The Project's "who commits" rule (B4, R5). */
  readonly commitRights?: Layer.Layer<CommitRights>
  /** What `~` stands for; the user's home folder otherwise. */
  readonly home?: string
}

const readRole = Schema.decodeUnknownOption(Role)

/** The grant a session's agent is handed: its role's tools, on its role's place. */
const grantOf = (sessionId: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const session = yield* getAgentSession(sessionId)
    const role = readRole(session.role)
    const missionId = session.ownerKind === 'mission' ? session.ownerId : null
    const projectId =
      missionId === null
        ? session.ownerId
        : ((yield* database
            .select({ projectId: missions.projectId })
            .from(missions)
            .where(eq(missions.id, missionId))
            .pipe(Effect.mapError(refusedWhile('reading the mission'))))[0]?.projectId ?? '')
    const project = yield* getProject(projectId)
    const folder = resolve(session.folder)
    const [workspace] = yield* database
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(and(eq(workspaces.projectId, projectId), eq(workspaces.folder, session.folder)))
      .pipe(Effect.mapError(refusedWhile('reading the Workspaces')))
    return Option.match(role, {
      // A role this version does not know is handed no tool rather than guessed at.
      onNone: () => ({ role: null, sessionId, projectId, missionId, folder }),
      onSome: (known) => ({
        role: known,
        grant: {
          sessionId,
          role: known,
          tools: toolsOf(known),
          place: { ...ROLE_PLACES[known], root: folder },
          projectId,
          missionId,
          workspaceId: workspace?.id ?? null,
          mainCheckout: resolve(project.mainCheckout) === folder,
        },
      }),
    })
  })

/** The endpoint agents are started with: the server's address, and a token per session. */
export const hemeraEndpointLayer = (log: Log) =>
  Layer.effect(
    HemeraEndpoint,
    Effect.gen(function* () {
      const server = yield* ToolServer
      const access = yield* ToolAccess
      const context = yield* Effect.context<Database>()
      return {
        url: Effect.succeed(server.url),
        mint: (sessionId) =>
          Effect.gen(function* () {
            const found = yield* grantOf(sessionId).pipe(Effect.provide(context), Effect.orDie)
            if (!('grant' in found)) {
              log(`tools: session ${sessionId} has a role this version does not know: no tool`)
              return yield* access.mint({
                sessionId,
                role: 'cold-read',
                tools: [],
                place: { kind: 'main-checkout', readOnly: true, root: found.folder },
                projectId: found.projectId,
                missionId: found.missionId,
                workspaceId: null,
                mainCheckout: false,
              })
            }
            return yield* access.mint(found.grant)
          }),
        revoke: (sessionId) => access.revoke(sessionId),
      }
    }),
  )

/** The tools of the engine: the endpoint, over the server, over the gate and its ports. */
export const toolsLayer = (log: Log, version: string, parts: ToolsParts = {}) => {
  const home = parts.home ?? homedir()
  const platform = process.platform
  return hemeraEndpointLayer(log).pipe(
    Layer.provideMerge(
      Layer.merge(toolServerLayer(log, version), approvalsLayer({ log, home, platform })),
    ),
    Layer.provideMerge(toolGateLayer({ log, home: parts.home })),
    Layer.provideMerge(
      Layer.mergeAll(
        toolAccessLayer(log),
        parts.verdicts ?? decisionOrderLayer({ log, home, platform }),
        parts.permissionRequests ?? permissionRequestsLayer({ log, home, platform }),
        parts.guards ?? noGateGuards,
        effectfulActionsLayer,
        parts.delivery ?? queuedDelivery,
        parts.taskStates ?? everyTaskHolds,
      ),
    ),
    Layer.provideMerge(
      Layer.mergeAll(
        parts.sensitivePlaces ??
          sensitivePlacesLayer({ home, platform }).pipe(Layer.provide(missionPlacesLayer)),
        parts.judge ?? jevJudgeLayer({ log, home, platform }),
        parts.grants ?? missionGrantsLayer({ log, platform }),
        parts.commitRights ?? noAgentCommits,
      ),
    ),
    Layer.provideMerge(
      Layer.mergeAll(
        hemeraAutoLayer(log),
        parts.humanIntent ?? humanIntentLayer,
        parts.jevTransport ?? Layer.succeed(JevTransport, jevTransport),
      ),
    ),
  )
}
