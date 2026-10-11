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
 *
 * The permissions one agent asked for while several of them still wait share one row, where the
 * first of them stands: how many wait and from whom, what they ask, "Allow these" (Allow once for
 * each), and "Answer here", which unfolds their own rows.
 */
export interface NeedRow {
  id: string
  /** The Project the need belongs to; `Hemera` for a need of the application. */
  project: string
  /**
   * The agent that asked, for a permission: the requests of one agent wait on one row, with their
   * count and "Allow these", and unfold to their own rows.
   */
  agent?: { id: string; name: string } | undefined
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

const ROW = 'flex h-control-md min-w-0 items-center gap-2 px-4 text-sm'
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
          {/* The action keeps its width: the title and what the agent wrote give way first. */}
          <span className="flex shrink-0">
            <Button size="sm" aria-expanded={opened} onClick={onToggle}>
              {ACTIONS[kind]}
            </Button>
          </span>
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

/** The requests of one agent, on one row that unfolds to theirs. */
function GroupRow({
  rows,
  projects,
  opened,
  openedRow,
  onToggle,
  onToggleRow,
  onOpenMission,
  on,
}: {
  rows: readonly NeedRow[]
  projects: readonly string[] | undefined
  opened: boolean
  openedRow: string | null
  onToggle: () => void
  onToggleRow: (id: string) => void
  onOpenMission: NeedsYouListProps['onOpenMission']
  on: NeedsYouListProps['on']
}): ReactNode {
  const folding = useTransition(fold)
  const waiting = rows.filter((row) => !settledOf(row))
  const [first] = rows
  const last = rows.at(-1)
  if (first === undefined || last === undefined) return null
  return (
    <motion.li
      className={PLACE}
      data-agent={first.agent?.id}
      initial={collapse}
      animate={expand}
      exit={collapse}
      transition={folding}
    >
      <div className={ROW}>
        <ProjectMark name={first.project} others={projects} legend />
        <span className={KEY}>{first.need.missionKey ?? ''}</span>
        <NeedGlyph kind="permission" />
        <span className={TITLE}>
          {waiting.length} requests from {first.agent?.name ?? 'an agent'}
        </span>
        <span className={DETAIL}>{waiting.map((row) => row.need.title).join(' · ')}</span>
        <span className={WHEN}>{last.need.when}</span>
        <span className="flex shrink-0 gap-1">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              for (const row of waiting) on(row.id).onPermission?.('allow-once')
            }}
          >
            Allow these
          </Button>
          <Button size="sm" aria-expanded={opened} onClick={onToggle}>
            {ACTIONS.permission}
          </Button>
        </span>
      </div>
      <AnimatePresence initial={false}>
        {opened && (
          <motion.div
            className="overflow-hidden"
            initial={collapse}
            animate={expand}
            exit={collapse}
            transition={folding}
          >
            <ul aria-label={`Requests from ${first.agent?.name ?? 'an agent'}`} className="pl-6">
              <AnimatePresence initial={false}>
                {rows.map((row) => (
                  <Row
                    key={row.id}
                    row={row}
                    projects={projects}
                    opened={openedRow === row.id}
                    onToggle={() => onToggleRow(row.id)}
                    onOpenMission={
                      onOpenMission === undefined ? undefined : () => onOpenMission(row.id)
                    }
                    on={on(row.id)}
                  />
                ))}
              </AnimatePresence>
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.li>
  )
}

const settledOf = (row: NeedRow): boolean =>
  row.need.status !== undefined && row.need.status.state !== 'waiting'

/** A row alone, or the requests of one agent together where the first of them stands. */
type Item =
  | { readonly kind: 'one'; readonly row: NeedRow }
  | { readonly kind: 'agent'; readonly id: string; readonly rows: readonly NeedRow[] }

/** The rows as the list draws them: an agent's permissions together while several wait. */
function itemsOf(rows: readonly NeedRow[]): Item[] {
  const byAgent = new Map<string, NeedRow[]>()
  for (const row of rows) {
    if (row.agent === undefined || row.need.ask.kind !== 'permission') continue
    byAgent.set(row.agent.id, [...(byAgent.get(row.agent.id) ?? []), row])
  }
  const grouped = new Set(
    [...byAgent.entries()]
      .filter(([, of]) => of.filter((row) => !settledOf(row)).length > 1)
      .map(([id]) => id),
  )
  const items: Item[] = []
  for (const row of rows) {
    const agent = row.agent?.id
    if (agent === undefined || !grouped.has(agent) || row.need.ask.kind !== 'permission') {
      items.push({ kind: 'one', row })
    } else if (!items.some((item) => item.kind === 'agent' && item.id === agent)) {
      items.push({ kind: 'agent', id: agent, rows: byAgent.get(agent) ?? [] })
    }
  }
  return items
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
  const [openedGroup, setOpenedGroup] = useState<string | null>(null)
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
        {itemsOf(rows).map((item) => {
          if (item.kind === 'agent') {
            const key = `agent:${item.id}`
            return (
              <GroupRow
                key={key}
                rows={item.rows}
                projects={projects}
                opened={openedGroup === key}
                openedRow={opened}
                onToggle={() => setOpenedGroup(openedGroup === key ? null : key)}
                onToggleRow={(id) => setOpened(opened === id ? null : id)}
                onOpenMission={onOpenMission}
                on={on}
              />
            )
          }
          const { row } = item
          return (
            <Row
              key={row.id}
              row={row}
              projects={projects}
              opened={opened === row.id}
              onToggle={() => setOpened(opened === row.id ? null : row.id)}
              onOpenMission={onOpenMission === undefined ? undefined : () => onOpenMission(row.id)}
              on={on(row.id)}
            />
          )
        })}
      </AnimatePresence>
    </ul>
  )
}
