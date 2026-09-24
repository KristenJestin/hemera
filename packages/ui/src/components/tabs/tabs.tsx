import { Tabs as BaseTabs } from '@base-ui/react/tabs'
import { LayoutGroup, motion } from 'motion/react'
import { type ReactNode, useId, useState } from 'react'

import { arrival, useTransition } from '../../motion.ts'
import { Tooltip } from '../tooltip/tooltip.tsx'

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
 *
 * The mark is a sibling of the tab and never a child of it. A tab is a control with its own
 * padding and its own focus ring, and a mark measured inside one and handed to the next is
 * measured against two different boxes: motion plays the difference, and the line dips below
 * the strip on its way across. Outside the control there is one box, the wrapper, and the mark
 * travels along the strip in a straight line.
 */
const LIST = 'relative flex items-center gap-1 border-b border-border'

/** One tab and the room under it the mark travels through. */
const SLOT = 'relative flex'

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
  /**
   * Whether each tab shows its icon alone, its label kept as the tab's name and said in a tooltip
   * under the hand.
   *
   * For a strip laid in a box narrower than its words: three labelled tabs are wider than the side
   * column of a Session, and a strip wider than its box is a box that scrolls sideways (trial of
   * 23 September 2026). Every item then needs its icon.
   */
  iconsOnly?: boolean | undefined
  /** Where the strip sits; never how it looks. */
  className?: string | undefined
}

export function Tabs<Value extends string>({
  label,
  items,
  value,
  defaultValue,
  onValueChange,
  iconsOnly = false,
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
            <span key={item.value} className={SLOT}>
              {item.value === current && (
                <motion.span layoutId={`${group}-tab`} className={MARK} transition={transition} />
              )}
              {iconsOnly ? (
                <Tooltip label={item.label} side="bottom">
                  <BaseTabs.Tab value={item.value} className={TAB} aria-label={item.label}>
                    {item.icon}
                  </BaseTabs.Tab>
                </Tooltip>
              ) : (
                <BaseTabs.Tab value={item.value} className={TAB}>
                  {item.icon}
                  {item.label}
                </BaseTabs.Tab>
              )}
            </span>
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
