/**
 * The button that sends a form, which knows on its own whether it may.
 *
 * Subscribed to the form rather than handed a boolean: what makes a form sendable is what the
 * form holds, and a page computing it a second time is a page that will one day disagree with
 * the fields it is drawing. While it is sending it says so, because a second press on a form
 * already on its way is a second Project.
 */

import { useStore } from '@tanstack/react-form'
import type { ReactNode } from 'react'

import { Button } from '../components/button/button.tsx'
import { useFormContext } from './context.ts'

export interface SubmitButtonProps {
  label: string
  /**
   * What it says when nothing has been changed, for a form that edits something that exists.
   *
   * `Saved`, beside a `Save` — a page of settings is looked at far more often than it is
   * changed, and a button offering to save what is already saved is a button that has to be
   * read before it can be ignored. A creation has no such state and leaves this out.
   */
  settledLabel?: string | undefined
  /** `primary` on the one thing a dialog is for, `secondary` where it is one control of many. */
  variant?: 'primary' | 'secondary'
  className?: string | undefined
}

export function SubmitButton({
  label,
  settledLabel,
  variant = 'primary',
  className,
}: SubmitButtonProps): ReactNode {
  const form = useFormContext()
  // Read off the store rather than through `Subscribe`: what this button needs is three values
  // and a render prop returning a button, and a subscription whose child is the whole control
  // is a subscription the control is rebuilt by on every keystroke.
  // `isValid` and not `canSubmit`: the latter is false for as long as any validator is running,
  // and one of ours asks a disk whether a folder is there. A button that went quiet every time a
  // path was typed into would be a button nobody could press. What `handleSubmit` does is wait
  // for those validators anyway, and refuse on its own if the answer comes back no.
  const canSubmit = useStore(form.store, (state) => state.isValid)
  const isSubmitting = useStore(form.store, (state) => state.isSubmitting)
  const isDirty = useStore(form.store, (state) => state.isDirty)
  // Nothing changed is nothing to send, in both shapes of form: a creation opens empty and has
  // to be typed into before it can create anything, and a page of settings opens on what is
  // already saved. The label is the only difference — `Saved` where there is something to have
  // been saved, and the word of the action where there is not.
  const settled = !isDirty
  return (
    <Button
      variant={variant}
      className={className}
      disabled={!canSubmit || isSubmitting || settled}
      state={isSubmitting ? 'loading' : 'idle'}
      onClick={() => void form.handleSubmit()}
    >
      {settled && settledLabel !== undefined ? settledLabel : label}
    </Button>
  )
}
