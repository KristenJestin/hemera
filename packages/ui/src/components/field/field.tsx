import { Field } from '@base-ui/react/field'
import { cn } from 'cn'
import { AnimatePresence, motion } from 'motion/react'
import type { KeyboardEvent, ReactNode } from 'react'

import { MARK_TRAVEL, press, useTransition } from '../../motion.ts'

/**
 * The two text controls, on Base UI's `Field`.
 *
 * `Field` is what ties a label, a description and an error to the control without anybody
 * writing an `id`: it generates them, points `aria-describedby` at the right ones, and marks
 * the control invalid when there is an error to show. That is the whole reason it is here —
 * the parts that are easy to forget are the parts a screen reader depends on.
 *
 * The control is drawn a step back from whatever it sits on rather than on the card surface.
 * A dialog is that surface, and a white box on a white sheet is a box the eye has to find by
 * its outline alone; recessed, it reads as somewhere to put something.
 *
 * The ring is on the box around the control and not on the control: an input is a replaced
 * element and renders no pseudo-element, so a ring drawn on it would never appear at all.
 *
 * The error is declared with `match` rather than rendered conditionally, so the element exists
 * for the control to point at from the first render, and it arrives from under the control
 * rather than appearing there: a message that shifts the page without moving is a message the
 * eye misses. It is on the `press` preset, because it answers what was just typed.
 */
const CONTROL =
  'w-full rounded-md border border-input bg-input-fill text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-50 data-invalid:border-destructive'

/**
 * The box of a one-line input: the recessed surface, its edge and its ring are the box's, and the
 * text, the icon before it and the hint after it are laid inside with the same inset from each
 * edge and the same gap between them, at every size. An invalid or disabled control says so on
 * the whole box.
 */
const BOX: Record<'sm' | 'md', string> = {
  sm: 'relative flex h-control-sm min-w-0 flex-1 items-center gap-2 rounded-md border border-input bg-input-fill px-2.5 text-foreground focus-ring has-data-invalid:border-destructive has-disabled:opacity-50',
  md: 'relative flex h-control-md min-w-0 flex-1 items-center gap-2 rounded-md border border-input bg-input-fill px-2.5 text-foreground focus-ring has-data-invalid:border-destructive has-disabled:opacity-50',
}

/** The text itself, borderless inside its box: the box is what is seen. */
const TEXT =
  'h-full min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground'

const LEADING = 'pointer-events-none flex shrink-0 text-muted-foreground'

const TRAILING = 'flex shrink-0 items-center gap-1 text-muted-foreground'

interface FieldShellProps {
  /** What the control is called. Required: a control with no label is a control nobody can use. */
  label: string
  /** A line under the control saying what is expected, when the label is not enough. */
  description?: string | undefined
  /** What is wrong, said in words. Its presence is what makes the control invalid. */
  error?: string | undefined
  disabled?: boolean | undefined
  /** Where the field sits; never how it looks. */
  className?: string | undefined
  children: ReactNode
}

function FieldShell({ label, description, error, disabled, className, children }: FieldShellProps) {
  const transition = useTransition(press)
  return (
    <Field.Root
      disabled={disabled === true}
      invalid={error !== undefined}
      className={cn('flex flex-col gap-1', className)}
    >
      <Field.Label className="text-sm font-medium text-foreground">{label}</Field.Label>
      {children}
      {description !== undefined && (
        <Field.Description className="text-xs text-muted-foreground">
          {description}
        </Field.Description>
      )}
      <AnimatePresence initial={false}>
        {error !== undefined && (
          <Field.Error
            key="error"
            match
            className="text-xs text-destructive-muted-foreground"
            render={
              <motion.p
                initial={{ opacity: 0, y: -MARK_TRAVEL }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -MARK_TRAVEL }}
                transition={transition}
              />
            }
          >
            {error}
          </Field.Error>
        )}
      </AnimatePresence>
    </Field.Root>
  )
}

export interface InputProps extends Omit<FieldShellProps, 'children'> {
  /** One icon of the catalogue, drawn inside the box before the text. */
  icon?: ReactNode
  /**
   * What sits inside the box after the text: the keystroke that reaches the field (`Kbd`) or a
   * small action. Inside, never beside: a hint outside the box is a hint about something else.
   */
  trailing?: ReactNode
  /** `sm` beside small controls, `md` everywhere else. */
  size?: 'sm' | 'md' | undefined
  placeholder?: string | undefined
  defaultValue?: string | undefined
  value?: string | undefined
  onValueChange?: ((value: string) => void) | undefined
  onBlur?: (() => void) | undefined
  onFocus?: (() => void) | undefined
  onKeyDown?: ((event: KeyboardEvent<HTMLInputElement>) => void) | undefined
  /**
   * A control that belongs to the field, drawn on the same line as the box.
   *
   * Here rather than beside the whole field, which is where it used to be: a field is a label,
   * a box, a description and sometimes a message, so a button laid against the bottom of all
   * that sits under the box on a good day and under the description on any other. Inside, it
   * has one thing to line up with.
   */
  action?: ReactNode
}

export function Input({
  label,
  description,
  error,
  disabled,
  className,
  icon,
  trailing,
  size = 'md',
  placeholder,
  defaultValue,
  value,
  onValueChange,
  onBlur,
  onFocus,
  onKeyDown,
  action,
}: InputProps) {
  return (
    <FieldShell
      label={label}
      description={description}
      error={error}
      disabled={disabled}
      className={className}
    >
      <div className="flex items-center gap-2">
        <div className={BOX[size]} data-input-box="">
          {icon !== undefined && (
            <span className={LEADING} data-slot="leading">
              {icon}
            </span>
          )}
          <Field.Control
            placeholder={placeholder}
            defaultValue={defaultValue}
            value={value}
            onValueChange={(next) => onValueChange?.(next)}
            onBlur={() => onBlur?.()}
            onFocus={() => onFocus?.()}
            onKeyDown={(event) => onKeyDown?.(event)}
            className={TEXT}
          />
          {/* A disabled field cannot be reached, so the keystroke that reaches it is not shown. */}
          {trailing !== undefined && disabled !== true && (
            <span className={TRAILING} data-slot="trailing">
              {trailing}
            </span>
          )}
        </div>
        {action}
      </div>
    </FieldShell>
  )
}

export interface TextareaProps extends Omit<InputProps, 'icon'> {
  /** How many lines it shows before the box starts following the text. */
  rows?: number | undefined
}

export function Textarea({
  label,
  description,
  error,
  disabled,
  className,
  rows = 3,
  placeholder,
  defaultValue,
  value,
  onValueChange,
}: TextareaProps) {
  return (
    <FieldShell
      label={label}
      description={description}
      error={error}
      disabled={disabled}
      className={className}
    >
      {/* The box follows the text instead of scrolling it. `field-sizing` is the browser's own
          answer to this, and the renderer is one Chromium we choose: no measuring, no height
          written from JavaScript, no style attribute. */}
      <div className="flex rounded-md focus-ring">
        <Field.Control
          placeholder={placeholder}
          defaultValue={defaultValue}
          value={value}
          onValueChange={(next) => onValueChange?.(next)}
          className={cn(CONTROL, 'field-sizing-content resize-none px-2 py-1.5 text-sm')}
          render={<textarea rows={rows} />}
        />
      </div>
    </FieldShell>
  )
}
