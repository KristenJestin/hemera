import { Tabs as BaseTabs } from '@base-ui/react/tabs'
import { cn } from 'cn'
import { type ReactNode, useState } from 'react'

import { OVER_MARK, SlidingMark } from '../sliding-mark/sliding-mark.tsx'
import { Tooltip } from '../tooltip/tooltip.tsx'

/**
 * The tabs, on Base UI.
 *
 * Base UI owns what a tab strip has to do and is easy to get wrong: the arrows walk the strip,
 * the panel is tied to its tab by the identifiers a screen reader follows, and only the active
 * tab is in the tab order — a strip of ten tabs is not ten stops on the way to the content.
 *
 * The mark of the active tab is one element that moves, not one per tab that fades: the strip's
 * `SlidingMark`, which travels on `arrival` from the tab it leaves to the tab it is given. It
 * belongs to this strip and to no tab: drawn after all of them, it crosses them
 * and never goes under one, and two strips on a page are two marks.
 */
const LIST = 'relative isolate flex items-center gap-1 border-b border-border'

/** The selected tab is drawn over the mark; the others are crossed by it. */
const TAB =
  'relative inline-flex h-control-md items-center gap-1.5 rounded-t-md px-3 text-sm font-medium text-muted-foreground outline-none select-none focus-ring data-active:z-1 data-active:text-foreground data-disabled:opacity-50'

/** What a tab says, drawn over the mark whichever tab the mark is crossing. */
const CONTENT = 'inline-flex items-center gap-1.5'

const MARK = 'absolute inset-x-2 bottom-0 h-0.5 rounded-full primary-fill'

export interface TabsItem<Value extends string> {
  value: Value
  label: string
  /** One icon of the catalogue, before the label. */
  icon?: ReactNode
  /** What the tab shows when it is the one selected. */
  panel: ReactNode
  /**
   * Why the tab cannot be chosen now: it is then disabled, and this follows its label in its name
   * (and in its tooltip, when it shows its icon alone).
   */
  unavailable?: string | undefined
}

export interface TabsProps<Value extends string> {
  /** What the strip is called, since a strip of tabs is a navigation. */
  label: string
  items: TabsItem<Value>[]
  value?: Value | undefined
  defaultValue?: Value | undefined
  onValueChange?: ((value: Value) => void) | undefined
  /**
   * Whether each tab shows its icon alone, its label kept as the tab's name and said in a tooltip
   * under the hand.
   *
   * For a strip laid in a box narrower than its words: a strip wider than its box is a box that
   * scrolls sideways. Every item then needs its icon.
   */
  iconsOnly?: boolean | undefined
  /** Where the strip sits; never how it looks. */
  className?: string | undefined
}

/** A tab's name: its label, and why it cannot be chosen when it cannot. */
const nameOf = (item: TabsItem<string>): string =>
  item.unavailable === undefined ? item.label : `${item.label} · ${item.unavailable}`

export function Tabs<Value extends string>({
  label,
  items,
  value,
  defaultValue,
  onValueChange,
  iconsOnly = false,
  className,
}: TabsProps<Value>): ReactNode {
  const [chosen, setChosen] = useState<Value | undefined>(defaultValue ?? items[0]?.value)
  const current = value ?? chosen
  return (
    <BaseTabs.Root
      value={current}
      onValueChange={(next: Value) => {
        setChosen(next)
        onValueChange?.(next)
      }}
      className={className}
    >
      <BaseTabs.List activateOnFocus aria-label={label} className={LIST}>
        {items.map((item) =>
          iconsOnly ? (
            <Tooltip key={item.value} label={nameOf(item)} side="bottom">
              <BaseTabs.Tab
                value={item.value}
                data-mark={item.value}
                disabled={item.unavailable !== undefined}
                className={TAB}
                aria-label={nameOf(item)}
              >
                <span className={cn(OVER_MARK, CONTENT)}>{item.icon}</span>
              </BaseTabs.Tab>
            </Tooltip>
          ) : (
            <BaseTabs.Tab
              key={item.value}
              value={item.value}
              data-mark={item.value}
              disabled={item.unavailable !== undefined}
              className={TAB}
              aria-label={item.unavailable === undefined ? undefined : nameOf(item)}
            >
              <span className={cn(OVER_MARK, CONTENT)}>
                {item.icon}
                {item.label}
              </span>
            </BaseTabs.Tab>
          ),
        )}
        {/* Last, so that it is drawn after every tab it can cross. */}
        <SlidingMark target={current ?? null} shape={MARK} />
      </BaseTabs.List>
      {items.map((item) => (
        <BaseTabs.Panel key={item.value} value={item.value} className="pt-3 outline-none">
          {item.panel}
        </BaseTabs.Panel>
      ))}
    </BaseTabs.Root>
  )
}
