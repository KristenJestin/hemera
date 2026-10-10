/**
 * What the exclusive resources show of the engine's records, and what their dialog writes back: a
 * line per resource with who holds it and who waits, a dialog's draft read from a declaration, the
 * whole list the engine takes at save, and the words of a refusal. The dialog does not show the
 * commands that only change a resource: the declaration keeps them, and the restore command
 * joins them.
 */

import {
  type Command,
  type ExclusiveResource,
  InvalidResources,
  type ResourceDraft,
  type ResourceHolding,
} from '@hemera/ipc'
import type { ResourceDraftView, ResourceView } from '@hemera/ui'

import type { Link } from './link.ts'
import { whenOf } from './needs.ts'
import { type ProviderStore, latestRead } from './ticket-providers-model.ts'

const TIME = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' })

/** A resource's identity on the machine: its name, trimmed and case-folded. */
const keyOf = (name: string): string => name.trim().toLowerCase()

/** When a holding began: the time of day if it is today, the day otherwise. */
export function sinceWords(iso: string, now: Date): string {
  const at = new Date(iso)
  const sameDay =
    at.getFullYear() === now.getFullYear() &&
    at.getMonth() === now.getMonth() &&
    at.getDate() === now.getDate()
  return sameDay ? TIME.format(at) : whenOf(iso, now)
}

/** The holding of a resource, found by the names it is declared under, case-folded. */
export function holdingOf(
  resource: ExclusiveResource,
  holdings: ReadonlyArray<ResourceHolding>,
): ResourceHolding | undefined {
  const key = keyOf(resource.name)
  return holdings.find((one) => one.names.some((name) => keyOf(name) === key))
}

/** The lines of the section; null while the declarations are still on their way. */
export function resourceViewsOf(
  resources: ReadonlyArray<ExclusiveResource> | null,
  holdings: ReadonlyArray<ResourceHolding>,
  catalogue: ReadonlyArray<Command>,
  now: Date,
): ReadonlyArray<ResourceView> | null {
  if (resources === null) return null
  const nameOf = (id: string): string => catalogue.find((one) => one.id === id)?.name ?? id
  return resources.map((resource) => {
    const holding = holdingOf(resource, holdings)
    const holder = holding?.holder
    return {
      id: resource.id,
      name: resource.name,
      description: resource.description,
      uses: resource.uses.map(nameOf),
      restore: resource.resetCommandId === null ? null : nameOf(resource.resetCommandId),
      holder:
        holder === null || holder === undefined
          ? null
          : { missionKey: holder.missionKey, since: sinceWords(holder.since, now) },
      queue: holding?.queue.map((one) => one.missionKey) ?? [],
    }
  })
}

/** A dialog's draft: a declaration's, or an empty one for a new resource. */
export function draftOf(resource: ExclusiveResource | undefined): ResourceDraftView {
  return {
    name: resource?.name ?? '',
    description: resource?.description ?? '',
    uses: resource?.uses ?? [],
    resetCommandId: resource?.resetCommandId ?? null,
  }
}

/** What is missing of a draft, in words; undefined when it can be saved. */
export function resourceRefusal(draft: ResourceDraftView): string | undefined {
  if (draft.name.trim() === '') return 'Give the resource a name.'
  if (draft.uses.length === 0) return 'Pick at least one command that uses it.'
  if (draft.resetCommandId !== null && draft.uses.includes(draft.resetCommandId)) {
    return 'The restore command cannot also be one that uses the resource.'
  }
  return undefined
}

const declared = (resource: ExclusiveResource): ResourceDraft => ({
  name: resource.name,
  description: resource.description,
  uses: resource.uses,
  changes: resource.changes,
  resetCommandId: resource.resetCommandId,
})

/**
 * The whole list the engine takes at save: the resource `id` replaced by the draft (a new one
 * at the end when `id` is null), the others as declared. A resource keeps the commands that
 * change it, less those now chosen as using it, and gains its restore command.
 */
export function resourceDraftsOf(
  resources: ReadonlyArray<ExclusiveResource>,
  id: string | null,
  draft: ResourceDraftView,
): ReadonlyArray<ResourceDraft> {
  const before = resources.find((one) => one.id === id)
  const kept = (before?.changes ?? []).filter((one) => !draft.uses.includes(one))
  const changes =
    draft.resetCommandId === null || kept.includes(draft.resetCommandId)
      ? kept
      : [...kept, draft.resetCommandId]
  const written: ResourceDraft = {
    name: draft.name.trim(),
    description: draft.description,
    uses: draft.uses,
    changes,
    resetCommandId: draft.resetCommandId,
  }
  if (before === undefined) return [...resources.map(declared), written]
  return resources.map((one) => (one.id === before.id ? written : declared(one)))
}

/** The list without the resource `id`. */
export function withoutResource(
  resources: ReadonlyArray<ExclusiveResource>,
  id: string,
): ReadonlyArray<ResourceDraft> {
  return resources.filter((one) => one.id !== id).map(declared)
}

/** Why the resources could not be saved, in words: the engine's own when it refuses them. */
export function savedWords(failure: Error): string {
  return failure instanceof InvalidResources
    ? failure.message
    : `The resources could not be saved: ${failure.message}`
}

/** What the section has read, and why it could not read more. */
export interface ResourcesRead {
  readonly resources: ReadonlyArray<ExclusiveResource> | null
  readonly holdings: ReadonlyArray<ResourceHolding>
  readonly error: string | undefined
}

/** Keeps the list the engine answered to a save, over any read that began before it. */
export function savedResources(
  store: ProviderStore<ResourcesRead>,
  resources: ReadonlyArray<ExclusiveResource>,
): void {
  latestRead(store, 'resources')
  store.set({ resources, error: undefined })
}

/**
 * Follows a Project's resources and who holds them: the list is read now and again at each change
 * of the holdings. Only the latest read lands: an older answer arriving late is dropped. Answers
 * the function that stops it.
 */
export function followResources(
  link: Pick<Link, 'resources' | 'onResourceHolders'>,
  store: ProviderStore<ResourcesRead>,
  projectId: string,
): () => void {
  let current = true
  const read = (): void => {
    const latest = latestRead(store, 'resources')
    link.resources(projectId).then(
      (resources) => {
        if (current && latest()) store.set({ resources, error: undefined })
      },
      (failure: Error) => {
        if (current && latest()) {
          store.set({ error: `The exclusive resources could not be read: ${failure.message}` })
        }
      },
    )
  }
  read()
  const stop = link.onResourceHolders(
    (holdings) => {
      store.set({ holdings })
      // A declaration changed elsewhere moves the holdings too.
      read()
    },
    (failure) =>
      store.set({ error: `The exclusive resources could not be read: ${failure.message}` }),
  )
  return () => {
    current = false
    stop()
  }
}
