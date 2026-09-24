import { Checkbox as BaseCheckbox } from '@base-ui/react/checkbox'
import { cn } from 'cn'
import type { ReactNode } from 'react'

import { IconCheck } from '../../icons.ts'

/**
 * A box to tick, on Base UI (recette of 24 September 2026).
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
 */
const ROW = 'flex w-fit items-start gap-2 text-sm text-foreground'

const ROW_DISABLED = 'text-muted-foreground'

const BOX =
  'flex size-icon-md shrink-0 items-center justify-center rounded-sm border border-input bg-background text-primary-foreground outline-none focus-ring data-checked:border-primary data-checked:bg-primary data-disabled:opacity-50'

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
  return (
    <label className={cn(ROW, disabled && ROW_DISABLED, className)}>
      <BaseCheckbox.Root
        className={BOX}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(next) => onCheckedChange(next)}
      >
        <BaseCheckbox.Indicator className="flex">
          <IconCheck size="sm" aria-hidden="true" />
        </BaseCheckbox.Indicator>
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
