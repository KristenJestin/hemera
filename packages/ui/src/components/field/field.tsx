import { Field } from '@base-ui/react/field'
import { cn } from 'cn'
import { AnimatePresence, motion } from 'motion/react'
import type { ReactNode } from 'react'

import { MARK_TRAVEL, press, useTransition } from '../../motion.ts'

/**
 * The two text controls, on Base UI's `Field` (design D1-04).
 *
 * `Field` is what ties a label, a description and an error to the control without anybody
 * writing an `id`: it generates them, points `aria-describedby` at the right ones, and marks
 * the control invalid when there is an error to show. That is the whole reason it is here —
 * the parts that are easy to forget are the parts a screen reader depends on.
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
  'w-full rounded-md border border-input bg-card text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-50 data-invalid:border-destructive'

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
  /** One icon of the catalogue, drawn inside the control before the text. */
  icon?: ReactNode
  placeholder?: string | undefined
  defaultValue?: string | undefined
  value?: string | undefined
  onValueChange?: ((value: string) => void) | undefined
}

export function Input({
  label,
  description,
  error,
  disabled,
  className,
  icon,
  placeholder,
  defaultValue,
  value,
  onValueChange,
}: InputProps) {
  return (
    <FieldShell
      label={label}
      description={description}
      error={error}
      disabled={disabled}
      className={className}
    >
      <div className="flex items-center rounded-md focus-ring">
        {icon !== undefined && (
          <span className="pointer-events-none absolute left-2 flex text-muted-foreground">
            {icon}
          </span>
        )}
        <Field.Control
          placeholder={placeholder}
          defaultValue={defaultValue}
          value={value}
          onValueChange={(next) => onValueChange?.(next)}
          className={cn(CONTROL, 'h-control-md px-2 text-sm', icon !== undefined && 'pl-6')}
        />
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
