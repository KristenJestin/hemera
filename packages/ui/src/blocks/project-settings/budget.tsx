import type { ReactNode } from 'react'

import { IconButton } from '../../components/button/button.tsx'
import { Input } from '../../components/field/field.tsx'
import { Frame } from '../../components/frame/frame.tsx'
import { SectionHead } from '../../components/section-head/section-head.tsx'
import { Tooltip } from '../../components/tooltip/tooltip.tsx'
import { IconX } from '../../icons.ts'
import { FieldSkeleton, Section, SectionRefusal } from './parts.tsx'

/**
 * How much a mission of the Project may run, in a section of its settings: the cap — how many
 * sub-agents run at once — and the budget of each mission — how many launches (Probes, helpers,
 * reviewers), automatic retries and automatic rounds. A launch beyond the cap waits; a mission at
 * the end of its budget asks the user.
 *
 * Each field is empty until the user writes in it, and empty is the application's value, which the
 * field shows in its quiet tone — as the Workspaces fields show theirs — so what applies is always
 * read in the field. A field written in carries the × that empties it. A value that is not a whole
 * number is said under its field.
 */
export interface BudgetLimit {
  id: string
  label: string
  /** What the user wrote, or null for the application's value. */
  value: string | null
  /** The application's value, which applies while the field is empty. */
  fallback: number
}

export interface BudgetSectionProps {
  /** The cap first, then the budget of a mission. */
  limits: readonly BudgetLimit[]
  loading?: boolean | undefined
  /** What a field now holds; null once it is emptied. */
  onLimit: (id: string, value: string | null) => void
  /** What the engine refuses in a field's value, in words; undefined for nothing. */
  refusalOf: (id: string, value: string | null) => string | undefined
  /** A write the engine refused, in words: the fields stand as the engine keeps them. */
  error?: string | undefined
}

const GROUP = 'flex flex-col gap-3 p-4'

const GROUP_TITLE = 'text-sm font-medium'

const FIELDS = 'grid grid-cols-1 items-start gap-4 sm:grid-cols-3'

const CAP = 'grid grid-cols-1 items-start gap-4 sm:grid-cols-3'

function LimitField({
  limit,
  onLimit,
  refusalOf,
}: {
  limit: BudgetLimit
  onLimit: (id: string, value: string | null) => void
  refusalOf: (id: string, value: string | null) => string | undefined
}): ReactNode {
  return (
    <Input
      label={limit.label}
      placeholder={String(limit.fallback)}
      value={limit.value ?? ''}
      error={refusalOf(limit.id, limit.value)}
      onValueChange={(value) => onLimit(limit.id, value.trim() === '' ? null : value)}
      trailing={
        limit.value === null ? undefined : (
          <Tooltip label="Back to the default">
            <IconButton
              variant="ghost"
              size="sm"
              icon={<IconX size="sm" />}
              aria-label={`Back to the default ${limit.label.toLowerCase()}`}
              onClick={() => onLimit(limit.id, null)}
            />
          </Tooltip>
        )
      }
    />
  )
}

export function BudgetSection({
  limits,
  loading = false,
  onLimit,
  refusalOf,
  error,
}: BudgetSectionProps): ReactNode {
  const [cap, ...budget] = limits
  return (
    <Section label="Cap and budget">
      <SectionHead title="Cap and budget" />
      <SectionRefusal error={error} />
      <Frame>
        <div className={GROUP} aria-busy={loading}>
          <div className={CAP}>
            {loading ? (
              <FieldSkeleton label="Sub-agents at once" />
            ) : (
              cap !== undefined && (
                <LimitField limit={cap} onLimit={onLimit} refusalOf={refusalOf} />
              )
            )}
          </div>
        </div>
        <div className="border-t border-border">
          <div className={GROUP}>
            <span className={GROUP_TITLE}>Each mission</span>
            <div className={FIELDS}>
              {loading ? (
                <>
                  <FieldSkeleton label="Launches" />
                  <FieldSkeleton label="Automatic retries" />
                  <FieldSkeleton label="Automatic rounds" />
                </>
              ) : (
                budget.map((limit) => (
                  <LimitField
                    key={limit.id}
                    limit={limit}
                    onLimit={onLimit}
                    refusalOf={refusalOf}
                  />
                ))
              )}
            </div>
          </div>
        </div>
      </Frame>
    </Section>
  )
}
