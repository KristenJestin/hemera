/**
 * The form hook of the design system (design D4-07).
 *
 * Every form of the application is built with this one and with the fields registered on it, so
 * what a form holds is declared once — its values, its schema, what it does on submit — and the
 * fields are bound to it by name rather than wired by hand. A mistyped name does not compile,
 * which is the whole reason the components are registered here instead of imported per form.
 *
 * Validation is a standard schema, which is what Zod is: the same library the channels are
 * declared with, so what a form refuses and what the engine refuses are written the same way.
 * What only a disk can answer — whether a folder is there — is an asynchronous validator on the
 * field, because the renderer has no disk and the answer is worth waiting for.
 */

import { createFormHook } from '@tanstack/react-form'

import { fieldContext, formContext } from './context.ts'
import { PathField, TextField, ToneField } from './fields.tsx'
import { SubmitButton } from './submit-button.tsx'

export const { useAppForm, withForm } = createFormHook({
  fieldContext,
  formContext,
  fieldComponents: { TextField, PathField, ToneField },
  formComponents: { SubmitButton },
})
