/** Where Specs live: in Hemera, following their ticket, or written into the ticket. */
export type SpecModeChoice = 'local' | 'linked' | 'remote'

/** What each mode is called and what it does, in the words under the select. */
export const SPEC_MODE_WORDS: Record<SpecModeChoice, { label: string; does: string }> = {
  local: {
    label: 'Local',
    does: 'The Spec lives in Hemera. A ticket is read once, as the idea of the mission.',
  },
  linked: {
    label: 'Linked',
    does: 'The Spec lives in Hemera and follows its ticket: a change in the ticket is shown to you, never applied on its own.',
  },
  remote: {
    label: 'Remote',
    does: 'Hemera writes the Spec into the ticket, in its eight sections, and reads back what others change there.',
  },
}

/** The languages a Spec can be written in; the current tag is kept even when not listed. */
export const SPEC_LANGUAGES: readonly { value: string; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'es', label: 'Spanish' },
]

/** The language items: the short list, with the current tag kept when it is not in it. */
export function languagesOffered(current: string | null): { value: string; label: string }[] {
  const items = SPEC_LANGUAGES.map((one) => ({ value: one.value, label: one.label }))
  if (current === null || items.some((one) => one.value === current)) return items
  return [{ value: current, label: current }, ...items]
}
