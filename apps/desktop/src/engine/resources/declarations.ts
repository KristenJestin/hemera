/**
 * A Project's exclusive resources (#88, CT-40): what its Workspaces share and only one mission at a
 * time may use, each with the catalogue commands that use it, those that change it, and the command
 * that resets it, if one does. Read live by the reservations and by the decision order; replaced
 * whole by the user (the settings screen is #104's).
 *
 * Saving checks every resource first and refuses, with the reason in words: a resource without a
 * name, one declared twice, a command that is not in the catalogue, a command listed both as using
 * and as changing it, a service as its reset command (it never ends, so the resource would never
 * be ready). Its reset command changes it, implicitly.
 *
 * A resource's identity on the machine is its name trimmed and case-folded: two Projects that
 * declare "Shared database" and "shared database" share one reservation. "Machine-wide" means
 * within one profile: the reservations are rows of the profile's data folder, so two profiles,
 * like two machines, do not share them. Only declared commands are protected: a free line, a
 * Chat's command or one run in the user's own terminal cannot be recognised.
 */

import { type ExclusiveResource, InvalidResources, type ResourceDraft } from '@hemera/ipc'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { Effect } from 'effect'

import { getCommand, listCommands } from '../catalogue.ts'
import { getProject } from '../projects.ts'
import { Database, refusedWhile } from '../storage/database.ts'
import { exclusiveResourceCommands, exclusiveResources } from '../storage/schema.ts'
import { mutate } from '../transaction.ts'

/** A resource's identity on the whole machine: its name, trimmed and case-folded. */
export const resourceKey = (name: string): string => name.trim().toLowerCase()

const refused = (reason: string) => Effect.fail(new InvalidResources({ reason }))

/** A Project's resources, in the order they were declared. */
export const listResources = (projectId: string) =>
  Effect.gen(function* () {
    yield* getProject(projectId)
    const database = yield* Database
    const rows = yield* database
      .select()
      .from(exclusiveResources)
      .where(eq(exclusiveResources.projectId, projectId))
      .orderBy(asc(exclusiveResources.position))
      .pipe(Effect.mapError(refusedWhile('reading the exclusive resources')))
    const commands =
      rows.length === 0
        ? []
        : yield* database
            .select()
            .from(exclusiveResourceCommands)
            .where(
              inArray(
                exclusiveResourceCommands.resourceId,
                rows.map((row) => row.id),
              ),
            )
            .pipe(Effect.mapError(refusedWhile('reading the exclusive resources')))
    const listed = (resourceId: string, role: string) =>
      commands
        .filter((one) => one.resourceId === resourceId && one.role === role)
        .map((one) => one.commandId)
    return rows.map((row): ExclusiveResource => ({
      id: row.id,
      projectId: row.projectId,
      name: row.name,
      description: row.description,
      uses: listed(row.id, 'use'),
      changes: listed(row.id, 'change'),
      resetCommandId: row.resetCommandId,
    }))
  })

/** Replaces a Project's resources whole, every one checked first. */
export const saveResources = (projectId: string, drafts: ReadonlyArray<ResourceDraft>) =>
  Effect.gen(function* () {
    yield* getProject(projectId)
    const listedCommands = new Map((yield* listCommands(projectId)).map((one) => [one.id, one]))
    const catalogue = new Map([...listedCommands].map(([id, one]) => [id, one.name]))
    const keys = new Set<string>()
    const checked: Array<ResourceDraft & { readonly key: string }> = []
    for (const draft of drafts) {
      const name = draft.name.trim()
      if (name === '') return yield* refused('a resource has no name')
      const key = resourceKey(name)
      if (keys.has(key)) return yield* refused(`${name} is declared twice`)
      keys.add(key)
      const reset = draft.resetCommandId
      const listed = [...draft.uses, ...draft.changes, ...(reset === null ? [] : [reset])]
      if (listed.some((id) => !catalogue.has(id))) {
        return yield* refused(`${name}: a command it lists is not in the catalogue`)
      }
      const both = draft.uses.find((id) => draft.changes.includes(id))
      if (both !== undefined) {
        return yield* refused(
          `${name}: ${catalogue.get(both) ?? both} is listed both as using it and as changing it`,
        )
      }
      if (reset !== null && draft.uses.includes(reset)) {
        return yield* refused(
          `${name}: ${catalogue.get(reset) ?? reset} is its reset command, which changes it, and cannot be listed as using it`,
        )
      }
      if (reset !== null && listedCommands.get(reset)?.type === 'serve') {
        return yield* refused(
          `${name}: ${catalogue.get(reset) ?? reset} is a service, which never ends, and cannot be its reset command`,
        )
      }
      const changes = [...new Set([...draft.changes, ...(reset === null ? [] : [reset])])]
      checked.push({ ...draft, name, key, uses: [...new Set(draft.uses)], changes })
    }
    yield* mutate('saving the exclusive resources', (transaction) =>
      Effect.gen(function* () {
        yield* transaction
          .delete(exclusiveResources)
          .where(eq(exclusiveResources.projectId, projectId))
          .pipe(Effect.mapError(refusedWhile('saving the exclusive resources')))
        for (const [position, resource] of checked.entries()) {
          const id = crypto.randomUUID()
          yield* transaction
            .insert(exclusiveResources)
            .values({
              id,
              projectId,
              position,
              name: resource.name,
              key: resource.key,
              description: resource.description.trim(),
              resetCommandId: resource.resetCommandId,
            })
            .pipe(Effect.mapError(refusedWhile('saving the exclusive resources')))
          const commands = [
            ...resource.uses.map((commandId) => ({ resourceId: id, commandId, role: 'use' })),
            ...resource.changes.map((commandId) => ({ resourceId: id, commandId, role: 'change' })),
          ]
          if (commands.length > 0) {
            yield* transaction
              .insert(exclusiveResourceCommands)
              .values(commands)
              .pipe(Effect.mapError(refusedWhile('saving the exclusive resources')))
          }
        }
        return {
          result: undefined,
          events: [
            {
              type: 'project.resources_saved',
              entityKind: 'project',
              entityId: projectId,
              source: 'ui',
              author: 'human',
              payload: { resources: checked.map((resource) => resource.name) },
            } as const,
          ],
        }
      }),
    )
    return yield* listResources(projectId)
  })

/** A resource a command is declared on, and whether the command uses or changes it. */
export interface Declared {
  readonly key: string
  readonly name: string
  readonly role: 'use' | 'change'
}

/** The resources a catalogue command of a Project is declared on, in the order of their keys. */
export const resourcesOf = (projectId: string, commandId: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const rows = yield* database
      .select({
        key: exclusiveResources.key,
        name: exclusiveResources.name,
        role: exclusiveResourceCommands.role,
      })
      .from(exclusiveResourceCommands)
      .innerJoin(
        exclusiveResources,
        eq(exclusiveResources.id, exclusiveResourceCommands.resourceId),
      )
      .where(
        and(
          eq(exclusiveResources.projectId, projectId),
          eq(exclusiveResourceCommands.commandId, commandId),
        ),
      )
      .orderBy(asc(exclusiveResources.key))
      .pipe(Effect.mapError(refusedWhile('reading the exclusive resources')))
    return rows.map((row): Declared => ({
      key: row.key,
      name: row.name,
      role: row.role === 'change' ? 'change' : 'use',
    }))
  })

/** The names of the resources a catalogue command of a Project changes. */
export const changedBy = (projectId: string, commandId: string) =>
  Effect.map(resourcesOf(projectId, commandId), (declared) =>
    declared.filter((one) => one.role === 'change').map((one) => one.name),
  )

/** The command that resets a resource for a Project, as its live declaration says; null if none. */
export const resetCommandOf = (projectId: string, key: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const [row] = yield* database
      .select({ resetCommandId: exclusiveResources.resetCommandId })
      .from(exclusiveResources)
      .where(and(eq(exclusiveResources.projectId, projectId), eq(exclusiveResources.key, key)))
      .pipe(Effect.mapError(refusedWhile('reading the exclusive resources')))
    if (row === undefined || row.resetCommandId === null) return null
    return yield* getCommand(projectId, row.resetCommandId).pipe(
      Effect.catchTag('UnknownCommand', () => Effect.succeed(null)),
    )
  })
