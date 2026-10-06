/**
 * The model cascade (#41): which agent, model and effort a role's next session gets. Three levels,
 * the most precise set one winning: the app (one setting per role), a Project (an override per
 * role), a mission (an override per role). A level that is not set has no row and inherits; a
 * default is never stored as a copy of the level above.
 *
 * The app level holds a setting for every registered role from the first start (open point 62):
 * the first agent installed in the order Claude Code, Codex, OpenCode, on its own default model
 * and effort; Claude Code when none is.
 */

import {
  AGENT_PROVIDERS,
  type AgentProvider,
  type ModelSettingValue,
  type SettingLevel,
  resolveSetting,
} from '@hemera/core/domain'
import { and, eq } from 'drizzle-orm'
import { Effect, Layer } from 'effect'

import { ModelSettingRefused } from '@hemera/ipc'

import { Discovery } from '../agents/discovery.ts'
import { getMission } from '../missions.ts'
import { getProject } from '../projects.ts'
import { Database, refusedWhile } from '../storage/database.ts'
import { missions, modelMarks, roleModels } from '../storage/schema.ts'
import { ModelChoice } from './ports.ts'
import { RoleRegistry, type SessionOwner, roleNamed } from './roles.ts'

/** The app level's scope: there is one app. */
const APP_SCOPE = ''

/** A role's setting at one level, or null when that level is not set. */
export const roleSettingAt = (level: SettingLevel, scopeId: string | null, role: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const [row] = yield* database
      .select()
      .from(roleModels)
      .where(
        and(
          eq(roleModels.level, level),
          eq(roleModels.scopeId, scopeId ?? APP_SCOPE),
          eq(roleModels.role, role),
        ),
      )
      .pipe(Effect.mapError(refusedWhile('reading a role’s model')))
    if (row === undefined) return null
    const value: ModelSettingValue = {
      agent: AGENT_PROVIDERS.find((one) => one === row.agent) ?? 'claude',
      model: row.model,
      effort: row.effort,
    }
    return value
  })

/** Sets a role's setting at one level; null unsets it, so the level inherits again. */
export const setRoleSetting = (
  level: SettingLevel,
  scopeId: string | null,
  role: string,
  value: ModelSettingValue | null,
) =>
  Effect.gen(function* () {
    const database = yield* Database
    const key = and(
      eq(roleModels.level, level),
      eq(roleModels.scopeId, scopeId ?? APP_SCOPE),
      eq(roleModels.role, role),
    )
    if (value === null) {
      yield* database
        .delete(roleModels)
        .where(key)
        .pipe(Effect.mapError(refusedWhile('unsetting a role’s model')))
      return
    }
    const written = { ...value, updatedAt: new Date().toISOString() }
    yield* database
      .insert(roleModels)
      .values({ level, scopeId: scopeId ?? APP_SCOPE, role, ...written })
      .onConflictDoUpdate({
        target: [roleModels.level, roleModels.scopeId, roleModels.role],
        set: written,
      })
      .pipe(Effect.mapError(refusedWhile('writing a role’s model')))
  })

/** The Project and the mission an owner's settings are read at. */
const scopesOf = (owner: SessionOwner) =>
  Effect.gen(function* () {
    if (owner.kind === 'project') return { projectId: owner.projectId, missionId: null }
    const database = yield* Database
    const [mission] = yield* database
      .select({ projectId: missions.projectId })
      .from(missions)
      .where(eq(missions.id, owner.missionId))
      .pipe(Effect.mapError(refusedWhile('reading the mission')))
    return { projectId: mission?.projectId ?? null, missionId: owner.missionId }
  })

/** Claude Code on its own defaults: the app's setting of a role no start has given one yet. */
const CLAUDE_DEFAULTS: ModelSettingValue = { agent: 'claude', model: null, effort: null }

/** The setting a role's next session of this owner gets, and the level it came from. */
export const resolvedSetting = (owner: SessionOwner, role: string) =>
  Effect.gen(function* () {
    const { projectId, missionId } = yield* scopesOf(owner)
    const app = (yield* roleSettingAt('app', null, role)) ?? CLAUDE_DEFAULTS
    const project = projectId === null ? null : yield* roleSettingAt('project', projectId, role)
    const mission = missionId === null ? null : yield* roleSettingAt('mission', missionId, role)
    return resolveSetting(app, project, mission)
  })

/** The runtime's `ModelChoice`, from the cascade. */
export const modelChoiceLayer = Layer.effect(
  ModelChoice,
  Effect.map(Effect.context<Database>(), (context) => ({
    of: (owner: SessionOwner, role: string) =>
      resolvedSetting(owner, role).pipe(Effect.provide(context)),
  })),
)

/**
 * Gives every registered role with no app setting the first agent installed, in the order Claude
 * Code, Codex, OpenCode, on its own defaults. Answers how many roles it gave one.
 */
export const seedAppSettings = Effect.gen(function* () {
  const roles = yield* RoleRegistry
  const found = yield* Discovery.use((discovery) => discovery.list)
  const first = AGENT_PROVIDERS.find((id) => found.some((one) => one.id === id && one.installed))
  const given = { ...CLAUDE_DEFAULTS, agent: first ?? 'claude' }
  let seeded = 0
  for (const role of roles) {
    if ((yield* roleSettingAt('app', null, role.id)) !== null) continue
    yield* setRoleSetting('app', null, role.id, given)
    seeded += 1
  }
  return seeded
})

/** Every registered role's setting at each level for a Project and a mission, and its resolution. */
export const roleModelsOf = (projectId: string | null, missionId: string | null) =>
  Effect.gen(function* () {
    if (projectId !== null) yield* getProject(projectId)
    if (missionId !== null) yield* getMission(missionId)
    const roles = yield* RoleRegistry
    return yield* Effect.forEach(roles, (role) =>
      Effect.gen(function* () {
        const app = yield* roleSettingAt('app', null, role.id)
        const project =
          projectId === null ? null : yield* roleSettingAt('project', projectId, role.id)
        const mission =
          missionId === null ? null : yield* roleSettingAt('mission', missionId, role.id)
        return {
          role: role.id,
          displayName: role.displayName,
          app,
          project,
          mission,
          resolved: resolveSetting(app ?? CLAUDE_DEFAULTS, project, mission),
        }
      }),
    )
  })

/**
 * Sets a role's setting at a level, from a screen: a registered role only; the app level always
 * holds one; a Project's or a mission's names its scope.
 */
export const setRoleModel = (
  level: SettingLevel,
  scopeId: string | null,
  role: string,
  setting: ModelSettingValue | null,
) =>
  Effect.gen(function* () {
    if (roleNamed(yield* RoleRegistry, role) === undefined) {
      return yield* new ModelSettingRefused({ reason: `no role ${role} is registered` })
    }
    if (level === 'app' && setting === null) {
      return yield* new ModelSettingRefused({
        reason: 'every role keeps a setting at the app level',
      })
    }
    if ((level === 'app') !== (scopeId === null)) {
      return yield* new ModelSettingRefused({
        reason:
          level === 'app' ? 'the app level has no scope' : `a ${level} setting names its ${level}`,
      })
    }
    yield* setRoleSetting(level, scopeId, role, setting)
  })

/** The models the user marked, every agent. */
export const modelMarksOf = Effect.gen(function* () {
  const database = yield* Database
  const rows = yield* database
    .select()
    .from(modelMarks)
    .pipe(Effect.mapError(refusedWhile('reading the marked models')))
  return rows.flatMap((row) => {
    const agent = AGENT_PROVIDERS.find((one) => one === row.agent)
    return agent === undefined ? [] : [{ ...row, agent }]
  })
})

/** Marks a model of an agent as a favourite or hidden; neither forgets it. */
export const markModel = (mark: {
  readonly agent: AgentProvider
  readonly model: string
  readonly favourite: boolean
  readonly hidden: boolean
}) =>
  Effect.gen(function* () {
    const database = yield* Database
    if (!mark.favourite && !mark.hidden) {
      yield* database
        .delete(modelMarks)
        .where(and(eq(modelMarks.agent, mark.agent), eq(modelMarks.model, mark.model)))
        .pipe(Effect.mapError(refusedWhile('forgetting a marked model')))
      return
    }
    yield* database
      .insert(modelMarks)
      .values(mark)
      .onConflictDoUpdate({
        target: [modelMarks.agent, modelMarks.model],
        set: { favourite: mark.favourite, hidden: mark.hidden },
      })
      .pipe(Effect.mapError(refusedWhile('marking a model')))
  })
