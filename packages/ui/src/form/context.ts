/**
 * The two contexts every form of the design system is built on (design D4-07).
 *
 * Their own file, and not the one the hook is in: `createFormHook` takes them and the field
 * components read them, so a single module holding both would have the components importing
 * the hook that imports the components.
 */

import { createFormHookContexts } from '@tanstack/react-form'

export const { fieldContext, formContext, useFieldContext, useFormContext } =
  createFormHookContexts()
