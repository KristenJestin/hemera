import { cn } from 'cn'
import { AnimatePresence, motion } from 'motion/react'
import { type HTMLAttributes, type ReactNode, type Ref, useState } from 'react'

import { Button, IconButton } from '../../components/button/button.tsx'
import { Menu, type MenuItem } from '../../components/menu/menu.tsx'
import { Skeleton } from '../../components/loading/loading.tsx'
import { ProjectMark } from '../../components/project-mark/project-mark.tsx'
import { Tooltip } from '../../components/tooltip/tooltip.tsx'
import {
  IconChevronRight,
  IconDots,
  IconListCheck,
  IconMessages,
  IconRefresh,
} from '../../icons.ts'
import { collapse, expand, fold, useTransition } from '../../motion.ts'
import { NeedCard, type NeedCardProps, NeedGlyph, type NeedKind } from './need-card.tsx'

/**
 * Needs you, across every Project: one row per need, in the order they wait in — the
 * application's first, then each Project's, the oldest first in each.
 *
 * A row is the Project's mark (Hemera's own for a need of the application), the mission's key, the
 * kind's glyph, the title, what the agent wrote cut to the row, and when. Its one action, an icon
 * named "<action> here" by its tooltip, unfolds the whole need card under the row, pushing the rows
 * below it, with a way to the mission under the card. Every other action of the row is in the
 * "more" menu at its end, which a row has when it has something to offer in it. The rows are the
 * same height loading as loaded.
 *
 * A need that arrives grows into its place and pushes the rows under it; one answered or expired
 * becomes its card's faint line where its row was, and folds out of the list when it leaves.
 *
 * The permissions one agent asked for while several of them still wait share one row, where the
 * first of them stands: how many wait and from whom, what they ask, and the action, which unfolds
 * their own rows; "Allow these" (Allow once for each) is in the row's menu.
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

/** What the row's action says it does, by kind, and its icon: the need is answered in place. */
const ACTIONS: Record<NeedKind, { label: string; icon: ReactNode }> = {
  permission: { label: 'Answer here', icon: <IconMessages size="sm" /> },
  decision: { label: 'Answer here', icon: <IconMessages size="sm" /> },
  error: { label: 'Choose here', icon: <IconListCheck size="sm" /> },
  environment: { label: 'Retry here', icon: <IconRefresh size="sm" /> },
}

/**
 * The list is one grid whose columns every row shares (`grid-cols-needs`): the Project's mark,
 * the mission's key, the kind's glyph, the title, the detail, when, and the action, between two
 * narrow margins. A row and an unfolded group are subgrids of it, so a column starts on one edge
 * on every row, and a cell left empty keeps its place.
 */
const LIST = '@container grid grid-cols-needs gap-x-2'
/** A row of the grid: one line of cells, or a card across the whole width. */
const LINE = 'col-span-full grid grid-cols-subgrid'
const ROW = 'col-span-full grid h-control-md grid-cols-subgrid items-center text-sm'
/** What spans the row between its margins: an unfolded card, a settled need's line. */
const SPAN = 'col-start-2 -col-end-2'
const MARK = 'col-start-2 flex'
const KEY = 'font-mono text-xs text-muted-foreground'
/**
 * The key gives way after the detail: below a narrow column it is not drawn, its cell kept so
 * the columns after it stay in their place.
 */
const KEY_TEXT = '@max-md:hidden'
const TITLE = 'min-w-0 truncate font-medium'
const DETAIL = 'flex min-w-0'
const DETAIL_TEXT = 'min-w-0 truncate text-muted-foreground outline-none focus-ring'
/** The time ends on one edge, its figures of one width. */
const WHEN = 'text-right text-xs whitespace-nowrap text-muted-foreground tabular-nums'
/** The action ends the row: its icon, then the menu, neither of them ever shrinking. */
const ACTION = 'flex justify-end gap-1'
const ICON = 'flex shrink-0'
/** The menu's place in a row that has no menu: the width of its small icon button. */
const EMPTY_MORE = 'size-control-sm'
const RULE = 'border-b border-border last:border-b-0'
/** A row, clipped while it grows in or folds out. */
const PLACE = cn(LINE, RULE, 'overflow-hidden')

type DetailProps = Omit<HTMLAttributes<HTMLSpanElement>, 'children'> & {
  text: string
  ref?: Ref<HTMLSpanElement> | undefined
}

/** What the agent wrote, cut to its cell: the keyboard reaches it, and its tooltip says it whole. */
function DetailText({ text, ref, ...handed }: DetailProps): ReactNode {
  return (
    <span {...handed} ref={ref} tabIndex={0} className={DETAIL_TEXT}>
      {text}
    </span>
  )
}

/** The detail cell: empty when there is nothing to say, so the columns after it stay put. */
function Detail({ text }: { text: string | undefined }): ReactNode {
  return (
    <span className={DETAIL} data-need-cell="detail">
      {text !== undefined && text !== '' && (
        <Tooltip label={text} quote>
          <DetailText text={text} />
        </Tooltip>
      )}
    </span>
  )
}

/** The cells of a row, in the grid's order. */
function Cells({
  project,
  projects,
  missionKey,
  kind,
  title,
  detail,
  when,
  action,
  more,
  ruled = false,
}: {
  project: string
  projects: readonly string[] | undefined
  missionKey: string | undefined
  kind: NeedKind
  title: string
  detail: string | undefined
  when: string
  action: ReactNode
  /** What the row offers besides its action, in the menu at its end. */
  more: readonly MenuItem[]
  /** Whether a rule closes the line itself: an unfolded group has its own rows under it. */
  ruled?: boolean
}): ReactNode {
  return (
    <div className={cn(ROW, ruled && 'border-b border-border')} data-need-row="">
      <span className={MARK} data-need-cell="project">
        <ProjectMark name={project} others={projects} legend />
      </span>
      <span className={KEY} data-need-cell="key">
        <span className={KEY_TEXT}>{missionKey ?? ''}</span>
      </span>
      <span className="flex" data-need-cell="kind">
        <NeedGlyph kind={kind} />
      </span>
      <span className={TITLE} data-need-cell="title">
        {title}
      </span>
      <Detail text={detail} />
      <span className={WHEN} data-need-cell="when">
        {when}
      </span>
      <span className={ACTION} data-need-cell="action">
        {action}
        <span className={cn(ICON, more.length === 0 && EMPTY_MORE)}>
          {more.length > 0 && (
            <Menu
              label={`More actions for ${title}`}
              icon={<IconDots size="sm" />}
              groups={[[...more]]}
            />
          )}
        </span>
      </span>
    </div>
  )
}

/** The row's own action: an icon, named and told by its tooltip. */
function Toggle({
  kind,
  opened,
  onToggle,
}: {
  kind: NeedKind
  opened: boolean
  onToggle: () => void
}): ReactNode {
  const { label, icon } = ACTIONS[kind]
  return (
    <span className={ICON}>
      <Tooltip label={label}>
        <IconButton
          variant="ghost"
          size="sm"
          icon={icon}
          aria-label={label}
          aria-expanded={opened}
          onClick={onToggle}
        />
      </Tooltip>
    </span>
  )
}

/** What opens under a row, across its whole width. */
function Unfolded({ children }: { children: ReactNode }): ReactNode {
  const folding = useTransition(fold)
  return (
    <motion.div
      className={cn(LINE, 'overflow-hidden')}
      initial={collapse}
      animate={expand}
      exit={collapse}
      transition={folding}
    >
      {children}
    </motion.div>
  )
}

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
  const settled = settledOf(row)
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
        <div className={cn(SPAN, 'py-1')}>
          <NeedCard {...need} missionKey={undefined} />
        </div>
      ) : (
        <Cells
          project={row.project}
          projects={projects}
          missionKey={need.missionKey}
          kind={kind}
          title={need.title}
          detail={need.text}
          when={need.when}
          action={<Toggle kind={kind} opened={opened} onToggle={onToggle} />}
          more={
            need.missionKey !== undefined && onOpenMission !== undefined
              ? [{ label: `Open ${need.missionKey}`, onSelect: onOpenMission }]
              : []
          }
        />
      )}
      <AnimatePresence initial={false}>
        {opened && !settled && (
          <Unfolded>
            <div className={cn(SPAN, 'flex flex-col gap-2 pb-4')}>
              <NeedCard {...need} missionKey={undefined} {...on} />
              {need.missionKey !== undefined && onOpenMission !== undefined && (
                <Button variant="link" className="self-start" onClick={onOpenMission}>
                  Open {need.missionKey}
                  <IconChevronRight size="sm" aria-hidden="true" />
                </Button>
              )}
            </div>
          </Unfolded>
        )}
      </AnimatePresence>
    </motion.li>
  )
}

/** The requests of one agent, on one row of the same columns that unfolds to theirs. */
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
  const name = first.agent?.name ?? 'an agent'
  return (
    <motion.li
      className={PLACE}
      data-agent={first.agent?.id}
      initial={collapse}
      animate={expand}
      exit={collapse}
      transition={folding}
    >
      <Cells
        project={first.project}
        projects={projects}
        missionKey={first.need.missionKey}
        kind="permission"
        title={`${String(waiting.length)} requests from ${name}`}
        detail={waiting.map((row) => row.need.title).join(' · ')}
        when={last.need.when}
        action={<Toggle kind="permission" opened={opened} onToggle={onToggle} />}
        more={[
          {
            label: 'Allow these',
            onSelect: () => {
              for (const row of waiting) on(row.id).onPermission?.('allow-once')
            },
          },
        ]}
        ruled={opened}
      />
      <AnimatePresence initial={false}>
        {opened && (
          <Unfolded>
            <ul aria-label={`Requests from ${name}`} className={LINE}>
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
          </Unfolded>
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

/** A row's shape while the rows are on their way, in the same columns. */
function RowSkeleton(): ReactNode {
  return (
    <li aria-hidden="true" className={cn(LINE, RULE)} data-row-skeleton="">
      <span className={ROW}>
        <span className={MARK}>
          <Skeleton shape="block">
            <ProjectMark name="A" />
          </Skeleton>
        </span>
        <span className={KEY}>
          <span className={KEY_TEXT}>
            <Skeleton>ACME-12</Skeleton>
          </span>
        </span>
        <span />
        <span className={TITLE}>
          <Skeleton>Which table holds the invoices?</Skeleton>
        </span>
        <span />
        <span className={WHEN}>
          <Skeleton>4 min</Skeleton>
        </span>
        <span />
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
      <ul aria-label="Needs you" aria-busy="true" className={LIST}>
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
    <ul aria-label="Needs you" className={LIST}>
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
