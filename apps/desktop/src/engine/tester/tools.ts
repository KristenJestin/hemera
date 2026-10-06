/**
 * The tester mode's two tools (#45), as the gate executes them, offered only while the mode is
 * on: `hemera_report` adds Hemera's context to the agent's report (when, this Hemera, the agent,
 * the mission or the Project, the role, the stage, and the call from the session's hidden thread),
 * then writes it as a finding or one more occurrence; `hemera_reports` lists the findings. A call
 * that comes once the mode is off is refused and writes nothing.
 */

import {
  AGENT_PROVIDERS,
  FINDINGS_PAGE,
  FINDING_KIND_TITLES,
  FINDING_SEVERITY_TITLES,
  type FindingCall,
  type ToolArguments,
  missionKey,
  shownFromHome,
} from '@hemera/core/domain'
import { homedir } from 'node:os'
import { isAbsolute, relative } from 'node:path'

import { asc, eq } from 'drizzle-orm'
import { Effect } from 'effect'

import { ADAPTERS } from '../agents/adapters/index.ts'
import { readPreferences } from '../preferences.ts'
import { getProject } from '../projects.ts'
import { Database, refusedWhile } from '../storage/database.ts'
import { agentSessions, missions, toolCalls } from '../storage/schema.ts'
import { threadOf } from '../sessions/thread.ts'
import type { Grant } from '../tools/access.ts'
import { answered, failure, refusal } from '../tools/files.ts'
import { containedIn } from '../tools/paths.ts'
import { TesterFindings } from './findings.ts'

const MODE_OFF = refusal('refused: the tester mode is off; nothing was written')

/** Now, in ISO with the time zone of this machine. */
const nowWithZone = (): string => {
  const now = new Date()
  const offset = -now.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  const hours = String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0')
  const minutes = String(Math.abs(offset) % 60).padStart(2, '0')
  const local = new Date(now.getTime() + offset * 60_000).toISOString().slice(0, 23)
  return `${local}${sign}${hours}:${minutes}`
}

/**
 * The call a report names, as the gate recorded it (the agent's own id is its call key) and the
 * session's hidden thread holds it; null when the session made no such call.
 */
const callIn = (sessionId: string, callId: string | undefined) =>
  Effect.gen(function* () {
    if (callId === undefined) return null
    const database = yield* Database
    const calls = yield* database
      .select()
      .from(toolCalls)
      .where(eq(toolCalls.sessionId, sessionId))
      .orderBy(asc(toolCalls.calledAt))
      .pipe(Effect.mapError(refusedWhile('reading the session’s calls')))
    const position = calls.findIndex((one) => one.callKey === callId)
    const recorded = calls[position]
    if (recorded === undefined) return null
    const thread = yield* threadOf(sessionId)
    const line = thread.find((one) => one.kind === 'tool' && one.text.includes(callId))
    const call: FindingCall = {
      id: callId,
      tool: recorded.tool,
      outcome: recorded.outcome,
      durationMs: recorded.durationMs,
      position: position + 1,
      line: line?.text ?? recorded.reason,
      at: recorded.calledAt,
    }
    return call
  })

/** Where a session works: its mission's key and stage, or its Project's name. */
const whereOf = (grant: Grant) =>
  Effect.gen(function* () {
    const database = yield* Database
    if (grant.missionId !== null) {
      const [mission] = yield* database
        .select({ prefix: missions.keyPrefix, number: missions.keyNumber, stage: missions.stage })
        .from(missions)
        .where(eq(missions.id, grant.missionId))
        .pipe(Effect.mapError(refusedWhile('reading the mission')))
      if (mission !== undefined) {
        return { where: missionKey(mission.prefix, mission.number), stage: mission.stage }
      }
    }
    const project = yield* getProject(grant.projectId).pipe(Effect.orElseSucceed(() => null))
    return { where: project === null ? 'a Project' : `the Project ${project.name}`, stage: null }
  })

/** The agent of a session, as the occurrence names it. */
const agentOf = (sessionId: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const [session] = yield* database
      .select({
        provider: agentSessions.provider,
        model: agentSessions.chosenModel,
        effort: agentSessions.chosenEffort,
        taken: agentSessions.takenModel,
      })
      .from(agentSessions)
      .where(eq(agentSessions.id, sessionId))
      .pipe(Effect.mapError(refusedWhile('reading the session')))
    const provider = AGENT_PROVIDERS.find((one) => one === session?.provider)
    return {
      name: provider === undefined ? (session?.provider ?? 'an agent') : ADAPTERS[provider].label,
      version: null,
      model: session?.taken ?? session?.model ?? null,
      effort: session?.effort ?? null,
    }
  })

const modeOn = Effect.map(readPreferences, (preferences) => preferences.testerMode)

/**
 * A file a report names, as a finding keeps it: relative to the session's place when it is in
 * it, from `~` under the home, as written otherwise. A finding never holds where a user lives.
 */
const shownFile = (file: string, root: string): string => {
  if (!isAbsolute(file)) return file
  if (containedIn(root, file)) return relative(root, file).replaceAll('\\', '/')
  const shown = shownFromHome(file, { home: homedir(), platform: process.platform })
  // Written the same way on every system once it no longer names the home.
  return shown.startsWith('~') ? shown.replaceAll('\\', '/') : shown
}

export const hemeraReport = (grant: Grant, args: ToolArguments<'hemera_report'>) =>
  Effect.gen(function* () {
    if (!(yield* modeOn)) return MODE_OFF
    const findings = yield* TesterFindings
    const { where, stage } = yield* whereOf(grant)
    const files = args.files.map((file) => shownFile(file, grant.place.root))
    const answer = yield* findings.report(
      { ...args, files },
      {
        at: nowWithZone(),
        hemera: findings.hemera,
        agent: yield* agentOf(grant.sessionId),
        where,
        role: grant.role,
        stage,
        sessionId: grant.sessionId,
        call: yield* callIn(grant.sessionId, args.callId),
      },
    )
    return answered(
      answer.added
        ? `Recorded as one more occurrence of #${String(answer.number)} (${String(answer.occurrences)} now): ${answer.title}. Nothing was sent anywhere.`
        : `Recorded as #${String(answer.number)}: ${answer.title}. Nothing was sent anywhere.`,
    )
  }).pipe(Effect.catch((failed) => Effect.succeed(failure(`the call failed: ${failed.message}`))))

export const hemeraReports = (args: ToolArguments<'hemera_reports'>) =>
  Effect.gen(function* () {
    if (!(yield* modeOn)) return MODE_OFF
    const all = yield* TesterFindings.use((findings) => findings.list)
    const page = args.page ?? 1
    const shown = all.slice((page - 1) * FINDINGS_PAGE, page * FINDINGS_PAGE)
    if (all.length === 0) return answered('No problem with Hemera has been reported yet.')
    if (shown.length === 0) return answered(`There is no page ${String(page)}.`)
    const more = all.length > page * FINDINGS_PAGE ? `\n\nMore: page ${String(page + 1)}.` : ''
    return answered(
      `${shown
        .map(
          ({ head }) =>
            `#${String(head.number)} · ${head.title} · ${FINDING_KIND_TITLES[head.kind]} · ${head.place} · ${FINDING_SEVERITY_TITLES[head.severity]} · ${String(head.occurrences)} occurrence(s) · last seen ${head.lastSeen}`,
        )
        .join('\n')}${more}`,
    )
  }).pipe(Effect.catch((failed) => Effect.succeed(failure(`the call failed: ${failed.message}`))))
