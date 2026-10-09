import type { ReactNode } from 'react'

import { Frame } from '../../components/frame/frame.tsx'
import { Input } from '../../components/field/field.tsx'
import { SectionHead } from '../../components/section-head/section-head.tsx'
import { Select } from '../../components/select/select.tsx'
import { IconFileText } from '../../icons.ts'
import { Section, SectionRefusal } from './parts.tsx'

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

/** How often a linked ticket can be read again, in minutes, with the words that offer it. */
const SYNC_INTERVALS: readonly { minutes: number; label: string }[] = [
  { minutes: 15, label: 'Every 15 minutes' },
  { minutes: 30, label: 'Every 30 minutes' },
  { minutes: 60, label: 'Every hour' },
  { minutes: 240, label: 'Every 4 hours' },
  { minutes: 1440, label: 'Once a day' },
]

/** The intervals offered: none under the minimum, and the current one even when not listed. */
function intervalsOffered(minutes: number, minimum: number): { value: string; label: string }[] {
  const listed = SYNC_INTERVALS.filter((one) => one.minutes >= minimum || one.minutes === minutes)
  const offered = listed.some((one) => one.minutes === minutes)
    ? listed
    : [...listed, { minutes, label: `Every ${minutes} minutes` }].toSorted(
        (a, b) => a.minutes - b.minutes,
      )
  return offered.map((one) => ({ value: String(one.minutes), label: one.label }))
}

/** The language items: the short list, with the current tag kept when it is not in it. */
function languagesOffered(current: string | null): { value: string; label: string }[] {
  const items = SPEC_LANGUAGES.map((one) => ({ value: one.value, label: one.label }))
  if (current === null || items.some((one) => one.value === current)) return items
  return [{ value: current, label: current }, ...items]
}

/** The frame under the providers: where Specs live, their language, the key prefix. */
export function SpecFields({
  mode,
  modes,
  onMode,
  language,
  onLanguage,
  prefix,
  prefixRefused,
  onPrefix,
  sync,
  refused,
}: SpecFieldsProps): ReactNode {
  return (
    <Section label="Specs">
      <SectionHead title="Specs" />
      <SectionRefusal error={refused} />
      <Frame>
        <div className="flex flex-col gap-5 p-4">
          <div className="flex flex-col gap-1.5">
            <Select
              label="Where Specs live"
              mark={<IconFileText size="sm" />}
              items={modes.map((one) => ({ value: one, label: SPEC_MODE_WORDS[one].label }))}
              value={mode ?? undefined}
              disabled={mode === null}
              onValueChange={onMode}
            />
            {mode !== null && (
              <p className="max-w-measure text-xs text-muted-foreground">
                {SPEC_MODE_WORDS[mode].does}
              </p>
            )}
          </div>
          <Select
            label="Spec language"
            items={languagesOffered(language)}
            value={language ?? undefined}
            disabled={language === null}
            onValueChange={onLanguage}
          />
          {mode === 'linked' && sync !== undefined && (
            <div className="flex flex-col gap-1.5">
              <Select
                label="Check linked tickets"
                items={intervalsOffered(sync.minutes, sync.minimum)}
                value={String(sync.minutes)}
                onValueChange={(value) => sync.onMinutes(Number(value))}
              />
              <p className="text-xs text-muted-foreground">
                {sync.lastCheck === null ? 'Not checked yet' : `Last checked at ${sync.lastCheck}`}
              </p>
            </div>
          )}
          <Input
            label="Key prefix"
            value={prefix ?? ''}
            disabled={prefix === null}
            onValueChange={onPrefix}
            error={prefixRefused}
            description={`Only the next missions change: ${prefix ?? ''}-13 and after. ACME-12 keeps its key.`}
          />
        </div>
      </Frame>
    </Section>
  )
}
