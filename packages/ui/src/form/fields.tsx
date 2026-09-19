/**
 * The fields a form of this design system is written with (design D4-07).
 *
 * Each of them reads the field it is inside rather than being handed a value and a setter: that
 * is what `createFormHook` is for, and it is what keeps a form to the shape of what it holds
 * instead of a list of `useState` beside a list of props. What they draw is the same `Input`
 * everything else draws — a field is a field, and a form does not get its own look.
 *
 * What is wrong is shown once the field has been left and not while it is being typed into: a
 * message that appears on the second character of a name is a message about a name nobody has
 * finished writing. The one exception is a message that came back from somewhere else — the
 * disk, the engine — which is about what is already there.
 */

import type { ReactNode } from 'react'
import { z } from 'zod'

import { Button } from '../components/button/button.tsx'
import { Input } from '../components/field/field.tsx'
import { ToneSwatches } from '../components/tone-swatches/tone-swatches.tsx'
import type { ProjectTone } from '../shell/model.ts'
import { useFieldContext } from './context.ts'

/**
 * What a field is allowed to say, once it is worth saying.
 *
 * Parsed rather than inspected: what a validator raised is a string from one of ours and an
 * issue from a schema, and which of the two it is, is exactly the kind of question a parser
 * answers and a chain of `typeof` only appears to.
 */
const saidSchema = z.union([
  z.string(),
  z.object({ message: z.string() }).transform((issue) => issue.message),
])

function saidOf(meta: { isTouched: boolean; errors: readonly unknown[] }): string | undefined {
  if (!meta.isTouched) return undefined
  const said = saidSchema.safeParse(meta.errors[0])
  return said.success ? said.data : undefined
}

export interface TextFieldProps {
  label: string
  description?: string | undefined
  placeholder?: string | undefined
  className?: string | undefined
  /** A control of the field, on the same line as its box. */
  action?: ReactNode
}

export function TextField({
  label,
  description,
  placeholder,
  className,
  action,
}: TextFieldProps): ReactNode {
  const field = useFieldContext<string>()
  return (
    <Input
      label={label}
      description={description}
      placeholder={placeholder}
      className={className}
      error={saidOf(field.state.meta)}
      value={field.state.value}
      onValueChange={(next) => field.handleChange(next)}
      onBlur={field.handleBlur}
      action={action}
    />
  )
}

export interface PathFieldProps extends TextFieldProps {
  /** Asks the system for a folder, and answers null when the picker was dismissed. */
  onBrowse: () => Promise<string | null>
  /** The word on the button that opens it: `Browse…` when empty, `Change…` when not. */
  browseLabel?: string | undefined
}

/**
 * A folder, typed or chosen.
 *
 * The button is inside the field and not beside it, so it lines up with the box rather than
 * with the bottom of everything the field draws. Typing stays possible on purpose: a path can
 * be pasted, and a Workspace can be declared before the folder exists.
 */
export function PathField({ onBrowse, browseLabel = 'Browse…', ...rest }: PathFieldProps) {
  const field = useFieldContext<string>()
  return (
    <TextField
      {...rest}
      action={
        <Button
          variant="secondary"
          className="shrink-0"
          onClick={() => {
            void onBrowse().then((chosen) => {
              if (chosen !== null) {
                field.handleChange(chosen)
                field.handleBlur()
              }
            })
          }}
        >
          {browseLabel}
        </Button>
      }
    />
  )
}

/** The dot a Project wears, which is a choice of five and never a colour written anywhere. */
export function ToneField({ label }: { label: string }): ReactNode {
  const field = useFieldContext<ProjectTone>()
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium text-foreground">{label}</p>
      <ToneSwatches value={field.state.value} onValueChange={(next) => field.handleChange(next)} />
    </div>
  )
}
