import { AnimatePresence, motion } from 'motion/react'
import { type ReactNode, useState } from 'react'

import { STAGE_DOT } from '../../blocks/mission/vocabulary.ts'
import { Button } from '../../components/button/button.tsx'
import { Legend } from '../../components/tooltip/legend.tsx'
import { IconChevronRight, IconFolder, IconLink, IconGauge, IconShieldCheck } from '../../icons.ts'
import { collapse, expand, fold, useTransition } from '../../motion.ts'
import type { Budget, Dependency, Grant, MissionThings } from './building-types.ts'

/**
 * The pieces the Ready and Building pages share: a line that unfolds to what it summarises, and
 * the mission's own things — its dependencies, what was allowed for it, its budget — which no
 * stage owns and every stage folds at the end of its rail.
 */

/** A line that opens what it summarises: the whole width, its chevron turning as it opens. */
export const LINE =
  'flex min-h-control-md w-full min-w-0 items-center gap-2 px-4 py-1.5 text-left text-sm outline-none hover:tinted focus-ring hover-motion'

/** A line that says one thing and leads nowhere. */
export const ROW = 'flex min-h-control-md min-w-0 items-center gap-2 px-4 py-1.5 text-sm'

export const CHEVRON = 'flex shrink-0 text-muted-foreground chevron-motion data-open:rotate-90'

export const QUIET = 'shrink-0 text-xs text-muted-foreground tabular-nums'

export const ID = 'shrink-0 font-mono text-xs text-muted-foreground'

export const CODE =
  'rounded-md border border-border bg-muted px-3 py-2 font-mono text-xs whitespace-pre-wrap break-words'

/** A body that grows from its line and folds back into it, pushing what is under it. */
export function Unfolding({ open, children }: { open: boolean; children: ReactNode }): ReactNode {
  const folding = useTransition(fold)
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          key="body"
          className="overflow-hidden"
          initial={collapse}
          animate={expand}
          exit={collapse}
          transition={folding}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/**
 * One kind of thing summarised in one line — its glyph, its name, what it holds — that unfolds to
 * its own lines. A line that calls for the user wears the warning dot.
 */
export function Fold({
  glyph,
  title,
  detail,
  calls = false,
  initiallyOpen = false,
  children,
}: {
  glyph: ReactNode
  /** Left out for a line whose detail is its name: a path. */
  title?: string | undefined
  detail: string
  calls?: boolean | undefined
  initiallyOpen?: boolean | undefined
  children: ReactNode
}): ReactNode {
  const [open, setOpen] = useState(initiallyOpen)
  return (
    <div className="flex flex-col">
      <button type="button" aria-expanded={open} className={LINE} onClick={() => setOpen(!open)}>
        <span className={CHEVRON} data-open={open ? '' : undefined}>
          <IconChevronRight size="sm" />
        </span>
        <span className="flex shrink-0 text-muted-foreground">{glyph}</span>
        {title !== undefined && <span className="shrink-0 font-medium">{title}</span>}
        <span className="min-w-0 truncate text-muted-foreground">{detail}</span>
        {calls && (
          <span aria-hidden="true" className="ml-auto size-1.5 shrink-0 rounded-full bg-warning" />
        )}
      </button>
      <Unfolding open={open}>{children}</Unfolding>
    </div>
  )
}

const plural = (count: number, one: string, many: string): string =>
  `${String(count)} ${count === 1 ? one : many}`

/** A dependency on one line: its stage's dot, its key, its title, its percentage while it builds. */
function DependencyLine({ dependency }: { dependency: Dependency }): ReactNode {
  return (
    <li className={ROW}>
      <Legend label={dependency.stage}>
        <span className={STAGE_DOT[dependency.stage]} />
      </Legend>
      <span className={ID}>{dependency.key}</span>
      <span className="min-w-0 flex-1 truncate">{dependency.title}</span>
      {dependency.percent !== undefined && (
        <span className={QUIET}>{`${String(dependency.percent)}%`}</span>
      )}
    </li>
  )
}

/** A grant on two lines: the action in words, then who allowed it, when, and how many times used. */
function GrantLine({
  grant,
  onRevoke,
}: {
  grant: Grant
  onRevoke: (id: string) => void
}): ReactNode {
  return (
    <li className="flex min-w-0 items-start gap-2 px-4 py-1.5 text-sm">
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="break-words">{grant.action}</span>
        <span className="text-xs text-muted-foreground">
          {`${grant.by} · ${grant.at} · used ${plural(grant.uses, 'time', 'times')}`}
        </span>
      </span>
      <Button
        variant="ghost"
        size="sm"
        aria-label={`Revoke: ${grant.action}`}
        onClick={() => onRevoke(grant.id)}
      >
        Revoke
      </Button>
    </li>
  )
}

/** What the budget's line says: spent of cap, and whether that is measured or estimated. */
export function budgetWords(budget: Budget): string {
  const spent = budget.estimated ? `≈ ${budget.spent}` : budget.spent
  return budget.cap === null ? `${spent} · no budget` : `${spent} of ${budget.cap}`
}

/** The budget unfolded: the usage, and whether it is measured or an estimate. */
function BudgetBody({ budget }: { budget: Budget }): ReactNode {
  return (
    <div className="flex flex-col gap-1 px-4 pb-2 pl-10 text-sm">
      <p>{budgetWords(budget)}</p>
      <p className="text-xs text-muted-foreground">
        {budget.estimated
          ? 'Estimated: the agent does not report its usage, so Hemera counts it from the words exchanged.'
          : 'Measured: what the agents reported.'}
      </p>
    </div>
  )
}

export interface MissionFoldsProps {
  mission: MissionThings
  /** The mission's Workspace, once it is prepared: a quiet line before the folds. */
  workspace?: string | undefined
  onRevoke: (id: string) => void
}

/**
 * The mission's own things at the end of a rail, one quiet line each and folded: its dependencies,
 * what was allowed for it, its budget. A dependency not Done and a budget nearly spent call.
 */
export function MissionFolds({ mission, workspace, onRevoke }: MissionFoldsProps): ReactNode {
  const { dependencies, grants, budget } = mission
  const waiting = dependencies.filter((dependency) => dependency.stage !== 'Done')
  return (
    <section aria-label="This mission" className="flex flex-col">
      <h2 className="px-4 pb-1 text-xs font-medium text-muted-foreground">This mission</h2>
      {workspace !== undefined && (
        <p className={ROW}>
          <span className="flex shrink-0 pl-6 text-muted-foreground">
            <IconFolder size="sm" />
          </span>
          <span className="shrink-0 font-medium">Workspace</span>
          <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">
            {workspace}
          </span>
        </p>
      )}
      <Fold
        glyph={<IconLink size="sm" />}
        title="Dependencies"
        detail={
          dependencies.length === 0
            ? 'None'
            : waiting.length > 0
              ? `${String(dependencies.length)} · ${waiting.map((one) => one.key).join(', ')} not done`
              : `${String(dependencies.length)} · all done`
        }
        calls={waiting.length > 0}
      >
        <ul aria-label="Dependencies" className="flex flex-col pb-1 pl-6">
          {dependencies.map((dependency) => (
            <DependencyLine key={dependency.key} dependency={dependency} />
          ))}
        </ul>
      </Fold>
      <Fold
        glyph={<IconShieldCheck size="sm" />}
        title="Allowed for this mission"
        detail={grants.length === 0 ? 'Nothing' : String(grants.length)}
      >
        {grants.length === 0 ? (
          <p className="px-4 pb-2 pl-10 text-sm text-muted-foreground">
            Nothing yet. What you allow for this mission is listed here until it ends.
          </p>
        ) : (
          <ul aria-label="Allowed for this mission" className="flex flex-col pb-1 pl-6">
            {grants.map((grant) => (
              <GrantLine key={grant.id} grant={grant} onRevoke={onRevoke} />
            ))}
          </ul>
        )}
      </Fold>
      <Fold
        glyph={<IconGauge size="sm" />}
        title="Budget"
        detail={budgetWords(budget)}
        calls={budget.share !== null && budget.share >= 0.8}
      >
        <BudgetBody budget={budget} />
      </Fold>
    </section>
  )
}
