import { Tabs as BaseTabs } from '@base-ui/react/tabs'
import { LayoutGroup, motion } from 'motion/react'
import { type ReactNode, useId, useState } from 'react'

import { arrival, useTransition } from '../../motion.ts'

/**
 * The tabs, on Base UI (design D2-04).
 *
 * Base UI owns what a tab strip has to do and is easy to get wrong: the arrows walk the strip,
 * the panel is tied to its tab by the identifiers a screen reader follows, and only the active
 * tab is in the tab order — a strip of ten tabs is not ten stops on the way to the content.
 *
 * The mark of the active tab is one element that moves, not one per tab that fades: a shared
 * `layoutId` hands it to whichever tab is active and motion carries it across on `arrival`.
 * That is a transform, so the rule about what may be animated is kept. The group is scoped to
 * this instance, because two tab strips on a page are not one strip with two marks.
 */
const LIST = 'relative flex items-center gap-1 border-b border-border'

const TAB =
  'relative inline-flex h-control-md items-center gap-1.5 rounded-t-md px-3 text-sm font-medium text-muted-foreground outline-none select-none focus-ring data-selected:text-foreground'

const MARK = 'absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-primary'

export interface TabsItem<Value extends string> {
  value: Value
  label: string
  /** One icon of the catalogue, before the label. */
  icon?: ReactNode
  /** What the tab shows when it is the one selected. */
  panel: ReactNode
}

export interface TabsProps<Value extends string> {
  /** What the strip is called, since a strip of tabs is a navigation. */
  label: string
  items: TabsItem<Value>[]
  value?: Value | undefined
  defaultValue?: Value | undefined
  onValueChange?: ((value: Value) => void) | undefined
  /** Where the strip sits; never how it looks. */
  className?: string | undefined
}

export function Tabs<Value extends string>({
  label,
  items,
  value,
  defaultValue,
  onValueChange,
  className,
}: TabsProps<Value>): ReactNode {
  const transition = useTransition(arrival)
  const group = useId()
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
        <LayoutGroup id={group}>
          {items.map((item) => (
            <BaseTabs.Tab key={item.value} value={item.value} className={TAB}>
              {item.icon}
              {item.label}
              {item.value === current && (
                <motion.span layoutId={`${group}-tab`} className={MARK} transition={transition} />
              )}
            </BaseTabs.Tab>
          ))}
        </LayoutGroup>
      </BaseTabs.List>
      {items.map((item) => (
        <BaseTabs.Panel key={item.value} value={item.value} className="pt-3 outline-none">
          {item.panel}
        </BaseTabs.Panel>
      ))}
    </BaseTabs.Root>
  )
}
