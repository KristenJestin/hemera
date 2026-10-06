/**
 * The roles a session can hold, one entry each, registered by the ticket that creates the role:
 * who owns its sessions, where they work, whether they write, whether they read the Memory
 * (CT-06), whether they are handed the Project's instruction files, which stage they are the
 * main session of, their instructions, their brief, and whether they count in the Project's cap
 * of sub-agents. A role's tools are the role table's (`@hemera/core`), never this registry's.
 *
 * The role tickets register their roles here; the suites register the `test` role themselves.
 */

import { ROLES, type PlaceKind, type Role, TOOLS, TOOL_NAMES, toolsOf } from '@hemera/core/domain'
import { Context, type Effect, Layer } from 'effect'

import type { Database, DatabaseError } from '../storage/database.ts'

/** Who a session belongs to. */
export type SessionOwner =
  | { readonly kind: 'mission'; readonly missionId: string }
  | { readonly kind: 'project'; readonly projectId: string }

/** One field of a role's brief: a field with no text is left out of the brief, never "none". */
export interface BriefField {
  readonly label: string
  readonly text: string | null
}

export interface RoleEntry {
  readonly id: string
  /** As the base instructions name it: `the Builder`. */
  readonly displayName: string
  readonly ownerKind: SessionOwner['kind']
  /** The kind of place its sessions work in; the Project folder for a setup agent. */
  readonly placeKind: PlaceKind | 'project-folder'
  readonly writes: boolean
  /** Whether its sessions read the Memory: the brief's block, the tools, the resume (CT-06). */
  readonly readsMemory: boolean
  /** Whether it is handed the Project's instruction files as the third layer. */
  readonly projectLayer: boolean
  /** The stage it is the main session of (the Planner of Planning), or none. */
  readonly mainOf: string | null
  /** Its layer of the instructions, set once at the session's start. */
  readonly template: string
  /** The fields of its brief, from what its owner holds now. */
  readonly brief: (
    owner: SessionOwner,
  ) => Effect.Effect<ReadonlyArray<BriefField>, DatabaseError, Database>
  /** Whether its sessions count in the Project's cap of simultaneous sub-agents (#41 reads it). */
  readonly countsInCap: boolean
}

export class RoleRegistry extends Context.Service<RoleRegistry, ReadonlyArray<RoleEntry>>()(
  'RoleRegistry',
) {}

export const roleRegistryLayer = (entries: ReadonlyArray<RoleEntry>) =>
  Layer.succeed(RoleRegistry, entries)

/** A role by its id, or undefined when no ticket registered it. */
export const roleNamed = (entries: ReadonlyArray<RoleEntry>, id: string): RoleEntry | undefined =>
  entries.find((entry) => entry.id === id)

/** The roles this version registers. */
export const ROLES_REGISTERED: ReadonlyArray<RoleEntry> = []

/** The tools that read or write the Memory: `memory_read` and every tool that records in it. */
export const MEMORY_TOOLS = TOOL_NAMES.filter(
  (name) => name === 'memory_read' || TOOLS[name].effect === 'records',
)

const readRole = (id: string): Role | undefined => ROLES.find((role) => role === id)

/**
 * CT-06: every registered role that does not read the Memory yet has a Memory tool in the role
 * table, said in words. Empty when the contract holds.
 */
export const memoryContractBroken = (entries: ReadonlyArray<RoleEntry>): ReadonlyArray<string> =>
  entries.flatMap((entry) => {
    if (entry.readsMemory) return []
    const role = readRole(entry.id)
    const held =
      role === undefined ? [] : toolsOf(role).filter((tool) => MEMORY_TOOLS.includes(tool))
    return held.length === 0
      ? []
      : [`${entry.id} does not read the Memory but has ${held.join(', ')}`]
  })
