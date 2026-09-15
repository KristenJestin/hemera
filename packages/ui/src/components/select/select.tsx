import { Select as BaseSelect } from '@base-ui/react/select'
import { cn } from 'cn'
import type { ReactNode } from 'react'

import { IconCheck, IconChevronDown } from '../../icons.ts'

/**
 * The select, on Base UI (design D1-04).
 *
 * The list is described rather than composed: a caller hands over items, optionally in named
 * groups, and gets the keyboard, the typeahead, the scrolling and the positioning for free.
 * Values are typed, so choosing from a list is checked at build time rather than compared as
 * strings at run time.
 *
 * The popup animates in CSS through Base UI's `data-starting-style`, not through motion: the
 * element enters and leaves with the popup itself, and a spring driven from React would have
 * to be told when the popup is gone. Opacity and transform only, on the theme's own curve.
 */
const POPUP =
  'max-h-64 overflow-auto rounded-lg border border-border bg-card p-1 text-sm text-card-foreground shadow-lg outline-none popup-motion data-starting-style:scale-95 data-starting-style:opacity-0 data-ending-style:scale-95 data-ending-style:opacity-0'

const ITEM =
  'flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 outline-none select-none data-highlighted:bg-accent data-disabled:opacity-50'

export interface SelectItem<Value extends string> {
  value: Value
  label: string
  disabled?: boolean | undefined
}

export interface SelectGroup<Value extends string> {
  label: string
  items: SelectItem<Value>[]
}

export interface SelectProps<Value extends string> {
  /** What the control is called, read out by the trigger. */
  label: string
  /** The items to choose from, flat or in named groups. */
  items: SelectItem<Value>[] | SelectGroup<Value>[]
  value?: Value | undefined
  defaultValue?: Value | undefined
  onValueChange?: ((value: Value) => void) | undefined
  placeholder?: string | undefined
  disabled?: boolean | undefined
  /** Where the select sits; never how it looks. */
  className?: string | undefined
}

export function Select<Value extends string>({
  label,
  items,
  value,
  defaultValue,
  onValueChange,
  placeholder = 'Choose',
  disabled,
  className,
}: SelectProps<Value>) {
  const groups = grouped(items)
  return (
    <BaseSelect.Root
      items={groups.flatMap((group) => group.items)}
      value={value}
      defaultValue={defaultValue}
      // Base UI can report a cleared selection; this select is never clearable, so there is
      // nothing to say when it happens.
      onValueChange={(next) => {
        if (next !== null) onValueChange?.(next)
      }}
      disabled={disabled === true}
    >
      <BaseSelect.Trigger
        aria-label={label}
        className={cn(
          'flex h-8 items-center justify-between gap-2 rounded-md border border-input bg-card px-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring data-disabled:opacity-50',
          className,
        )}
      >
        <BaseSelect.Value placeholder={placeholder} />
        <BaseSelect.Icon className="flex text-muted-foreground">
          <IconChevronDown size="sm" />
        </BaseSelect.Icon>
      </BaseSelect.Trigger>
      <BaseSelect.Portal>
        <BaseSelect.Positioner sideOffset={4}>
          <BaseSelect.Popup className={POPUP}>
            {groups.map((group, index) => (
              <Section key={group.label === '' ? index : group.label} group={group} />
            ))}
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  )
}

/** One group of the list, named or not. An unnamed group is just the list itself. */
function Section<Value extends string>({ group }: { group: SelectGroup<Value> }): ReactNode {
  const list = group.items.map((item) => (
    <BaseSelect.Item
      key={item.value}
      value={item.value}
      disabled={item.disabled === true}
      className={ITEM}
    >
      <BaseSelect.ItemIndicator className="flex text-primary">
        <IconCheck size="sm" />
      </BaseSelect.ItemIndicator>
      <BaseSelect.ItemText>{item.label}</BaseSelect.ItemText>
    </BaseSelect.Item>
  ))

  if (group.label === '') return list
  return (
    <BaseSelect.Group>
      <BaseSelect.GroupLabel className="px-2 py-1 text-xs font-medium text-muted-foreground">
        {group.label}
      </BaseSelect.GroupLabel>
      {list}
    </BaseSelect.Group>
  )
}

/** The items as groups, whichever of the two shapes the caller handed over. */
function grouped<Value extends string>(
  items: SelectItem<Value>[] | SelectGroup<Value>[],
): SelectGroup<Value>[] {
  const [first] = items
  if (first === undefined) return []
  if ('items' in first) {
    // SAFETY: the element carries `items`, which only a group has, and the array is homogeneous.
    const groups = items as SelectGroup<Value>[]
    return groups
  }
  // SAFETY: same check, the other way round: no element carries `items`, so all are plain items.
  const flat = items as SelectItem<Value>[]
  return [{ label: '', items: flat }]
}
