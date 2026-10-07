/**
 * What the role sessions ask of later tickets, each with the default this version runs on:
 *
 * - `ReplacementGuard`: before a session is replaced (#41 counts the technical retries of CT-14
 *   and turns a refusal into an error need);
 * - `SpecLanguage`: the Spec language of a session's owner: a mission's own Spec, a Project's
 *   setting (#85);
 * - `TesterMode`: the paragraph the tester mode adds to the base layer when it is on (#45); none.
 */

import type { AgentProvider, NeedFields, SettingLevel } from '@hemera/core/domain'
import { Context, Effect, Layer } from 'effect'

import type { DatabaseError } from '../storage/database.ts'
import type { SessionOwner } from './roles.ts'
import type { RoleSession } from './store.ts'

/** The agent, its model and its effort a role's next session gets, and the level they came from. */
export interface ModelSetting {
  readonly agent: AgentProvider
  /** Null: the agent's own default model. */
  readonly model: string | null
  /** Null: the model's own default effort, or a model that has none. */
  readonly effort: string | null
  readonly level: SettingLevel
}

/**
 * Which agent and model a role's next session gets, for an owner: the cascade (#41) implements
 * it. Read when a session opens; a change applies to the next session, never to a running one.
 */
export class ModelChoice extends Context.Service<
  ModelChoice,
  {
    readonly of: (owner: SessionOwner, role: string) => Effect.Effect<ModelSetting, DatabaseError>
  }
>()('ModelChoice') {}

export class ReplacementGuard extends Context.Service<
  ReplacementGuard,
  {
    /**
     * Whether a session may be replaced now; a refusal says why, in words, and the need its owner
     * gets, which stands for the session until the user answers it.
     */
    readonly allows: (
      session: RoleSession,
      reason: string,
    ) => Effect.Effect<
      | { readonly allowed: true }
      | { readonly allowed: false; readonly why: string; readonly need: NeedFields },
      DatabaseError
    >
  }
>()('ReplacementGuard') {}

export class SpecLanguage extends Context.Service<
  SpecLanguage,
  (owner: SessionOwner) => Effect.Effect<string>
>()('SpecLanguage') {}

export class TesterMode extends Context.Service<
  TesterMode,
  (projectId: string) => Effect.Effect<string | null>
>()('TesterMode') {}

export const noTesterMode = Layer.succeed(TesterMode, () => Effect.succeed(null))
