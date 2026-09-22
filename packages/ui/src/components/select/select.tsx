import { Select as BaseSelect } from '@base-ui/react/select'
import { cn } from 'cn'
import { type ReactNode, useRef } from 'react'

import { IconCheck, IconChevronDown } from '../../icons.ts'
import { useOverlayContainer } from '../../overlay.ts'
import { Button } from '../button/button.tsx'

/**
 * The select, on Base UI (design D1-04).
 *
 * The list is described rather than composed: a caller hands over items, optionally in named
 * groups, and gets the keyboard, the typeahead, the scrolling and the positioning for free.
 * Values are typed, so choosing from a list is checked at build time rather than compared as
 * strings at run time.
 *
 * The trigger is a button of the catalogue rather than a box that looks like one: it answers
 * the hand exactly as every other control does — it lifts on hover, gives under the press —
 * and its chevron turns over while the list is open, so the control itself says which way it
 * is facing. The list hangs off a wrapper around it and not off the button, or it would ride
 * the press.
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

/**
 * The trigger reads as a control: it is one, and the only thing it adds is a wide label.
 *
 * It fills the wrapper it hangs the list off, so the two are exactly the same width — the list
 * is laid out against the wrapper, and a control a fraction wider than its own anchor is a list
 * that comes up narrower than the thing it belongs to.
 */
const TRIGGER = 'w-full justify-between gap-2 font-normal'

/** Half a turn while the list is open, and back when it closes. */
const CHEVRON = 'flex rotate-0 text-muted-foreground chevron-motion data-popup-open:rotate-180'

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
  /**
   * One mark of the catalogue, drawn at the head of the trigger.
   *
   * The list's `icon` marks an item; this one marks the control, and says what the value is
   * about — which agent these models belong to, what kind of setting is being chosen.
   */
  mark?: ReactNode | undefined
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
  mark,
  disabled,
  className,
}: SelectProps<Value>) {
  const groups = grouped(items)
  const anchor = useRef<HTMLSpanElement>(null)
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
      <span ref={anchor} className={cn('inline-flex', className)}>
        <BaseSelect.Trigger
          aria-label={label}
          nativeButton
          render={<Button variant="secondary" className={TRIGGER} />}
        >
          <span className="flex min-w-0 items-center gap-2">
            {mark}
            <BaseSelect.Value placeholder={placeholder} />
          </span>
          <BaseSelect.Icon className={CHEVRON}>
            <IconChevronDown size="sm" />
          </BaseSelect.Icon>
        </BaseSelect.Trigger>
      </span>
      <BaseSelect.Portal container={container}>
        <BaseSelect.Positioner
          anchor={anchor}
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
