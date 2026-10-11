import { Slider as BaseSlider } from '@base-ui/react/slider'
import { cn } from 'cn'
import type { ReactNode } from 'react'

/**
 * A thumb on a track to pick a number from 0 to 100, on Base UI.
 *
 * Base UI owns what a slider has to do: the role, the arrows, Home and End, the hand dragging the
 * thumb and the value a screen reader hears; this draws it in the theme. The value is the
 * caller's: `onValueChange` follows the thumb as it moves, `onValueCommitted` speaks once, when
 * the hand lets go or a key has moved it, which is when something should be done with it (kept,
 * played) rather than at every step of the drag.
 *
 * The value is read out in percent. The words beside the slider, if any, are the caller's.
 */
const ROOT = 'flex w-full min-w-0 items-center'

const CONTROL = 'flex h-control-sm w-full min-w-0 touch-none items-center select-none'

const TRACK = 'relative h-1 w-full rounded-full bg-border'

const INDICATOR = 'absolute h-full rounded-full primary-fill'

const THUMB =
  'size-icon-md rounded-full border border-primary-strong bg-background outline-none hover-motion focus-ring has-disabled:opacity-50 data-dragging:tinted'

export interface SliderProps {
  /** What the slider is called, read out by its thumb. */
  label: string
  /** The value, from 0 to 100. */
  value: number
  onValueChange: (value: number) => void
  /** The hand let go, or a key moved the thumb: the value to keep. */
  onValueCommitted?: ((value: number) => void) | undefined
  disabled?: boolean | undefined
  /** Where the slider sits; never how it looks. */
  className?: string | undefined
}

export function Slider({
  label,
  value,
  onValueChange,
  onValueCommitted,
  disabled = false,
  className,
}: SliderProps): ReactNode {
  return (
    <BaseSlider.Root
      className={cn(ROOT, className)}
      value={value}
      min={0}
      max={100}
      step={1}
      disabled={disabled}
      thumbAlignment="edge"
      onValueChange={(next) => onValueChange(next)}
      onValueCommitted={(next) => onValueCommitted?.(next)}
    >
      <BaseSlider.Control className={CONTROL}>
        <BaseSlider.Track className={TRACK}>
          <BaseSlider.Indicator className={INDICATOR} />
          <BaseSlider.Thumb
            className={THUMB}
            getAriaLabel={() => label}
            getAriaValueText={(_, next) => `${String(next)} %`}
          />
        </BaseSlider.Track>
      </BaseSlider.Control>
    </BaseSlider.Root>
  )
}
