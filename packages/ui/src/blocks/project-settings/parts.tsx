import type { ReactNode } from 'react'

import { Button } from '../../components/button/button.tsx'
import { Skeleton } from '../../components/loading/loading.tsx'
import { Menu } from '../../components/menu/menu.tsx'
import { IconBraces, IconTrash } from '../../icons.ts'

/**
 * What the sections of a Project's settings share: the head of a section, the foot of the sheet a
 * section writes in, and the menu that offers the names Hemera fills in a line or a value.
 */

/** A section: its head, and what it holds under it. */
export function Section({
  label,
  children,
}: {
  /** What the section is called to a screen reader: its title. */
  label: string
  children: ReactNode
}): ReactNode {
  return (
    <section aria-label={label} className="flex flex-col gap-3">
      {children}
    </section>
  )
}

/** The names Hemera fills in a value or a line, and what each is filled with. */
export const TEMPLATE_NAMES = [
  { name: '{workspace}', filled: 'Workspace name' },
  { name: '{workspace.path}', filled: 'Workspace folder' },
  { name: '{project}', filled: 'Project, as a slug' },
  { name: '{branch}', filled: 'Workspace branch' },
] as const

export interface TemplateMenuProps {
  /** What the field it belongs to is called: the menu is `Insert in <field>`. */
  field: string
  onInsert: (name: string) => void
}

/**
 * The names Hemera fills, offered inside a field that accepts them: the braces at the end of the
 * field open them, and choosing one writes it at the end of what is typed.
 */
export function TemplateMenu({ field, onInsert }: TemplateMenuProps): ReactNode {
  return (
    <Menu
      label={`Insert a name in ${field}`}
      icon={<IconBraces size="sm" />}
      groups={[
        TEMPLATE_NAMES.map((template) => ({
          label: template.name,
          detail: template.filled,
          onSelect: () => onInsert(template.name),
        })),
      ]}
    />
  )
}

const REFUSAL = 'text-sm text-destructive-muted-foreground'

export interface SheetFootProps {
  /** Why the last save was refused, in words; it stands above the buttons until the next save. */
  refused?: string | undefined
  /** What the destructive button says — `Remove api` — when what the sheet writes can be removed. */
  remove?: string | undefined
  onRemove?: (() => void) | undefined
  /** What the save button says: `Save`, `Add`. */
  save?: string | undefined
  saving?: boolean | undefined
  onSave: () => void
  onCancel: () => void
}

/**
 * The foot of a sheet: the refusal of the last save in words, then the buttons — what removes the
 * thing at the start, in the destructive tone with its bin, and Cancel and Save at the end.
 */
export function SheetFoot({
  refused,
  remove,
  onRemove,
  save = 'Save',
  saving = false,
  onSave,
  onCancel,
}: SheetFootProps): ReactNode {
  return (
    <>
      {refused !== undefined && (
        <p role="alert" className={REFUSAL}>
          {refused}
        </p>
      )}
      <div className="flex items-center gap-2">
        {remove !== undefined && onRemove !== undefined && (
          <Button variant="destructive" size="sm" onClick={onRemove}>
            <IconTrash size="sm" />
            {remove}
          </Button>
        )}
        <span className="ml-auto flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" state={saving ? 'loading' : 'idle'} onClick={onSave}>
            {save}
          </Button>
        </span>
      </div>
    </>
  )
}

/**
 * A field on its way: its label as a skeleton of its own words, and its box in the skeleton's
 * fill at the box's own height, so the field that arrives takes exactly this room.
 */
export function FieldSkeleton({ label }: { label: string }): ReactNode {
  return (
    <div aria-hidden="true" className="flex flex-col gap-1" data-field-skeleton="">
      <span className="text-sm font-medium">
        <Skeleton>{label}</Skeleton>
      </span>
      <span className="flex h-control-md w-full rounded-md bg-skeleton motion-safe:animate-breathe" />
    </div>
  )
}
