import { cn } from 'cn'
import { AnimatePresence, motion } from 'motion/react'
import { type ReactNode, useState } from 'react'

import { Button } from '../../components/button/button.tsx'
import { Skeleton } from '../../components/loading/loading.tsx'
import { ProjectMark } from '../../components/project-mark/project-mark.tsx'
import { IconChevronRight } from '../../icons.ts'
import { collapse, expand, fold, useTransition } from '../../motion.ts'
import { NeedCard, type NeedCardProps, NeedGlyph, type NeedKind } from './need-card.tsx'

/**
 * Needs you, across every Project: one row per need, in the order they wait in — the
 * application's first, then each Project's, the oldest first in each.
 *
 * A row is the Project's mark (Hemera's own for a need of the application), the mission's key, the
 * kind's glyph, the title, what the agent wrote cut to the row, and when. Its button, "<action>
 * here", unfolds the whole need card under the row, pushing the rows below it, with a way to the
 * mission under the card. The rows are the same height loading as loaded.
 *
 * A need that arrives grows into its place and pushes the rows under it; one answered or expired
 * becomes its card's faint line where its row was, and folds out of the list when it leaves.
 */
export interface NeedRow {
  id: string
  /** The Project the need belongs to; `Hemera` for a need of the application. */
  project: string
  /** The card the row unfolds to, without its handlers: the list hands them in. */
  need: Omit<
    NeedCardProps,
    | 'onOpenMission'
    | 'onPermission'
    | 'onChoose'
    | 'onWrite'
    | 'onApply'
    | 'onLook'
    | 'onRetry'
    | 'onSettings'
    | 'onDiscuss'
  >
}

export interface NeedsYouListProps {
  rows: readonly NeedRow[]
  /** The names of the Projects, which decide whether a mark is one letter or two. */
  projects?: readonly string[] | undefined
  loading?: boolean | undefined
  /** Which row is open at first; none unless said. */
  open?: string | undefined
  /** Where a need's mission opens; without it, the unfolded card offers no way to it. */
  onOpenMission?: ((id: string) => void) | undefined
  /** Every answer a card gives, with the need it answers. */
  on: (
    id: string,
  ) => Pick<
    NeedCardProps,
    | 'onPermission'
    | 'onChoose'
    | 'onWrite'
    | 'onApply'
    | 'onLook'
    | 'onRetry'
    | 'onSettings'
    | 'onDiscuss'
  >
}

/** What the row's button says it does, by kind: the need is answered in place. */
const ACTIONS: Record<NeedKind, string> = {
  permission: 'Answer here',
  decision: 'Answer here',
  error: 'Choose here',
  environment: 'Retry here',
}

const ROW = 'flex h-control-md min-w-0 items-center gap-3 px-4 text-sm'
const KEY = 'w-16 shrink-0 font-mono text-xs text-muted-foreground'
const TITLE = 'min-w-0 shrink truncate font-medium'
const DETAIL = 'min-w-0 flex-1 truncate text-muted-foreground'
const WHEN = 'shrink-0 text-xs text-muted-foreground tabular-nums'
const RULE = 'border-b border-border last:border-b-0'
/** A row, clipped while it grows in or folds out. */
const PLACE = cn(RULE, 'overflow-hidden')

function Row({
  row,
  projects,
  opened,
  onToggle,
  onOpenMission,
  on,
}: {
  row: NeedRow
  projects: readonly string[] | undefined
  opened: boolean
  onToggle: () => void
  onOpenMission: (() => void) | undefined
  on: ReturnType<NeedsYouListProps['on']>
}): ReactNode {
  const folding = useTransition(fold)
  const { need } = row
  const kind = need.ask.kind
  const settled = need.status !== undefined && need.status.state !== 'waiting'
  return (
    <motion.li
      className={PLACE}
      data-need={row.id}
      initial={collapse}
      animate={expand}
      exit={collapse}
      transition={folding}
    >
      {settled ? (
        <div className="px-4 py-1">
          <NeedCard {...need} missionKey={undefined} />
        </div>
      ) : (
        <div className={ROW}>
          <ProjectMark name={row.project} others={projects} legend />
          <span className={KEY}>{need.missionKey ?? ''}</span>
          <NeedGlyph kind={kind} />
          <span className={TITLE}>{need.title}</span>
          <span className={DETAIL}>{need.text ?? ''}</span>
          <span className={WHEN}>{need.when}</span>
          <Button size="sm" aria-expanded={opened} onClick={onToggle}>
            {ACTIONS[kind]}
          </Button>
        </div>
      )}
      <AnimatePresence initial={false}>
        {opened && !settled && (
          <motion.div
            className="overflow-hidden"
            initial={collapse}
            animate={expand}
            exit={collapse}
            transition={folding}
          >
            <div className="flex flex-col gap-2 px-4 pb-4">
              <NeedCard {...need} missionKey={undefined} {...on} />
              {need.missionKey !== undefined && onOpenMission !== undefined && (
                <Button variant="link" className="self-start" onClick={onOpenMission}>
                  Open {need.missionKey}
                  <IconChevronRight size="sm" aria-hidden="true" />
                </Button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.li>
  )
}

/** A row's shape while the rows are on their way. */
function RowSkeleton(): ReactNode {
  return (
    <li aria-hidden="true" className={RULE} data-row-skeleton="">
      <span className={ROW}>
        <Skeleton shape="block">
          <ProjectMark name="A" />
        </Skeleton>
        <span className={KEY}>
          <Skeleton>ACME-12</Skeleton>
        </span>
        <span className={TITLE}>
          <Skeleton>Which table holds the invoices?</Skeleton>
        </span>
        <span className={DETAIL} />
        <span className={WHEN}>
          <Skeleton>4 min</Skeleton>
        </span>
      </span>
    </li>
  )
}

export function NeedsYouList({
  rows,
  projects,
  loading = false,
  open,
  onOpenMission,
  on,
}: NeedsYouListProps): ReactNode {
  const [opened, setOpened] = useState<string | null>(open ?? null)
  if (loading) {
    return (
      <ul aria-label="Needs you" aria-busy="true" className="flex flex-col">
        <RowSkeleton />
        <RowSkeleton />
        <RowSkeleton />
      </ul>
    )
  }
  if (rows.length === 0) {
    return <p className="px-4 py-3 text-sm text-muted-foreground">Nothing waits for you.</p>
  }
  return (
    <ul aria-label="Needs you" className="flex flex-col">
      <AnimatePresence initial={false}>
        {rows.map((row) => (
          <Row
            key={row.id}
            row={row}
            projects={projects}
            opened={opened === row.id}
            onToggle={() => setOpened(opened === row.id ? null : row.id)}
            onOpenMission={onOpenMission === undefined ? undefined : () => onOpenMission(row.id)}
            on={on(row.id)}
          />
        ))}
      </AnimatePresence>
    </ul>
  )
}
