/**
 * The needs a session gives its owner (#41): its agent or its model unavailable when it is about
 * to start, a provider limit reached, a lineage that keeps failing (CT-14). Each is written in the
 * transaction that stops the session, with the session it stands for, so its Retry, or the answer
 * to it, starts that lineage again. A mission's session gives its mission the need; a Project's
 * session gives its Project.
 */

import {
  EnvironmentFields,
  ErrorFields,
  type NeedFields,
  MissionOwner,
  ProjectOwner,
} from '@hemera/core/domain'
import { eq } from 'drizzle-orm'
import { Effect } from 'effect'

import { ADAPTERS } from '../agents/adapters/index.ts'
import { createNeedIn, needService } from '../needs.ts'
import { Database, type EngineTransaction, refusedWhile } from '../storage/database.ts'
import { missions, sessionNeeds } from '../storage/schema.ts'
import { mutate } from '../transaction.ts'
import type { RoleSession } from './store.ts'
import { endSession } from './store.ts'

/** The sessions service owns these needs: their answers and their Retry come back to it. */
export const SESSION_NEEDS = needService('sessions')

/** What a session's need is about. */
export type SessionNeedReason = 'start' | 'failing' | 'limit'

/** The need's owner: the session's mission, or its Project. */
const needOwnerOf = (session: RoleSession) =>
  Effect.gen(function* () {
    if (session.owner.kind === 'project') {
      return ProjectOwner.make({ projectId: session.owner.projectId })
    }
    const database = yield* Database
    const missionId = session.owner.missionId
    const [mission] = yield* database
      .select({ projectId: missions.projectId })
      .from(missions)
      .where(eq(missions.id, missionId))
      .pipe(Effect.mapError(refusedWhile('reading the mission')))
    return MissionOwner.make({ projectId: mission?.projectId ?? '', missionId, taskId: null })
  })

const capitalized = (text: string): string => `${text.charAt(0).toUpperCase()}${text.slice(1)}`

/** "Claude Code on huge", or on its default model. */
const agentOn = (session: RoleSession): string =>
  `${ADAPTERS[session.provider].label} on ${session.chosen.model ?? 'its default model'}`

/** The model is refused or not offered: Models by role. */
export const modelUnavailable = (session: RoleSession, roleName: string, why: string) =>
  EnvironmentFields.make({
    missing: `${capitalized(roleName)} cannot start: ${ADAPTERS[session.provider].label} does not take the model ${session.chosen.model ?? '(its default)'}: ${why}`,
    action: `Choose another model for ${roleName} in Models by role, then Retry.`,
    settingsSection: 'models',
  })

/** The agent is not installed, not signed in, or cannot start here: Agents. */
export const agentUnavailable = (session: RoleSession, roleName: string, why: string) =>
  EnvironmentFields.make({
    missing: `${capitalized(roleName)} cannot start: ${why}`,
    action: `Install or sign in to ${ADAPTERS[session.provider].label} in Agents, or choose another agent for ${roleName}, then Retry.`,
    settingsSection: 'agents',
  })

/** A provider limit reached: what was reached, for which agent and model, in its own words. */
export const limitReached = (session: RoleSession, roleName: string, title: string) =>
  EnvironmentFields.make({
    missing: `${capitalized(roleName)} stopped at a provider limit (${agentOn(session)}): ${title}`,
    action: `Retry once the limit is lifted, or change the model for ${roleName} in Models by role.`,
    settingsSection: 'models',
  })

/** What the user answers to a lineage that keeps failing. */
export const CHANGE_THE_MODEL = 'Change the model for this role'
export const FAILING_PROPOSALS = ['Retry', CHANGE_THE_MODEL] as const

/** A lineage the user chose to move to another model: it waits for that change. */
export const modelToChange = (session: RoleSession, roleName: string) =>
  EnvironmentFields.make({
    missing: `${capitalized(roleName)} waits for another model: it kept failing on ${agentOn(session)}.`,
    action: `Choose another model for ${roleName} in Models by role; it starts again once you do, or at Retry.`,
    settingsSection: 'models',
  })

/** Three replacements in the window (CT-14): the reasons and the last lines it wrote. */
export const keepsFailing = (
  session: RoleSession,
  roleName: string,
  attempts: ReadonlyArray<{ readonly what: string; readonly output: string }>,
) =>
  ErrorFields.make({
    failed: `The agent keeps failing: ${roleName} (${agentOn(session)})`,
    attempts,
    proposals: [...FAILING_PROPOSALS],
  })

/**
 * Stops a session and gives its owner a need about it, in one transaction: its end, the need
 * (masked), and which session the need stands for, with the agent and model it was about. An
 * owner that can no longer have a need (its mission ended meanwhile) gets none: the session ends.
 */
export const stopWithNeed = (
  session: RoleSession,
  ended: { readonly state: 'ended' | 'failed'; readonly reason: string },
  need: { readonly reason: SessionNeedReason; readonly fields: NeedFields },
) =>
  Effect.gen(function* () {
    const write = yield* sessionNeedIn(session, need)
    return yield* mutate('stopping a session with a need', (transaction) =>
      Effect.gen(function* () {
        const stopped = yield* endSession(transaction, session, ended.state, ended.reason)
        const written = yield* write(transaction)
        return { result: written.id, events: [stopped, ...written.events] }
      }),
    ).pipe(
      Effect.catchTags({
        NeedRefused: () => endedAlone(session, ended),
        UnknownMission: () => endedAlone(session, ended),
        UnknownProject: () => endedAlone(session, ended),
      }),
    )
  })

/**
 * A need about a session, written in the transaction it is given: the need (masked), and which
 * session it stands for, with the agent and model it was about.
 */
export const sessionNeedIn = (
  session: RoleSession,
  need: { readonly reason: SessionNeedReason; readonly fields: NeedFields },
) =>
  Effect.gen(function* () {
    const owner = yield* needOwnerOf(session)
    const write = yield* createNeedIn(SESSION_NEEDS, owner, need.fields)
    return (transaction: EngineTransaction) =>
      Effect.gen(function* () {
        const written = yield* write(transaction)
        yield* transaction
          .insert(sessionNeeds)
          .values({
            needId: written.id,
            sessionId: session.id,
            reason: need.reason,
            agent: session.provider,
            model: session.chosen.model,
          })
          .pipe(Effect.mapError(refusedWhile('writing a session’s need')))
        return written
      })
  })

const endedAlone = (
  session: RoleSession,
  ended: { readonly state: 'ended' | 'failed'; readonly reason: string },
) =>
  mutate('ending a session', (transaction) =>
    Effect.map(endSession(transaction, session, ended.state, ended.reason), (event) => ({
      result: null,
      events: [event],
    })),
  )

/** The session a need stands for, and what it was about; null for a need of no session. */
export const sessionOfNeed = (needId: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const [row] = yield* database
      .select()
      .from(sessionNeeds)
      .where(eq(sessionNeeds.needId, needId))
      .pipe(Effect.mapError(refusedWhile('reading a session’s need')))
    return row ?? null
  })
