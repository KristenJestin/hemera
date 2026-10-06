/**
 * What the agents' runtime asks when it starts a session's agent: the session's instructions,
 * the three layers written once and kept in its thread, so every later start of its agent (an
 * idle release, a death of the process) is handed the same text. A later change of a template
 * applies to the next session.
 *
 * And the Journal's lines of a replacement and of a refusal: a launch above the cap, a counter of
 * the budget spent.
 */

import { AGENT_PROVIDERS } from '@hemera/core/domain'
import { HemeraAuthor } from '@hemera/ipc'
import { eq } from 'drizzle-orm'
import { Effect, Layer, Option, Schema } from 'effect'

import { ADAPTERS } from '../agents/adapters/index.ts'
import { SessionInstructions } from '../agents/runtime.ts'
import type { DomainEvents } from '../domain-events.ts'
import type { JournalMapper } from '../memory/index.ts'
import { readPreferences } from '../preferences.ts'
import { getProject } from '../projects.ts'
import type { Secrets } from '../secrets.ts'
import { Database, refusedWhile } from '../storage/database.ts'
import { missions } from '../storage/schema.ts'
import { filesToSend, instructionsText, placeRepositories, renderBase } from './instructions.ts'
import { SpecLanguage, TesterMode } from './ports.ts'
import { RoleRegistry, type RoleEntry, roleNamed } from './roles.ts'
import { type RoleSession, getSession } from './store.ts'
import { addToThread, instructionsKept } from './thread.ts'

/** The owner as the base layer names it, and the Project it belongs to. */
const ownerNamed = (session: RoleSession) =>
  Effect.gen(function* () {
    if (session.owner.kind === 'project') {
      const project = yield* getProject(session.owner.projectId)
      return { said: `the Project ${project.name}`, projectId: project.id }
    }
    const database = yield* Database
    const [mission] = yield* database
      .select({
        projectId: missions.projectId,
        keyPrefix: missions.keyPrefix,
        keyNumber: missions.keyNumber,
      })
      .from(missions)
      .where(eq(missions.id, session.owner.missionId))
      .pipe(Effect.mapError(refusedWhile('reading the mission')))
    return mission === undefined
      ? { said: 'a mission', projectId: null }
      : {
          said: `mission ${mission.keyPrefix}-${String(mission.keyNumber)}`,
          projectId: mission.projectId,
        }
  })

/** A role no ticket registered: the base alone, read as a role that does not read the Memory. */
const unknownRole = (id: string): RoleEntry => ({
  id,
  displayName: id,
  ownerKind: 'mission',
  placeKind: 'workspace',
  writes: false,
  readsMemory: false,
  projectLayer: false,
  mainOf: null,
  template: '',
  brief: () => Effect.succeed([]),
  countsInCap: false,
})

/** A session's three layers, written once, kept in its thread. */
const instructionsOf = (sessionId: string, platform: NodeJS.Platform) =>
  Effect.gen(function* () {
    const kept = yield* instructionsKept(sessionId)
    if (kept !== null) return kept
    const session = yield* getSession(sessionId)
    const registry = yield* RoleRegistry
    const role = roleNamed(registry, session.role) ?? unknownRole(session.role)
    const owner = yield* ownerNamed(session)
    const preferences = yield* readPreferences
    const specLanguage =
      owner.projectId === null ? 'en' : yield* (yield* SpecLanguage)(owner.projectId)
    const testerMode = owner.projectId === null ? null : yield* (yield* TesterMode)(owner.projectId)
    const base = renderBase({
      owner: owner.said,
      role: role.displayName,
      userLanguage: preferences.userLanguage,
      specLanguage,
      readsMemory: role.readsMemory,
      testerMode,
    })
    const provider = AGENT_PROVIDERS.find((one) => one === session.provider) ?? 'claude'
    const files =
      role.projectLayer && owner.projectId !== null
        ? filesToSend(
            ADAPTERS[provider],
            platform,
            yield* placeRepositories(owner.projectId, session.folder).pipe(
              Effect.orElseSucceed(() => []),
            ),
          )
        : []
    const text = instructionsText(base, role, files)
    yield* addToThread(sessionId, 'instructions', text)
    return text
  })

/** The runtime's `SessionInstructions`, from the role registry and the session's place. */
export const sessionInstructionsLayer = (platform: NodeJS.Platform = process.platform) =>
  Layer.effect(
    SessionInstructions,
    Effect.gen(function* () {
      const context = yield* Effect.context<
        Database | DomainEvents | Secrets | RoleRegistry | SpecLanguage | TesterMode
      >()
      return {
        of: (sessionId) =>
          instructionsOf(sessionId, platform).pipe(
            Effect.provide(context),
            // Instructions that cannot be read are never invented: the base alone, said plainly.
            Effect.catchCause(() =>
              Effect.succeed(
                renderBase({
                  owner: 'a mission',
                  role: 'this session’s role',
                  userLanguage: 'en',
                  specLanguage: 'en',
                  readsMemory: false,
                  testerMode: null,
                }),
              ),
            ),
          ),
      }
    }),
  )

const ReplacedPayload = Schema.Struct({
  missionId: Schema.String,
  lineage: Schema.String,
  roleName: Schema.String,
  reason: Schema.String,
})
const readReplaced = Schema.decodeUnknownOption(ReplacedPayload)

/** "The Builder's session was replaced: no activity for 5 minutes", about its lineage. */
export const replacedLine: JournalMapper = (event) =>
  Effect.succeed(
    Option.match(readReplaced(event.payload), {
      onNone: () => null,
      onSome: (payload) => ({
        missionId: payload.missionId,
        kind: 'session',
        author: HemeraAuthor.make({}),
        text: `${payload.roleName.charAt(0).toUpperCase()}${payload.roleName.slice(1)}’s session was replaced: ${payload.reason}`,
        refs: { session: payload.lineage },
      }),
    }),
  )

const RefusedPayload = Schema.Struct({
  missionId: Schema.String,
  what: Schema.optionalKey(Schema.String),
  counter: Schema.optionalKey(Schema.String),
  sentence: Schema.String,
})
const readRefused = Schema.decodeUnknownOption(RefusedPayload)

/** What a refused call was, as the Journal says it. */
const refusedWhat = (payload: typeof RefusedPayload.Type): string => {
  if (payload.what !== undefined) return payload.what
  if (payload.counter === 'attempts') return 'An attempt was refused'
  return payload.counter === 'rounds' ? 'A round was refused' : 'A launch was refused'
}

/** "A launch of a helper was refused: 3 sub-agents already run in this Project (the cap is 3)…" */
export const refusedLine: JournalMapper = (event) =>
  Effect.succeed(
    Option.match(readRefused(event.payload), {
      onNone: () => null,
      onSome: (payload) => ({
        missionId: payload.missionId,
        kind: 'budget',
        author: HemeraAuthor.make({}),
        text: `${refusedWhat(payload)}: ${payload.sentence}`,
        refs: {},
      }),
    }),
  )
