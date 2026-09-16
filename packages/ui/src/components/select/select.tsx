import { Select as BaseSelect } from '@base-ui/react/select'
import { cn } from 'cn'
import type { ReactNode } from 'react'

import { IconCheck, IconChevronDown } from '../../icons.ts'
import { useOverlayContainer } from '../../overlay.ts'

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
 * to be told when the popup is gone. It comes down from the trigger and folds back up into it,
 * so the direction says where it came from. Opacity and transform only, on the theme's curve.
 */
const POPUP =
  'max-h-64 min-w-(--anchor-width) overflow-auto rounded-lg border border-border bg-card p-1 text-sm text-card-foreground shadow-lg outline-none translate-y-0 popup-motion data-starting-style:-translate-y-2 data-starting-style:opacity-0 data-ending-style:-translate-y-2 data-ending-style:opacity-0'

const ITEM =
  'flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 outline-none select-none data-highlighted:bg-accent data-disabled:opacity-50'

export interface SelectItem<Value extends string> {
  value: Value
  label: string
  /** One icon of the catalogue, before the label and in the list's own colour. */
  icon?: ReactNode
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
  const container = useOverlayContainer()
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
          'flex h-control-md items-center justify-between gap-2 rounded-md border border-input bg-card px-2 text-sm text-foreground outline-none focus-ring data-disabled:opacity-50',
          className,
        )}
      >
        <BaseSelect.Value placeholder={placeholder} />
        <BaseSelect.Icon className="flex text-muted-foreground">
          <IconChevronDown size="sm" />
        </BaseSelect.Icon>
      </BaseSelect.Trigger>
      <BaseSelect.Portal container={container}>
        <BaseSelect.Positioner
          // Base UI would otherwise lay the chosen item over the trigger, the way a native
          // macOS menu does — the list covers the control it belongs to and the eye loses
          // where it came from. It opens below, like every other popup here.
          alignItemWithTrigger={false}
          side="bottom"
          align="start"
          sideOffset={4}
        >
          {/* The list carries the control's name too: while it is closing it is still in the
              page, and a list of options with no name is a list a screen reader cannot place. */}
          <BaseSelect.Popup aria-label={label} className={POPUP}>
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
      {item.icon}
      <BaseSelect.ItemText>{item.label}</BaseSelect.ItemText>
      {/* The mark sits after the label, where the eye ends up rather than where it starts:
          a list is read down its left edge, and a column of empty space before every word
          pushes the words away from it for the sake of one item. */}
      <span className="ml-auto flex w-icon-sm justify-center text-primary">
        <BaseSelect.ItemIndicator>
          <IconCheck size="sm" />
        </BaseSelect.ItemIndicator>
      </span>
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
