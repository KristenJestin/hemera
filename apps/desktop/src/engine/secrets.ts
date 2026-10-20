/**
 * The known secret values: the registry every mask of the engine reads.
 *
 * A source registers its values under its name (`project-variables:<projectId>`,
 * `workspace-variables:<workspaceId>`, `jev-key`, `keyring:<service>`) and unregisters them when
 * they are gone; registering a source again replaces its values. The values live in the engine's
 * memory only: never in the database, never in a log. The registry is rebuilt at each start from
 * its sources, the variables of the Profile first.
 *
 * A known value is masked as a part of any text, so a value that is a boolean or shorter than six
 * characters is never registered: masked inside other words, a variable valued `1`, `3000` or
 * `dev` would hide every `1`, `3000` and `dev`, and such a value says nothing worth hiding. A
 * number of six characters or more (a PIN, an account id) is registered like any value.
 * Matching on word boundaries instead would let a real secret glued to other characters (a
 * query string, a path, a longer token) through, so the rule is on the value, not on the match.
 */

import {
  type FixedFields,
  MAIN_CHECKOUT_NAME,
  type Masked,
  maskArguments,
  maskPrinted,
  maskPrintedPaced,
  maskRecord,
} from '@hemera/core/domain'
import { and, eq, isNull } from 'drizzle-orm'
import { Context, Effect } from 'effect'
import type { Schema } from 'effect'

import { Database, refusedWhile } from './storage/database.ts'
import { environmentVariables } from './storage/schema.ts'

export interface SecretsRegistry {
  /**
   * Registers a source's values, those the rule finds worth masking; `whole` are registered
   * whatever their length (a value its name says is secret).
   */
  readonly register: (
    source: string,
    values: ReadonlyArray<string>,
    whole?: ReadonlyArray<string>,
  ) => void
  readonly unregister: (source: string) => void
  /** Every value registered now, once each. */
  readonly values: () => ReadonlyArray<string>
  /**
   * Text with every registered value and every shape of credential masked. A text that is JSON,
   * whole or line by line, is masked as JSON and stays JSON (`maskPrinted`): a serialized value
   * is never masked as plain text, where a quoted value inside a JSON string leaked and broke it.
   * A text that is not JSON is masked as plain text masks it.
   */
  readonly mask: (text: string) => Masked<string>
  /** As `mask`, in slices of time: the engine answers while a long text is masked. */
  readonly maskPaced: (text: string) => Effect.Effect<Masked<string>>
  /**
   * What a CLI printed, masked at least as the text whole would be, and still JSON where it was;
   * in slices of time, as `maskPaced`.
   */
  readonly maskPrinted: (text: string) => Effect.Effect<Masked<string>>
  /**
   * A structured value the engine builds, with every string in it masked, and its credential
   * fields whole; its names and tags kept, as its schema reads them back, and the fields `fixed`
   * lists when they hold a literal it allows (#416).
   */
  readonly maskRecord: (record: Schema.JsonObject, fixed?: FixedFields) => Masked<Schema.JsonObject>
  /** The arguments an agent sent, masked as `maskRecord` masks a record, their names and tags too. */
  readonly maskArguments: (record: Schema.JsonObject) => Masked<Schema.JsonObject>
}

/**
 * Whether a value is worth masking: six characters or more, and not a boolean. A long number
 * (a PIN, an account id, a numeric token) is one; a short one (a port, a count) is not.
 */
export const secretWorthy = (value: string): boolean => {
  const trimmed = value.trim()
  return trimmed.length >= 6 && !['true', 'false'].includes(trimmed.toLowerCase())
}

export function secretsRegistry(): SecretsRegistry {
  const sources = new Map<string, ReadonlyArray<string>>()
  const values = () => [...new Set([...sources.values()].flat())]
  return {
    register: (source, given, whole = []) => {
      sources.set(source, [
        ...given.filter(secretWorthy),
        ...whole.filter((value) => value.trim() !== ''),
      ])
    },
    unregister: (source) => {
      sources.delete(source)
    },
    values,
    mask: (text) => maskPrinted(text, values()),
    maskPaced: (text) => maskPrintedPaced(text, values()),
    maskPrinted: (text) => maskPrintedPaced(text, values()),
    maskRecord: (record, fixed) => maskRecord(record, values(), fixed),
    maskArguments: (record) => maskArguments(record, values()),
  }
}

export class Secrets extends Context.Service<Secrets, SecretsRegistry>()('Secrets') {}

/** How far past what is kept the head of a long text is masked: past any credential cut in two. */
const HEAD_MARGIN = 4096

/**
 * The first `kept` characters of a text as they read masked, without masking the whole of a large
 * one (a call's arguments, a minified line, #392): a head two margins longer is masked in slices
 * of time, then one margin is dropped from its end. A value or a credential the cut split in two
 * is no longer recognised, and stays in clear; it is the last characters of the head, masked or
 * not, so the margin takes it away. The margin is longer than any credential masked by its shape,
 * and than the longest value registered; the second one leaves `kept` characters whole unless the
 * masks shortened the head by more than a margin, and then fewer are kept, never a piece in clear.
 */
export const maskedHead = (secrets: SecretsRegistry, text: string, kept: number) =>
  Effect.gen(function* () {
    const margin = Math.max(HEAD_MARGIN, ...secrets.values().map((value) => value.length))
    const whole = text.length <= kept + 2 * margin
    const masked = yield* secrets.maskPaced(whole ? text : text.slice(0, kept + 2 * margin))
    const safe = whole ? masked.length : Math.max(0, masked.length - margin)
    return masked.length <= kept && whole
      ? masked
      : secrets.mask(masked.slice(0, Math.min(kept, safe)))
  })

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
