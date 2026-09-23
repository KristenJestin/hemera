/**
 * The Context view of a Session, as the window reads it (design D6-10).
 *
 * Three lists and nothing more. What was provided — the base, `AGENTS.md` as the agent read it,
 * and every delivery since — with how each reached the agent; what the agent may consult — the
 * tools its Session is offered, each with the limit it is held to, and the Project's catalogue;
 * and what stays the agent's own, which is one sentence its adapter declares (D6-09). Nothing
 * here says what the model retained: Hemera knows what it handed over, not what was kept.
 */

import { offeredTools } from '@hemera/core'
import type { ContextView } from '@hemera/ipc'
import { Effect } from 'effect'

import { bareModeOf } from '../agents/bare.ts'
import { ADAPTERS } from '../agents/discovery.ts'
import { Commands } from '../commands/service.ts'
import { Sessions } from '../sessions.ts'
import { TOOL_BOUNDS } from '../tools/arguments.ts'
import { Context } from './service.ts'

/** The three lists of one Session's Context view. */
export const contextOf = (sessionId: string) =>
  Effect.gen(function* () {
    const sessions = yield* Sessions
    const context = yield* Context
    const commands = yield* Commands
    const { session } = yield* sessions.one(sessionId)
    const provided = yield* context.provided(sessionId)
    const catalogue = yield* commands.list(session.projectId)
    // Sessions have no mission yet, so every one is offered the whole set (D6-03); the list is
    // read through the same function the guard asks, so the view shows what the guard admits.
    const tools = offeredTools('free').map((name) => ({ name, bound: TOOL_BOUNDS[name] }))
    const agent = session.provider === null ? null : ADAPTERS[session.provider]
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
      private:
        agent === null
          ? []
          : [
              {
                agent: agent.label,
                sentence: bareModeOf(agent, globalThis.process.platform).private,
              },
            ],
    }
    return view
  })
