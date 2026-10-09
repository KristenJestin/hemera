import type { ReactNode } from 'react'

import { Button } from '../../components/button/button.tsx'
import { Checkbox } from '../../components/checkbox/checkbox.tsx'
import { Empty } from '../../components/empty/empty.tsx'
import { Input } from '../../components/field/field.tsx'
import { Frame } from '../../components/frame/frame.tsx'
import { Skeleton } from '../../components/loading/loading.tsx'
import { SectionHead } from '../../components/section-head/section-head.tsx'
import { Select } from '../../components/select/select.tsx'
import { IconChevronRight, IconDatabase, IconPlus } from '../../icons.ts'
import { Section, SectionRefusal } from './parts.tsx'

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

const RULE = 'border-b border-border last:border-b-0'

const OPEN =
  'flex min-h-control-lg w-full min-w-0 items-center gap-3 rounded-md px-3 py-2 text-left text-sm outline-none hover:tinted focus-ring hover-motion'

const NAME = 'flex w-settings-name min-w-0 shrink-0 items-center gap-2 font-medium'

const AFTER = 'ml-auto flex shrink-0 items-center gap-2 text-xs text-muted-foreground'

/** The rows' own shape while the list is on its way. */
function ResourcesLoading(): ReactNode {
  return (
    <ul aria-label="Exclusive resources" aria-busy="true" className="flex flex-col p-1">
      {['one', 'two'].map((key) => (
        <li key={key} data-row-skeleton="" className={RULE}>
          <span className="flex min-h-control-lg min-w-0 items-center gap-3 px-3 py-2 text-sm">
            <span className={NAME}>
              <Skeleton shape="block">
                <IconDatabase size="sm" />
              </Skeleton>
              <Skeleton>Shared database</Skeleton>
            </span>
            <span className="min-w-0 flex-1 text-xs">
              <Skeleton>Migrate the database · restored by Reset the database</Skeleton>
            </span>
          </span>
        </li>
      ))}
    </ul>
  )
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
export function ExclusiveResources({
  resources,
  error,
  onOpen,
  onAdd,
}: ExclusiveResourcesProps): ReactNode {
  return (
    <Section label="Exclusive resources">
      <SectionHead
        title="Exclusive resources"
        count={resources?.length}
        actions={
          <Button size="sm" onClick={onAdd}>
            <IconPlus size="sm" />
            Add a resource
          </Button>
        }
      />
      <SectionRefusal error={error} />
      {(error === undefined || resources === null || resources.length > 0) && (
        <Frame>
          {resources === null ? (
            <ResourcesLoading />
          ) : resources.length === 0 ? (
            <Empty
              icon={<IconDatabase />}
              title="No exclusive resource"
              description="A resource two missions must not use at once: a shared database, a sandbox account."
            />
          ) : (
            <ul aria-label="Exclusive resources" className="flex flex-col p-1">
              {resources.map((resource) => (
                <li key={resource.id} className={RULE}>
                  <button type="button" className={OPEN} onClick={() => onOpen(resource.id)}>
                    <span className={NAME}>
                      <span className="flex shrink-0 text-muted-foreground">
                        <IconDatabase size="sm" />
                      </span>
                      <span className="truncate">{resource.name}</span>
                    </span>
                    <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                      {resource.uses.join(', ')}
                      {resource.restore === null
                        ? ' · no restore: a need opens at the start'
                        : ` · restored by ${resource.restore}`}
                    </span>
                    <span className={AFTER}>
                      {resource.holder !== null && (
                        <span className="text-foreground">
                          held by {resource.holder.missionKey} since {resource.holder.since}
                          {resource.queue.length > 0 && `, ${resource.queue.join(', ')} waits`}
                        </span>
                      )}
                      <IconChevronRight size="sm" aria-hidden="true" />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Frame>
      )}
      <p className="max-w-measure text-xs text-muted-foreground">
        Only the commands declared on a resource are protected. A change applies to the missions
        launched after it.
      </p>
    </Section>
  )
}

/** A resource being edited: the commands that use it and the one that restores it, by id. */
export interface ResourceDraftView {
  name: string
  description: string
  uses: readonly string[]
  resetCommandId: string | null
}

/** The restore select's value for no restore: no command has this id. */
const NO_RESTORE = 'none'

/** The props of the resource form. */
export interface ResourceFormProps {
  draft: ResourceDraftView
  /** The catalogue's commands to pick from. */
  commands: readonly { id: string; name: string }[]
  refused?: string | undefined
  onDraft: (draft: ResourceDraftView) => void
}

/** The form of a resource's dialog. */
export function ResourceForm({ draft, commands, refused, onDraft }: ResourceFormProps): ReactNode {
  const toggle = (id: string, on: boolean): void =>
    onDraft({
      ...draft,
      uses: on ? [...draft.uses, id] : draft.uses.filter((one) => one !== id),
    })
  return (
    <>
      <Input label="Name" value={draft.name} onValueChange={(name) => onDraft({ ...draft, name })} />
      <Input
        label="What it is"
        value={draft.description}
        onValueChange={(description) => onDraft({ ...draft, description })}
      />
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Commands that use it</legend>
        {commands.map((command) => (
          <Checkbox
            key={command.id}
            checked={draft.uses.includes(command.id)}
            onCheckedChange={(on) => toggle(command.id, on)}
            label={command.name}
          />
        ))}
      </fieldset>
      <Select
        label="Restore command"
        items={[
          { value: NO_RESTORE, label: 'None: a need opens at the start' },
          ...commands.map((one) => ({ value: one.id, label: one.name })),
        ]}
        value={draft.resetCommandId ?? NO_RESTORE}
        onValueChange={(id) => onDraft({ ...draft, resetCommandId: id === NO_RESTORE ? null : id })}
      />
      <p className="text-xs text-muted-foreground">
        Only these commands are protected: a line an agent writes, a Chat’s command or one you run
        in your own terminal is not recognised.
      </p>
      {refused !== undefined && (
        <p role="alert" className="text-sm text-destructive-muted-foreground">
          {refused}
        </p>
      )}
    </>
  )
}
