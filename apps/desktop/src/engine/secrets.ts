/**
 * The known secret values: the registry every mask of the engine reads.
 *
 * A source registers its values under its name (`project-variables:<projectId>`,
 * `workspace-variables:<workspaceId>`, `jev-key`, `keyring:<service>`) and unregisters them when
 * they are gone; registering a source again replaces its values. The values live in the engine's
 * memory only: never in the database, never in a log. The registry is rebuilt at each start from
 * its sources, the variables of the Profile first.
 */

import { MAIN_CHECKOUT_NAME, type Masked, maskRecord, maskText } from '@hemera/core/domain'
import { and, eq, isNull } from 'drizzle-orm'
import { Context, Effect } from 'effect'
import type { Schema } from 'effect'

import { Database, refusedWhile } from './storage/database.ts'
import { environmentVariables } from './storage/schema.ts'

export interface SecretsRegistry {
  readonly register: (source: string, values: ReadonlyArray<string>) => void
  readonly unregister: (source: string) => void
  /** Every value registered now, once each. */
  readonly values: () => ReadonlyArray<string>
  /** Text with every registered value masked, then the shapes of credentials. */
  readonly mask: (text: string) => Masked<string>
  /** A structured value with every string in it masked, and its credential fields whole. */
  readonly maskRecord: (record: Schema.JsonObject) => Masked<Schema.JsonObject>
}

export function secretsRegistry(): SecretsRegistry {
  const sources = new Map<string, ReadonlyArray<string>>()
  const values = () => [...new Set([...sources.values()].flat())]
  return {
    register: (source, given) => {
      sources.set(
        source,
        given.filter((value) => value !== ''),
      )
    },
    unregister: (source) => {
      sources.delete(source)
    },
    values,
    mask: (text) => maskText(text, values()),
    maskRecord: (record) => maskRecord(record, values()),
  }
}

export class Secrets extends Context.Service<Secrets, SecretsRegistry>()('Secrets') {}

/** The source of a Project's own variables, or of a Workspace's. */
export const variablesSource = (projectId: string, workspaceId: string | null): string =>
  workspaceId === null ? `project-variables:${projectId}` : `workspace-variables:${workspaceId}`

/** The source of the variables as they were filled for a place: its Workspace, or the main checkout. */
export const placeSource = (projectId: string, workspaceId: string | null): string =>
  `place-variables:${projectId}:${workspaceId ?? MAIN_CHECKOUT_NAME}`

/**
 * Registers the variables of one scope as they are now, or unregisters the scope when it has none
 * left: what a change of a variable calls once it is written.
 */
export const registerVariables = (projectId: string, workspaceId: string | null) =>
  Effect.gen(function* () {
    const secrets = yield* Secrets
    const database = yield* Database
    const rows = yield* database
      .select({ value: environmentVariables.value })
      .from(environmentVariables)
      .where(
        and(
          eq(environmentVariables.projectId, projectId),
          workspaceId === null
            ? isNull(environmentVariables.workspaceId)
            : eq(environmentVariables.workspaceId, workspaceId),
        ),
      )
      .pipe(Effect.mapError(refusedWhile('reading the variables')))
    const source = variablesSource(projectId, workspaceId)
    const values = rows.map((row) => row.value)
    if (values.length === 0) secrets.unregister(source)
    else secrets.register(source, values)
  })

/** A Workspace removed: its own variables and the values filled for it are no longer secrets. */
export const unregisterWorkspace = (projectId: string, workspaceId: string) =>
  Secrets.useSync((secrets) => {
    secrets.unregister(variablesSource(projectId, workspaceId))
    secrets.unregister(placeSource(projectId, workspaceId))
  })

/** At the engine's start: every scope's variables registered under their source. */
export const registerAllVariables = Effect.gen(function* () {
  const secrets = yield* Secrets
  const database = yield* Database
  const rows = yield* database
    .select({
      projectId: environmentVariables.projectId,
      workspaceId: environmentVariables.workspaceId,
      value: environmentVariables.value,
    })
    .from(environmentVariables)
    .pipe(Effect.mapError(refusedWhile('reading the variables')))
  const bySource = new Map<string, string[]>()
  for (const row of rows) {
    const source = variablesSource(row.projectId, row.workspaceId)
    bySource.set(source, [...(bySource.get(source) ?? []), row.value])
  }
  for (const [source, values] of bySource) secrets.register(source, values)
  return bySource.size
})
