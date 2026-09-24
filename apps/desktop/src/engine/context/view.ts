/**
 * The Context view of a Session, as the window reads it (design D6-10).
 *
 * Two lists and nothing more. What was provided — the base, `AGENTS.md` as the agent read it,
 * and every delivery since — with how each reached the agent; and what the agent may consult —
 * the tools its Session is offered, each with the limit it is held to, and the Project's
 * catalogue. Nothing here says what the model retained: Hemera knows what it handed over, not
 * what was kept.
 */

import { offeredTools } from '@hemera/core'
import type { ContextView } from '@hemera/ipc'
import { Effect } from 'effect'

import { Commands } from '../commands/service.ts'
import { Sessions } from '../sessions.ts'
import { TOOL_BOUNDS } from '../tools/arguments.ts'
import { Context } from './service.ts'

/** The Context view of one Session. */
export const contextOf = (sessionId: string) =>
  Effect.gen(function* () {
    const sessions = yield* Sessions
    const context = yield* Context
    const commands = yield* Commands
    const { session } = yield* sessions.one(sessionId)
    const provided = yield* context.provided(sessionId)
    const catalogue = yield* commands.list(session.projectId)
    // The set of the Session's mission (D6-03, D7-14), read through the same function the grant
    // of its agent is, so the view shows what the guard admits.
    const tools = offeredTools(session.mission).map((name) => ({ name, bound: TOOL_BOUNDS[name] }))
    const view: ContextView = {
      provided: provided.map((one) => ({
        kind: one.kind,
        path: one.path,
        fingerprint: one.fingerprint,
        deliveredAt: one.deliveredAt,
        reached: one.reached,
      })),
      tools,
      commands: catalogue.map((one) => ({ name: one.name, line: one.line })),
    }
    return view
  })
