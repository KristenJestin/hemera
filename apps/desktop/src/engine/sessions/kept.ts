/**
 * The agents a start kept (#320): a left-over agent process of a mission's session that the start
 * could not end, because what it runs could not be read in time or its kill did not end it. It
 * then runs beside its fresh successor until the next start tries again; the mission says so, with
 * its program and pid, for as long as it is alive.
 */

import type { KeptAgent } from '@hemera/ipc'
import { and, eq, inArray } from 'drizzle-orm'
import { Effect, Stream } from 'effect'
import { basename, extname } from 'node:path'

import { Database, refusedWhile } from '../storage/database.ts'
import { agentSessions } from '../storage/schema.ts'
import { ProcessSupervisor, type RegisteredRoot } from '../supervisor.ts'

/** Of the kept roots, those of a session of the mission, as the mission shows them. */
const ofMission = (missionId: string, roots: ReadonlyArray<RegisteredRoot>) =>
  Effect.gen(function* () {
    const ofSessions = roots.filter((root) => root.owner.kind === 'session')
    if (ofSessions.length === 0) return []
    const database = yield* Database
    const rows = yield* database
      .select({ id: agentSessions.id })
      .from(agentSessions)
      .where(
        and(
          inArray(
            agentSessions.id,
            ofSessions.map((root) => root.owner.id),
          ),
          eq(agentSessions.ownerKind, 'mission'),
          eq(agentSessions.ownerId, missionId),
        ),
      )
      .pipe(Effect.mapError(refusedWhile('reading the sessions')))
    const sessions = new Set(rows.map((row) => row.id))
    return ofSessions
      .filter((root) => sessions.has(root.owner.id))
      .map((root): KeptAgent => ({
        program: basename(root.program, extname(root.program)),
        pid: root.pid,
      }))
  })

/** The mission's kept agents now. */
export const keptAgents = (missionId: string) =>
  Effect.flatMap(
    ProcessSupervisor.use((supervisor) => supervisor.kept),
    (roots) => ofMission(missionId, roots),
  )

/** The mission's kept agents now, then again at each change of the kept ones. */
export const keptAgentChanges = (missionId: string) =>
  Stream.unwrap(
    ProcessSupervisor.useSync((supervisor) =>
      supervisor.keptChanges.pipe(Stream.mapEffect((roots) => ofMission(missionId, roots))),
    ),
  )
