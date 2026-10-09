import type { ReactNode } from 'react'

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

/** The props of the Spec fields: mode, language, key prefix and, behind a seam, the sync interval. */
export interface SpecFieldsProps {
  /** Null: being read. */
  mode: SpecModeChoice | null
  /** The modes offered, in order. */
  modes: readonly SpecModeChoice[]
  onMode: (mode: SpecModeChoice) => void
  language: string | null
  onLanguage: (tag: string) => void
  prefix: string | null
  prefixRefused?: string | undefined
  onPrefix: (prefix: string) => void
  /** Absent: the row is not drawn. Drawn only for the linked mode. */
  sync?:
    | {
        minutes: number
        minimum: number
        lastCheck: string | null
        onMinutes: (minutes: number) => void
      }
    | undefined
  refused?: string | undefined
}

/** The frame under the providers: where Specs live, their language, the key prefix. */
export function SpecFields(_props: SpecFieldsProps): ReactNode {
  return null
}
