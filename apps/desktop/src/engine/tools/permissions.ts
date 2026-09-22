/**
 * What a tool asks the human before it acts outside the Workspace root (design D5-09, D6-05).
 *
 * The root is a promise to the user, not to the agent: an agent that reads and writes wherever
 * it likes is an agent the user cannot reason about. A path outside the root is therefore not
 * refused — it is asked about, once per call, and a refusal ends the call the way any refusal
 * does.
 *
 * The question is a port because it is a question: who is asked, and how it is put, is the
 * window's business, and what this service promises the engine is only that the answer arrives.
 * An engine with no window to ask — a test, a headless run — answers with the layer it is given
 * rather than with a default that would quietly let a tool through.
 */

import { Context, Deferred, Effect, Layer } from 'effect'

import { AgentNotices } from '../agents/notices.ts'

/** What the human is asked, as the Session's thread shows it. */
export interface OutsideRequest {
  /** The identifier this question is asked under, which is what the answer comes back with. */
  readonly id: string
  readonly sessionId: string
  readonly tool: string
  /** Where the tool would act, resolved: the place the human decides on, not the agent's text. */
  readonly named: string
  /** The root it is outside of. */
  readonly root: string
}

/** What the human said, and what an unanswered question never is. */
export type OutsideAnswer = 'allowed' | 'refused'

export interface ToolPermissionsService {
  /** Waits for the human, for as long as they take. */
  readonly askOutside: (asked: OutsideRequest) => Effect.Effect<OutsideAnswer>
  /** Answers a question that is waiting, and answers false for one nothing is waiting on. */
  readonly answer: (id: string, answer: OutsideAnswer) => Effect.Effect<boolean>
  /**
   * The question this Session is blocked on, and null when it is blocked on none.
   *
   * The window answers a Session and not a question: what the block it draws knows is the thread
   * it is in, and the identifier of what is waiting is this service's to say.
   */
  readonly waiting: (sessionId: string) => Effect.Effect<string | null>
}

export class ToolPermissions extends Context.Service<ToolPermissions, ToolPermissionsService>()(
  'ToolPermissions',
) {}

/** One question the human has not answered yet. */
interface Question {
  readonly sessionId: string
  readonly answer: Deferred.Deferred<OutsideAnswer>
}

/**
 * The questions of this engine run, held in memory until they are answered.
 *
 * A question is a `Deferred` the tool call blocks on, which is what makes it answerable by
 * something other than the caller: the window answers it, and a Stop answers it too, because a
 * call blocked on a question nobody will ever answer is a call blocked for ever.
 *
 * Nothing is remembered between two questions. The same tool asking again about the same path
 * asks again, because an answer is about the call it was given for and not about the tool (D6-05).
 */
export const toolPermissionsLayer: Layer.Layer<ToolPermissions, never, AgentNotices> = Layer.effect(
  ToolPermissions,
  Effect.gen(function* () {
    const notices = yield* AgentNotices
    const questions = new Map<string, Question>()

    return {
      askOutside: (asked) =>
        Effect.gen(function* () {
          const answer = yield* Deferred.make<OutsideAnswer>()
          questions.set(asked.id, { sessionId: asked.sessionId, answer })
          // The window is told the way it is told about the agent's own questions: the block is
          // already in the thread, and this is what makes it appear without asking again.
          notices.changed(asked.sessionId, 'permission_requested')
          return yield* Deferred.await(answer).pipe(
            Effect.ensuring(
              Effect.sync(() => {
                questions.delete(asked.id)
              }),
            ),
          )
        }),

      answer: (id, answer) =>
        Effect.gen(function* () {
          const held = questions.get(id)
          if (held === undefined) return false
          questions.delete(id)
          yield* Deferred.succeed(held.answer, answer)
          return true
        }),

      waiting: (sessionId) =>
        Effect.sync(() => {
          for (const [id, held] of questions) {
            if (held.sessionId === sessionId) return id
          }
          return null
        }),
    } satisfies ToolPermissionsService
  }),
)
