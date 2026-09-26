import { Menu as BaseMenu } from '@base-ui/react/menu'
import { type ReactNode, useRef } from 'react'

import { useOverlayContainer } from '../../overlay.ts'
import { Button, IconButton } from '../button/button.tsx'
import { Kbd } from '../kbd/kbd.tsx'

/**
 * The menu, on Base UI (design D1-04).
 *
 * A separator is not an item: it is what sits between two groups, so the menu is described as
 * groups of items and the lines fall where they belong. That leaves every entry in the list an
 * actual command, which is what the keyboard walks through.
 *
 * It opens downwards from its trigger and folds back up into it. A menu that grows out of a
 * corner makes the eye hunt for where it came from; one that comes down has already said.
 *
 * The popup hangs off a wrapper around the trigger and not off the trigger itself. A pressed
 * button is a scaled button, its box shrinks with it, and a popup anchored to that box chases
 * the press from under the pointer. The wrapper never moves, so neither does the menu.
 *
 * Base UI returns the focus to the trigger when the menu closes, which is the part a menu is
 * usually missing: leave it out and the keyboard lands back at the top of the page.
 */
const POPUP =
  'min-w-48 rounded-lg border border-border bg-card p-1 text-sm text-card-foreground shadow-lg outline-none translate-y-0 popup-motion data-starting-style:-translate-y-2 data-starting-style:opacity-0 data-ending-style:-translate-y-2 data-ending-style:opacity-0'

const ITEM =
  'flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 outline-none select-none data-highlighted:bg-accent data-disabled:opacity-50'

export interface MenuItem {
  label: string
  /** One icon of the catalogue, before the label. */
  icon?: ReactNode
  /** The keystroke that does the same thing, shown but not bound here. */
  shortcut?: string | undefined
  disabled?: boolean | undefined
  onSelect?: (() => void) | undefined
}

export interface MenuProps {
  /** What the trigger says, and what it is called when it says nothing. */
  label: string
  /**
   * The trigger, when it is not the label: one icon of the catalogue and no word at all.
   *
   * A menu of two commands at the top of a page is a `…` and not two buttons (review of #40,
   * defect 4), and the icon is passed rather than named here because the catalogue is the
   * design system's and this component does not choose which mark a caller means. The label
   * stays the control's name, so the trigger is announced as `Rename or archive this Session`
   * while it is drawn as an ellipsis.
   */
  icon?: ReactNode | undefined
  /** Groups of commands; a separator is drawn between two groups. */
  groups: MenuItem[][]
  disabled?: boolean | undefined
  /**
   * The size of a label trigger, from the scale of the buttons: `sm` beside a small button, the
   * footer of the Spec rail's build (issue #135). An icon trigger is always the small one.
   */
  size?: 'sm' | 'md' | undefined
  /** Where the trigger sits; never how it looks. */
  className?: string | undefined
}

export function Menu({ label, icon, groups, disabled, size = 'md', className }: MenuProps) {
  const anchor = useRef<HTMLSpanElement>(null)
  const container = useOverlayContainer()
  return (
    <BaseMenu.Root>
      <span ref={anchor} className="inline-flex">
        <BaseMenu.Trigger
          disabled={disabled === true}
          render={
            icon === undefined ? (
              // The label is the trigger's own words, and they are the control's name.
              <Button variant="secondary" size={size} className={className} />
            ) : (
              // An icon trigger says nothing, so the label is carried as the accessible name
              // instead: the button is drawn as an ellipsis and announced as what it opens.
              <IconButton
                variant="ghost"
                size="sm"
                icon={icon}
                aria-label={label}
                className={className}
              />
            )
          }
        >
          {icon === undefined ? label : null}
        </BaseMenu.Trigger>
      </span>
      <BaseMenu.Portal container={container}>
        <BaseMenu.Positioner anchor={anchor} side="bottom" align="start" sideOffset={4}>
          <BaseMenu.Popup className={POPUP}>
            {groups.map((group, index) => (
              // A group is a position in the list, and two of them can open on the same
              // command: its place is the only thing that tells it from the next one.
              <BaseMenu.Group key={index}>
                {index > 0 && <BaseMenu.Separator className="my-1 border-t border-border" />}
                {group.map((item) => (
                  <BaseMenu.Item
                    key={item.label}
                    disabled={item.disabled === true}
                    onClick={() => item.onSelect?.()}
                    className={ITEM}
                  >
                    {item.icon}
                    {item.label}
                    {item.shortcut !== undefined && (
                      <Kbd keys={item.shortcut} className="ml-auto" />
                    )}
                  </BaseMenu.Item>
                ))}
              </BaseMenu.Group>
            ))}
          </BaseMenu.Popup>
        </BaseMenu.Positioner>
      </BaseMenu.Portal>
    </BaseMenu.Root>
  )
}
