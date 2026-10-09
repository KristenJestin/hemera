import type { ReactNode } from 'react'

/** An exclusive resource as its line shows it; commands are named, not identified. */
export interface ResourceView {
  id: string
  name: string
  description: string
  /** The names of the commands that use it. */
  uses: readonly string[]
  /** The name of the command that restores it; null: no restore. */
  restore: string | null
  holder: { missionKey: string; since: string } | null
  /** The keys of the missions waiting for it. */
  queue: readonly string[]
}

/** The props of the resources section. */
export interface ExclusiveResourcesProps {
  /** Null: the list is on its way. */
  resources: readonly ResourceView[] | null
  error?: string | undefined
  onOpen: (id: string) => void
  onAdd: () => void
}

/** The "Exclusive resources" section: a line per resource, and Add. */
export function ExclusiveResources(_props: ExclusiveResourcesProps): ReactNode {
  return null
}

/** A resource being edited: the commands that use it and the one that restores it, by id. */
export interface ResourceDraftView {
  name: string
  description: string
  uses: readonly string[]
  resetCommandId: string | null
}

/** The props of the resource form. */
export interface ResourceFormProps {
  draft: ResourceDraftView
  /** The catalogue's commands to pick from. */
  commands: readonly { id: string; name: string }[]
  refused?: string | undefined
  onDraft: (draft: ResourceDraftView) => void
}

/** The form of a resource's dialog. */
export function ResourceForm(_props: ResourceFormProps): ReactNode {
  return null
}
