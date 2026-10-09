/**
 * The exclusive resources of a Project, in its settings (#104): the list over the link with who
 * holds each one now, and the dialog that declares, mends or removes one. A resource is saved with
 * the whole list, so the part keeps the declarations it last read. A dialog's draft is held outside
 * React's state, so its body and its foot read it in the same render. No Effect here.
 */

import type { Command, ExclusiveResource, ResourceHolding } from '@hemera/ipc'
import {
  ExclusiveResources,
  FormFoot,
  ResourceForm,
  type ResourceDraftView,
  type SettingsForm,
} from '@hemera/ui'
import { IconDatabase } from '@hemera/ui/icons'
import { type ReactNode, useEffect, useState, useSyncExternalStore } from 'react'

import type { Link } from './link.ts'
import {
  draftOf,
  resourceDraftsOf,
  resourceRefusal,
  resourceViewsOf,
  savedWords,
  withoutResource,
} from './resources-model.ts'
import { type ProviderStore, providerStore } from './ticket-providers-model.ts'

export interface ResourcesPartProps {
  link: Link
  engineReady: boolean
  projectId: string
  catalogue: ReadonlyArray<Command>
  show: (form: SettingsForm | null) => void
}

/** What the section has read, and why it could not read more. */
interface Read {
  readonly resources: ReadonlyArray<ExclusiveResource> | null
  readonly holdings: ReadonlyArray<ResourceHolding>
  readonly error: string | undefined
}

const NOTHING_READ: Read = { resources: null, holdings: [], error: undefined }

/** What a resource's dialog holds. */
interface Edit {
  readonly draft: ResourceDraftView
  readonly saving: boolean
  readonly refused: string | undefined
}

function useStored<T extends object>(store: ProviderStore<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get)
}

/** The resources of a Project and who holds them, followed while the section is there. */
function useResourceStore(
  link: Link,
  engineReady: boolean,
  projectId: string,
): ProviderStore<Read> {
  const [store] = useState(() => providerStore<Read>(NOTHING_READ))
  useEffect(() => {
    store.set(NOTHING_READ)
    if (!engineReady) return undefined
    let current = true
    const read = (): void => {
      link.resources(projectId).then(
        (resources) => {
          if (current) store.set({ resources, error: undefined })
        },
        (failure: Error) => {
          if (current) {
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
  }, [link, engineReady, projectId, store])
  return store
}

interface DialogProps {
  link: Link
  projectId: string
  store: ProviderStore<Read>
  edit: ProviderStore<Edit>
  /** The resource being mended; null for a new one. */
  id: string | null
}

function ResourceBody({
  catalogue,
  edit,
}: {
  catalogue: ReadonlyArray<Command>
  edit: ProviderStore<Edit>
}): ReactNode {
  const mine = useStored(edit)
  return (
    <ResourceForm
      draft={mine.draft}
      commands={catalogue.map((one) => ({ id: one.id, name: one.name }))}
      refused={mine.refused}
      onDraft={(draft) => edit.set({ draft })}
    />
  )
}

function ResourceFoot({
  link,
  projectId,
  store,
  edit,
  id,
  name,
  close,
}: DialogProps & { name: string | undefined; close: () => void }): ReactNode {
  const mine = useStored(edit)
  const save = (drafts: ReturnType<typeof resourceDraftsOf>): void => {
    edit.set({ saving: true, refused: undefined })
    link.saveResources(projectId, drafts).then(
      (resources) => {
        store.set({ resources })
        close()
      },
      (failure: Error) => edit.set({ saving: false, refused: savedWords(failure) }),
    )
  }
  return (
    <FormFoot
      remove={name === undefined || id === null ? undefined : `Remove ${name}`}
      onRemove={() => save(withoutResource(store.get().resources ?? [], id ?? ''))}
      save={id === null ? 'Add' : 'Save'}
      saving={mine.saving}
      onSave={() => {
        const refusal = resourceRefusal(mine.draft)
        if (refusal !== undefined) {
          edit.set({ refused: refusal })
          return
        }
        save(resourceDraftsOf(store.get().resources ?? [], id, mine.draft))
      }}
      onCancel={close}
    />
  )
}

/** The exclusive resources of a Project, in its settings. */
export function ResourcesPart({
  link,
  engineReady,
  projectId,
  catalogue,
  show,
}: ResourcesPartProps): ReactNode {
  const store = useResourceStore(link, engineReady, projectId)
  const state = useStored(store)
  // A dialog left open over a section that is no longer shown closes with it.
  useEffect(() => () => show(null), [show])

  const close = (): void => show(null)
  const open = (id: string | null): void => {
    const resource = store.get().resources?.find((one) => one.id === id)
    if (id !== null && resource === undefined) return
    const edit = providerStore<Edit>({
      draft: draftOf(resource),
      saving: false,
      refused: undefined,
    })
    show({
      title: resource?.name ?? 'Add a resource',
      icon: <IconDatabase size="sm" />,
      body: <ResourceBody catalogue={catalogue} edit={edit} />,
      footer: (
        <ResourceFoot
          link={link}
          projectId={projectId}
          store={store}
          edit={edit}
          id={id}
          name={resource?.name}
          close={close}
        />
      ),
    })
  }
  return (
    <ExclusiveResources
      resources={resourceViewsOf(state.resources, state.holdings, catalogue, new Date())}
      error={state.error}
      onOpen={open}
      onAdd={() => open(null)}
    />
  )
}
