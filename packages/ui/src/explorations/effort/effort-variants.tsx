import { Radio } from '@base-ui/react/radio'
import { RadioGroup } from '@base-ui/react/radio-group'
import { cn } from 'cn'
import type { KeyboardEvent, ReactNode } from 'react'

import { IconButton } from '../../components/button/button.tsx'
import {
  DEFAULT_DOT,
  EffortGauge,
  type EffortControlProps,
  effortLevels,
  LEVEL_WORDS,
} from '../../components/model-picker/model-picker.tsx'
import { IconMinus, IconPlus } from '../../icons.ts'

/**
 * The effort controls the picker could carry under its list, drawn for the choice. The
 * segments are `EffortSegments`, in the picker; these two are the others, and leave once one is
 * chosen.
 */

const ROW = 'flex items-center gap-3 border-t border-border px-2 pt-2'
const LABEL = 'shrink-0 text-xs text-muted-foreground'

const CHIP =
  'flex h-control-sm items-center gap-1 rounded-full border border-border px-2.5 text-xs text-muted-foreground outline-none select-none focus-ring hover-motion hover:text-foreground data-checked:border-primary-strong data-checked:font-medium data-checked:text-primary-foreground data-checked:primary-fill'

/** B. A row of small chips, one per level; the model's default says so in a quiet word. */
export function EffortChips({
  efforts,
  defaultEffort,
  effort,
  onEffort,
}: EffortControlProps): ReactNode {
  const { levels, on, effortOf } = effortLevels(efforts, defaultEffort, effort)
  return (
    <div className={ROW}>
      <span className={LABEL} aria-hidden="true">
        Effort
      </span>
      <RadioGroup
        aria-label="Effort"
        value={on}
        onValueChange={(level) => onEffort(effortOf(level))}
        className="flex min-w-0 flex-1 flex-wrap items-center gap-1"
      >
        {levels.map((level) => (
          <Radio.Root
            key={level}
            value={level}
            aria-label={
              level === defaultEffort
                ? `${LEVEL_WORDS[level]}, the model's default`
                : LEVEL_WORDS[level]
            }
            className={CHIP}
          >
            {LEVEL_WORDS[level]}
            {level === defaultEffort && <span className="font-normal opacity-70">default</span>}
          </Radio.Root>
        ))}
      </RadioGroup>
    </div>
  )
}

/**
 * C. A stepper: less and more on each side of the level — its gauge and its word — which the
 * arrows also walk. Compact, one level shown at a time.
 */
export function EffortStepper({
  efforts,
  defaultEffort,
  effort,
  onEffort,
}: EffortControlProps): ReactNode {
  const { levels, on, effortOf } = effortLevels(efforts, defaultEffort, effort)
  const at = levels.indexOf(on)
  const go = (to: number) => {
    const level = levels[Math.min(Math.max(to, 0), levels.length - 1)]
    if (level !== undefined) onEffort(effortOf(level))
  }
  const walk = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[event.key]
    if (step === undefined) return
    event.preventDefault()
    go(at + step)
  }
  const shown = effortOf(on) ?? defaultEffort
  return (
    <div className={ROW}>
      <span className={LABEL} aria-hidden="true">
        Effort
      </span>
      <div className="flex min-w-0 flex-1 items-center justify-end gap-1">
        <IconButton
          variant="ghost"
          size="sm"
          icon={<IconMinus size="sm" />}
          aria-label="Less effort"
          tabIndex={-1}
          disabled={at <= 0}
          onClick={() => go(at - 1)}
        />
        <div
          role="slider"
          tabIndex={0}
          aria-label="Effort"
          aria-valuemin={0}
          aria-valuemax={levels.length - 1}
          aria-valuenow={at}
          aria-valuetext={
            on === defaultEffort ? `${LEVEL_WORDS[on]}, the model's default` : LEVEL_WORDS[on]
          }
          onKeyDown={walk}
          className="flex h-control-sm w-24 items-center justify-center gap-1.5 rounded-md text-xs font-medium outline-none focus-ring"
        >
          {shown === undefined ? null : <EffortGauge effort={shown} />}
          <span>{LEVEL_WORDS[on]}</span>
          {on === defaultEffort && (
            <span className={cn(DEFAULT_DOT, 'text-muted-foreground')} aria-hidden="true" />
          )}
        </div>
        <IconButton
          variant="ghost"
          size="sm"
          icon={<IconPlus size="sm" />}
          aria-label="More effort"
          tabIndex={-1}
          disabled={at >= levels.length - 1}
          onClick={() => go(at + 1)}
        />
      </div>
    </div>
  )
}
