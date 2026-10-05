/**
 * The permissions of a Project, as they cross the links: its "never" list, the commands that are
 * always refused to its agents, read and replaced whole (a change applies to the next call, in
 * every mission); the "Allow for this mission" grants of a mission, listed and revoked (a
 * revocation applies from the next call); and Hemera Auto: its consent, who judges, the decisions
 * as they are made, and its key, which only main ever handles in clear.
 */

import { AgentProvider, JUDGES, NeverEntry } from '@hemera/core/domain'
import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'

import { UnknownCommand } from './commands.ts'
import { UnknownMission } from './missions.ts'
import { EngineGone } from './gone.ts'
import { StorageFailed } from './profile.ts'
import { UnknownProject } from './projects.ts'

const failing = <const Errors extends ReadonlyArray<Schema.Top>>(...errors: Errors) =>
  Schema.Union(errors)

/** A Project's "never" list, replaced whole. */
export const NeverListEdit = Schema.Struct({
  projectId: Schema.String,
  entries: Schema.Array(NeverEntry),
})

/**
 * An "Allow for this mission" grant: the action in words, who gave it and when, how many calls it
 * allowed, and whether it still holds (`revoked` by the user, `fallen` when its identity moved,
 * with the reason).
 */
export const MissionGrant = Schema.Struct({
  id: Schema.String,
  missionId: Schema.String,
  action: Schema.String,
  givenBy: Schema.String,
  givenAt: Schema.String,
  uses: Schema.Number,
  state: Schema.Literals(['live', 'revoked', 'fallen']),
  reason: Schema.NullOr(Schema.String),
})
export type MissionGrant = typeof MissionGrant.Type

/**
 * One decision on a call, as the Journal records it: who decided (the local rules, a grant, the
 * judge, the user) and why, the policy and its level, and for a judged call the judge, its model
 * and its scores; how it was settled and how long it took. Masked; never a raw payload.
 */
export const PermissionDecision = Schema.Struct({
  sequence: Schema.Number,
  occurredAt: Schema.String,
  ownerKind: Schema.String,
  ownerId: Schema.String,
  tool: Schema.String,
  target: Schema.String,
  verdict: Schema.Literals(['allow', 'ask', 'deny']),
  by: Schema.String,
  sessionId: Schema.optionalKey(Schema.String),
  role: Schema.optionalKey(Schema.String),
  reasons: Schema.optionalKey(Schema.Array(Schema.String)),
  choice: Schema.optionalKey(Schema.String),
  judge: Schema.optionalKey(Schema.NullOr(Schema.String)),
  model: Schema.optionalKey(Schema.NullOr(Schema.String)),
  risk: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  approval: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  userRequested: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  /** How it was settled: `rules`, `grant`, `jev`, `reused`, or `asked`. */
  settled: Schema.optionalKey(Schema.String),
  latencyMs: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  roundTripMs: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  /** Why the judge failed, as a safe category, when it did. */
  failure: Schema.optionalKey(Schema.NullOr(Schema.String)),
  policyVersion: Schema.Number,
  level: Schema.String,
})
export type PermissionDecision = typeof PermissionDecision.Type

/** Who judges what the local rules leave open: "Jev", or "Hemera asks". */
export const WhoJudges = Schema.Literals(JUDGES)

/**
 * Where the Jev key stands: none saved; saved and usable; `invalid` (a ciphertext this system
 * cannot decrypt, or a key Jev rejected); or the system offers no protected storage, so nothing
 * is stored.
 */
export const JevKeyStatus = Schema.Literals(['missing', 'saved', 'invalid', 'storage-unavailable'])
export type JevKeyStatus = typeof JevKeyStatus.Type

/** Hemera Auto as the settings show it: the key, the consent, who judges, and what is missing. */
export const HemeraAutoStatus = Schema.Struct({
  key: JevKeyStatus,
  consent: Schema.Boolean,
  judge: WhoJudges,
  /** What the system lacks to protect a key ("No Secret Service is running…"), or null. */
  missing: Schema.NullOr(Schema.String),
})
export type HemeraAutoStatus = typeof HemeraAutoStatus.Type

/** Where the key stands in the engine; main adds whether the system can protect it. */
export const JevKeyState = Schema.Struct({
  stored: Schema.Boolean,
  held: Schema.Boolean,
  refused: Schema.Boolean,
  consent: Schema.Boolean,
})
export type JevKeyState = typeof JevKeyState.Type

export const PermissionsRpcs = RpcGroup.make(
  Rpc.make('permissions.neverList', {
    payload: { projectId: Schema.String },
    success: Schema.Array(NeverEntry),
    error: failing(StorageFailed, EngineGone, UnknownProject),
  }),
  Rpc.make('permissions.setNeverList', {
    payload: NeverListEdit,
    success: Schema.Array(NeverEntry),
    error: failing(StorageFailed, EngineGone, UnknownProject, UnknownCommand),
  }),
  Rpc.make('permissions.grants', {
    payload: { missionId: Schema.String },
    success: Schema.Array(MissionGrant),
    error: failing(StorageFailed, EngineGone, UnknownMission),
  }),
  /** Revokes a grant from the next call; one that no longer holds is left as it is. */
  Rpc.make('permissions.revoke', {
    payload: { grantId: Schema.String },
    success: Schema.Void,
    error: failing(StorageFailed, EngineGone),
  }),
  /** Every decision on a call from now on, as it is recorded: Settings › Developer. */
  Rpc.make('permissions.decisions', {
    success: PermissionDecision,
    error: failing(StorageFailed, EngineGone),
    stream: true,
  }),
  /** The user's consent to send calls to Jev; no Jev without it. */
  Rpc.make('hemeraAuto.setConsent', {
    payload: { consent: Schema.Boolean },
    success: Schema.Void,
    error: failing(StorageFailed, EngineGone),
  }),
  /** Who judges a call of this agent in this mode, as the settings and the model picker say. */
  Rpc.make('hemeraAuto.whoJudges', {
    payload: { agent: AgentProvider, mode: Schema.NullOr(Schema.String) },
    success: WhoJudges,
    error: failing(StorageFailed, EngineGone),
  }),
)

/**
 * Hemera Auto's key as the window handles it: through main only, which seals it with the system's
 * protected storage before anything is stored. The key is never answered back.
 */
export const HemeraAutoRpcs = RpcGroup.make(
  Rpc.make('hemeraAuto.status', {
    success: HemeraAutoStatus,
    error: failing(StorageFailed, EngineGone),
  }),
  /** Seals and stores a key; without protected storage nothing is stored, as the status says. */
  Rpc.make('hemeraAuto.saveKey', {
    payload: { key: Schema.String },
    success: HemeraAutoStatus,
    error: failing(StorageFailed, EngineGone),
  }),
  Rpc.make('hemeraAuto.removeKey', {
    success: HemeraAutoStatus,
    error: failing(StorageFailed, EngineGone),
  }),
)

/**
 * The key between main and the engine, never offered to the window: the ciphertext main sealed,
 * stored and read back; the key main decrypted, handed over to be held in memory; its removal.
 */
export const JevKeyRpcs = RpcGroup.make(
  Rpc.make('jevKey.state', { success: JevKeyState, error: failing(StorageFailed, EngineGone) }),
  Rpc.make('jevKey.ciphertext', {
    success: Schema.NullOr(Schema.String),
    error: failing(StorageFailed, EngineGone),
  }),
  Rpc.make('jevKey.store', {
    payload: { ciphertext: Schema.String },
    success: Schema.Void,
    error: failing(StorageFailed, EngineGone),
  }),
  Rpc.make('jevKey.restore', {
    payload: { key: Schema.String },
    success: Schema.Void,
    error: failing(StorageFailed, EngineGone),
  }),
  Rpc.make('jevKey.remove', { success: Schema.Void, error: failing(StorageFailed, EngineGone) }),
)
