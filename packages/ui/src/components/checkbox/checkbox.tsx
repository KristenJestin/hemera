import { Checkbox as BaseCheckbox } from '@base-ui/react/checkbox'
import { cn } from 'cn'
import { motion } from 'motion/react'
import type { ReactNode } from 'react'

import { check, useTransition } from '../../motion.ts'

/**
 * A box to tick, on Base UI.
 *
 * Every box of the application is this one and never the platform's `<input type="checkbox">`:
 * the platform draws its own box in its own colours and sizes, which no token reaches, and each
 * page that took it wrote its own ring around it. Base UI owns what a checkbox has to do — the
 * role, the state a screen reader hears, Space to toggle, the hidden input a form reads — and
 * this draws it in the theme.
 *
 * The label is the whole target, as a native one is: the box and its words sit in one `<label>`,
 * so a press on the words ticks the box. `hiddenLabel` completes the name for a screen reader
 * where the same visible words sit on every row of a list.
 *
 * The tick is a stroke that draws itself as the box is checked, with a small give of the box,
 * and undraws as it is unchecked, while the fill fades under it.
 */
const ROW = 'flex w-fit items-start gap-2 text-sm text-foreground'

const ROW_DISABLED = 'text-muted-foreground'

const BOX =
  'flex size-icon-md shrink-0 items-center justify-center rounded-sm border border-input bg-background text-primary-foreground outline-none focus-ring check-motion data-checked:border-primary data-checked:bg-primary data-disabled:opacity-50'

const WORDS = 'flex min-w-0 flex-col gap-0.5'

const DESCRIPTION = 'text-xs text-muted-foreground'

export interface CheckboxProps {
  /** Whether the box is ticked. */
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  /** The words beside the box, which are its name. */
  label: ReactNode
  /** A line under the label, in the muted colour: what ticking it does. */
  description?: string | undefined
  /** Words a screen reader hears after the label, where the visible label repeats row by row. */
  hiddenLabel?: string | undefined
  disabled?: boolean | undefined
  /** Where the box sits; never how it looks. */
  className?: string | undefined
}

export function Checkbox({
  checked,
  onCheckedChange,
  label,
  description,
  hiddenLabel,
  disabled = false,
  className,
}: CheckboxProps): ReactNode {
  const give = useTransition(check.press)
  return (
    <label className={cn(ROW, disabled && ROW_DISABLED, className)}>
      <BaseCheckbox.Root
        className={BOX}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(next) => onCheckedChange(next)}
        render={
          // Checked, the box gives a little and comes back; unchecked, it stays where it is.
          <motion.span
            initial={false}
            animate={checked ? check.pressed : { scale: 1 }}
            transition={give}
          />
        }
      >
        {/* Always there rather than in Base UI's indicator, which leaves the moment the box is
            unchecked: the tick has to stay long enough to undraw. */}
        <Tick checked={checked} />
      </BaseCheckbox.Root>
      <span className={WORDS}>
        <span>
          {label}
          {hiddenLabel !== undefined && <span className="sr-only"> {hiddenLabel}</span>}
        </span>
        {description !== undefined && <span className={DESCRIPTION}>{description}</span>}
      </span>
    </label>
  )
}

export interface TickProps {
  /** Whether the tick is drawn; it draws itself in and out as this changes. */
  checked: boolean
  /** Whether it draws itself in as it first appears, rather than appearing drawn. */
  arrives?: boolean | undefined
}

/**
 * The tick of a checkbox, and of whatever else says "chosen" with one: the path of the catalogue's
 * check, drawn in `currentColor` at the small step of the icon scale.
 */
export function Tick({ checked, arrives = false }: TickProps): ReactNode {
  const draw = useTransition(check.draw)
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinejoin="round"
      aria-hidden="true"
      className="size-icon-sm shrink-0"
    >
      {/* Butt ends and not round ones: a round end is a dot even at no length at all, and the
          tick undrawn has to be nothing. */}
      <motion.path
        d="M5 12l5 5l10 -10"
        initial={arrives ? { pathLength: 0 } : false}
        animate={{ pathLength: checked ? 1 : 0 }}
        transition={draw}
      />
    </svg>
  )
}
