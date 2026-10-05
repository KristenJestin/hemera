/**
 * The agents' sessions as Hemera keeps them, and the rule that the chosen model survives every
 * restart.
 *
 * A session is recorded with its agent, its owner and role, its folder, the agent's own session
 * id once it has one, and the options Hemera chose (model, effort, mode). Every choice goes
 * through `session/set_config_option` and is written down with what the agent then reports it
 * took. When an agent's process is started again (after a death, an idle release or a restart of
 * Hemera), the stored choices are applied again in this order: model, then effort, then mode. A
 * model the agent refuses or no longer offers is `ModelUnavailable`, naming it: never another
 * model in its place.
 */

import { AGENT_PROVIDERS, type AgentProvider } from '@hemera/core/domain'
import { eq } from 'drizzle-orm'
import { Effect, Schema } from 'effect'

import { Database, refusedWhile } from '../storage/database.ts'
import { agentSessions } from '../storage/schema.ts'
import { mutate } from '../transaction.ts'
import { type AgentOption, type AgentSession, ModelUnavailable } from './client.ts'

/** The options Hemera chooses for a session, in the order a restart applies them. */
export const CHOICES = ['model', 'effort', 'mode'] as const
export type Choice = (typeof CHOICES)[number]

/** How each agent tells which of its options is which: the category ACP gives it. */
const CATEGORY: Record<Choice, string> = { model: 'model', effort: 'thought_level', mode: 'mode' }

export interface Chosen {
  readonly model: string | null
  readonly effort: string | null
  readonly mode: string | null
}

export interface AgentSessionRecord {
  readonly id: string
  readonly provider: AgentProvider
  readonly ownerKind: 'mission' | 'project'
  readonly ownerId: string
  readonly role: string
  readonly folder: string
  /** The agent's own session id, once it has given one: what is resumed or loaded. */
  readonly nativeId: string | null
  readonly chosen: Chosen
  /** What the agent reported it took the last time the choices were applied. */
  readonly taken: Chosen
}

export class UnknownAgentSession extends Schema.TaggedError<UnknownAgentSession>()(
  'UnknownAgentSession',
  { id: Schema.String },
) {
  override get message(): string {
    return 'This agent’s session no longer exists.'
  }
}

type Row = typeof agentSessions.$inferSelect

const recordOf = (row: Row): AgentSessionRecord => ({
  id: row.id,
  provider: AGENT_PROVIDERS.find((one) => one === row.provider) ?? 'claude',
  ownerKind: row.ownerKind === 'project' ? 'project' : 'mission',
  ownerId: row.ownerId,
  role: row.role,
  folder: row.folder,
  nativeId: row.nativeId,
  chosen: { model: row.chosenModel, effort: row.chosenEffort, mode: row.chosenMode },
  taken: { model: row.takenModel, effort: row.takenEffort, mode: row.takenMode },
})

const now = (): string => new Date().toISOString()

const sessionEvent = (type: string, id: string, payload: Record<string, string | null>) => ({
  type,
  entityKind: 'agent_session',
  entityId: id,
  source: 'system' as const,
  author: 'hemera' as const,
  payload,
})

/** A new session of an agent, for its owner and role, in its folder. */
export const openAgentSession = (asked: {
  readonly provider: AgentProvider
  readonly ownerKind: 'mission' | 'project'
  readonly ownerId: string
  readonly role: string
  readonly folder: string
}) =>
  Effect.gen(function* () {
    // A UUID: the session's trace file is named after it, so it must be safe as a file name.
    const id = crypto.randomUUID()
    const at = now()
    yield* mutate('opening an agent’s session', (transaction) =>
      transaction
        .insert(agentSessions)
        .values({ id, ...asked, createdAt: at, updatedAt: at })
        .pipe(
          Effect.mapError(refusedWhile('opening an agent’s session')),
          Effect.as({
            result: undefined,
            events: [
              sessionEvent('agent_session.opened', id, {
                provider: asked.provider,
                ownerKind: asked.ownerKind,
                ownerId: asked.ownerId,
                role: asked.role,
              }),
            ],
          }),
        ),
    )
    return yield* getAgentSession(id).pipe(Effect.catchTag('UnknownAgentSession', Effect.die))
  })

export const getAgentSession = (id: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const [row] = yield* database
      .select()
      .from(agentSessions)
      .where(eq(agentSessions.id, id))
      .pipe(Effect.mapError(refusedWhile('reading an agent’s session')))
    if (row === undefined) return yield* new UnknownAgentSession({ id })
    return recordOf(row)
  })

/** Writes columns of a session, with the event that tells it. */
const write = (
  id: string,
  doing: string,
  change: Partial<Omit<Row, 'id' | 'createdAt'>>,
  event: ReturnType<typeof sessionEvent> | null,
) =>
  mutate(doing, (transaction) =>
    transaction
      .update(agentSessions)
      .set({ ...change, updatedAt: now() })
      .where(eq(agentSessions.id, id))
      .pipe(
        Effect.mapError(refusedWhile(doing)),
        Effect.as({ result: undefined, events: event === null ? [] : [event] }),
      ),
  )

/** The agent's own session id, once it gave one. */
export const recordNativeSession = (id: string, nativeId: string) =>
  write(id, 'recording an agent’s session id', { nativeId }, null)

/** The option of a session that is the one choice names, if the agent offers one. */
const optionFor = (options: ReadonlyArray<AgentOption>, choice: Choice): AgentOption | undefined =>
  options.find((option) => option.category === CATEGORY[choice])

/** What the agent says it is on now, for each choice. */
const takenOf = (options: ReadonlyArray<AgentOption>): Chosen => ({
  model: optionFor(options, 'model')?.value ?? null,
  effort: optionFor(options, 'effort')?.value ?? null,
  mode: optionFor(options, 'mode')?.value ?? null,
})

const takenColumns = (taken: Chosen) => ({
  takenModel: taken.model,
  takenEffort: taken.effort,
  takenMode: taken.mode,
})

const chosenColumn = {
  model: 'chosenModel',
  effort: 'chosenEffort',
  mode: 'chosenMode',
} as const satisfies Record<Choice, keyof Row>

/** Puts one choice on the agent's session; a model it does not offer is said by name. */
const apply = (session: AgentSession, choice: Choice, value: string) =>
  Effect.gen(function* () {
    const option = optionFor(session.options(), choice)
    if (option === undefined) {
      if (choice === 'model') {
        return yield* new ModelUnavailable({ model: value, reason: 'the agent offers no model' })
      }
      return
    }
    yield* session.setOption(option.id, value)
  })

/** The user (or a role's default) chose an option: it is put on the agent and written down. */
export const chooseOption = (id: string, session: AgentSession, choice: Choice, value: string) =>
  Effect.gen(function* () {
    yield* apply(session, choice, value)
    yield* write(
      id,
      'recording an agent’s option',
      { [chosenColumn[choice]]: value, ...takenColumns(takenOf(session.options())) },
      sessionEvent('agent_session.option_chosen', id, { option: choice, value }),
    )
  })

/**
 * After a restart of the agent's process: the stored choices applied again, model then effort
 * then mode, and what the agent took written down.
 */
export const reapplyChoices = (id: string, session: AgentSession) =>
  Effect.gen(function* () {
    const { chosen } = yield* getAgentSession(id)
    for (const choice of CHOICES) {
      const value = chosen[choice]
      if (value !== null) yield* apply(session, choice, value)
    }
    yield* write(id, 'recording what an agent took', takenColumns(takenOf(session.options())), null)
  })
