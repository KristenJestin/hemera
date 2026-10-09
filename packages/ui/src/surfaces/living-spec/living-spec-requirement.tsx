import { cn } from 'cn'
import { type ReactNode, useState } from 'react'

import { Button, IconButton } from '../../components/button/button.tsx'
import { Loading, Skeleton } from '../../components/loading/loading.tsx'
import { Legend } from '../../components/tooltip/legend.tsx'
import { Tooltip } from '../../components/tooltip/tooltip.tsx'
import { IconAlertTriangle, IconHistory, IconPencil, IconX } from '../../icons.ts'
import { History, Scenarios } from './living-spec-parts.tsx'
import { originWords } from './living-spec-model.ts'
import type { LivingChange, LivingOrigin, LivingRequirement } from './living-spec-types.ts'

/** The agent's doubt, in its own words, in the warning tone. */
export function Doubt({ text }: { text: string }): ReactNode {
  return (
    <p className="flex max-w-measure items-start gap-1.5 text-xs text-warning-muted-foreground">
      <span className="flex pt-0.5 text-warning">
        <IconAlertTriangle size="sm" aria-hidden="true" />
      </span>
      <span>
        <span className="sr-only">The agent is not sure: </span>
        {text}
      </span>
    </p>
  )
}

const VALIDATED = 'flex min-w-0 flex-col gap-2 rounded-lg border border-border bg-card p-4'

/** A draft: a dashed outline in the warning tone, nothing under it, its words quiet. */
const PROPOSED =
  'flex min-w-0 flex-col gap-2 rounded-lg border border-dashed border-warning p-4 text-muted-foreground'

const ID = 'font-mono text-xs text-muted-foreground'

const TEXT = 'max-w-measure text-sm text-pretty'

/** What a requirement not read yet stands as: three cards of the validated shape. */
export function RequirementSkeletons(): ReactNode {
  return (
    <>
      {[0, 1, 2].map((at) => (
        <li key={at}>
          <div className={VALIDATED}>
            <Skeleton>LR00 · bootstrap</Skeleton>
            <Skeleton>A requirement of the domain, said in one sentence of some length.</Skeleton>
          </div>
        </li>
      ))}
    </>
  )
}

function Origin({
  origin,
  onOrigin,
}: {
  origin: LivingOrigin
  onOrigin: (origin: NonNullable<LivingOrigin>) => void
}): ReactNode {
  if (origin === null) return <span className="text-xs text-muted-foreground">bootstrap</span>
  return (
    <Button variant="link" size="sm" onClick={() => onOrigin(origin)}>
      {originWords(origin)}
    </Button>
  )
}

export interface RequirementCardProps {
  requirement: LivingRequirement
  /** What was read of the history, whether it is folded or not; absent: not read. */
  history: 'loading' | readonly LivingChange[] | undefined
  busy: boolean
  onHistory: (requirementId: string) => void
  onDrop: (requirementId: string) => void
  onOrigin: (origin: NonNullable<LivingOrigin>) => void
}

/**
 * A requirement. Proposed, it is a dashed draft named `proposed`, with Drop; validated, a solid
 * card with its History folding open in place. A re-read's proposal stands beside it, two columns.
 */
export function RequirementCard({
  requirement,
  history,
  busy,
  onHistory,
  onDrop,
  onOrigin,
}: RequirementCardProps): ReactNode {
  const [open, setOpen] = useState(false)
  const proposed = requirement.state === 'proposed'
  const { pending } = requirement
  const toggle = (): void => {
    if (!open) onHistory(requirement.id)
    setOpen(!open)
  }
  const head = (
    <div className="flex min-w-0 items-center gap-2">
      {proposed && (
        <span className="flex text-warning">
          <Legend label="Proposed by the agent, not validated">
            <IconPencil size="sm" />
          </Legend>
        </span>
      )}
      <span className={ID}>{requirement.id}</span>
      <span aria-hidden="true" className="text-xs text-muted-foreground">
        ·
      </span>
      <Origin origin={requirement.origin} onOrigin={onOrigin} />
      <span className="ml-auto flex items-center gap-1">
        {proposed ? (
          <Tooltip label="Drop this proposed requirement">
            <IconButton
              variant="ghost"
              size="sm"
              icon={<IconX size="sm" />}
              aria-label={`Drop ${requirement.id}`}
              state={busy ? 'loading' : 'idle'}
              onClick={() => onDrop(requirement.id)}
            />
          </Tooltip>
        ) : (
          <Tooltip label="History">
            <IconButton
              variant="ghost"
              size="sm"
              icon={<IconHistory size="sm" />}
              aria-label={`History of ${requirement.id}`}
              aria-expanded={open}
              onClick={toggle}
            />
          </Tooltip>
        )}
      </span>
    </div>
  )
  const body = (
    <>
      <p className={cn(TEXT, pending?.kind === 'obsolete' && 'line-through')}>{requirement.text}</p>
      <Scenarios scenarios={requirement.scenarios} />
      {proposed && requirement.uncertainty !== '' && <Doubt text={requirement.uncertainty} />}
      {open && (
        <div className="border-t border-border pt-3">
          {history === undefined || history === 'loading' ? (
            <Loading size="sm" label="Reading the history" />
          ) : (
            <History changes={history} onOrigin={onOrigin} />
          )}
        </div>
      )}
    </>
  )
  if (pending === null) {
    return (
      <article
        className={proposed ? PROPOSED : VALIDATED}
        aria-label={`${requirement.id}, ${proposed ? 'proposed' : 'validated'}`}
      >
        {head}
        {body}
      </article>
    )
  }
  return (
    <div
      className="grid min-w-0 grid-cols-2 gap-3"
      aria-label={`${requirement.id}, a change proposed`}
      role="group"
    >
      <article className={VALIDATED} aria-label="Today">
        <span className="text-xs font-medium text-muted-foreground">Today</span>
        {head}
        {body}
      </article>
      <article className={PROPOSED} aria-label="Proposed">
        <span className="flex items-center gap-1.5 text-xs font-medium text-warning-muted-foreground">
          <IconPencil size="sm" aria-hidden="true" />
          {pending.kind === 'replace' ? 'Proposed instead' : 'Proposed for removal'}
        </span>
        {pending.kind === 'replace' ? (
          <>
            <p className={TEXT}>{pending.text}</p>
            <Scenarios scenarios={pending.scenarios} />
            {pending.uncertainty !== '' && <Doubt text={pending.uncertainty} />}
          </>
        ) : (
          <p className={TEXT}>{pending.reason}</p>
        )}
      </article>
    </div>
  )
}
