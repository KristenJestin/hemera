import { AnimatePresence, motion } from 'motion/react'
import type { ReactNode } from 'react'

import { type Ball, BallMark } from '../../blocks/ball/ball-mark.tsx'
import { MissionRow, MissionRowSkeleton } from '../../blocks/mission/mission-row.tsx'
import type { MissionMarkView } from '../../blocks/mission/vocabulary.ts'
import { NeedsYouList, type NeedsYouListProps } from '../../blocks/need/needs-you-list.tsx'
import { Button } from '../../components/button/button.tsx'
import { Empty } from '../../components/empty/empty.tsx'
import { ErrorState } from '../../components/error-state/error-state.tsx'
import { Frame } from '../../components/frame/frame.tsx'
import { LetterAvatar } from '../../components/letter-avatar/letter-avatar.tsx'
import { SectionHead } from '../../components/section-head/section-head.tsx'
import { StatusMark } from '../../components/status-mark/status-mark.tsx'
import { IconHandStop, IconInfoCircle, IconMessages, IconWorld } from '../../icons.ts'
import { collapse, expand, fold, useTransition } from '../../motion.ts'
import { Page, PageHeader } from '../page.tsx'

/**
 * Home, coming back: the page the window opens on.
 *
 * - **Since you left** leads, in the wide column: what happened while the window was away, a card
 *   per mission, its events newest first. It has no read state: it is what happened since Home
 *   was last looked at. Older pages are asked for at its foot.
 * - **Recent** is under it: the missions opened last, two lines each.
 * - **Needs you** and **Questions** stand in the narrow column beside them, since they are what
 *   calls for the user. Questions is not drawn while none is open.
 *
 * Nothing waiting and nothing happened is one quiet state in Since you left's place. A Home with
 * no Project yet is one empty state in the middle, Hemera asleep, and the way to add one. Rows
 * on their way are the row's own shape, so nothing moves when they arrive.
 */
export type HomeSinceTone = 'failed' | 'done' | 'ticket' | 'lifted' | 'answer' | 'info'

export interface HomeSinceEvent {
  id: string
  tone: HomeSinceTone
  /** What happened, in words. */
  text: string
  /** When, as the line says it: `23:51`, `yesterday`. */
  when: string
}

/** What happened to one mission, or to a Project itself when it has no `missionId`. */
export interface HomeSinceGroup {
  id: string
  /** The mission the card opens; none for an event of the Project itself. */
  missionId?: string | undefined
  project: string
  missionKey?: string | undefined
  /** The mission's title, or the Project's name. */
  title: string
  ball?: Ball | undefined
  /** The newest first. */
  events: readonly HomeSinceEvent[]
}

export interface HomeSince {
  groups: readonly HomeSinceGroup[]
  /** Whether an older page can be asked for. */
  more: boolean
  loadingMore: boolean
  onMore: () => void
}

/** A mission opened lately: the two-line row it is everywhere. */
export interface HomeRecentRow {
  /** The mission. */
  id: string
  project: string
  missionKey: string
  title: string
  when: string
  ball: Ball
  /** The last event, in words. */
  event?: string | undefined
  marks?: readonly MissionMarkView[] | undefined
  percent?: number | undefined
}

/** A question of Planning that waits for the user. */
export interface HomeQuestionRow {
  id: string
  /** The mission whose Planning asks it. */
  missionId: string
  project: string
  missionKey: string
  title: string
  when: string
  /** The answer the ticket proposes, once it does. */
  proposed?: string | undefined
}

export interface HomePageProps {
  /** The day, as the header says it under the title. */
  today: string
  /** Whether there is a Project at all: without one, Home is one invitation. */
  hasProjects: boolean
  /** The needs themselves: a row each, answered in place, those still waiting counted. */
  needs: Omit<NeedsYouListProps, 'loading'>
  questions: readonly HomeQuestionRow[]
  since: HomeSince
  recent: readonly HomeRecentRow[]
  loading?: boolean | undefined
  error?: string | undefined
  /** A mission opens. */
  onOpen: (missionId: string) => void
  onAddProject: () => void
  onRetry: () => void
}

/** A need still waiting: one answered or expired a moment ago no longer counts. */
const waiting = (row: NeedsYouListProps['rows'][number]): boolean =>
  row.need.status === undefined || row.need.status.state === 'waiting'

/** Since you left and Recent take two thirds, what calls the third. */
const COLUMNS = 'grid grid-cols-1 items-start gap-8 lg:grid-cols-3'

const MAIN = 'flex min-w-0 flex-col gap-6 lg:col-span-2'

const RAIL = 'flex min-w-0 flex-col gap-6'

const EMPTY = 'px-4 py-3 text-sm text-muted-foreground'

const OPEN =
  'flex h-control-text min-w-0 flex-1 items-center gap-3 rounded-sm text-left text-sm outline-none focus-ring hover:text-primary hover-motion'

const KEY = 'shrink-0 font-mono text-xs text-muted-foreground'

const TITLE = 'min-w-0 flex-1 truncate font-medium'

const WHEN = 'shrink-0 text-xs text-muted-foreground tabular-nums'

const EVENT =
  'flex min-h-control-md min-w-0 items-center gap-3 border-b border-border px-4 text-sm last:border-b-0'

const CALLING = 'flex min-h-control-md min-w-0 items-start gap-2 px-3 py-2 text-sm'

const CALLING_OPEN =
  'flex min-w-0 flex-1 flex-col items-start gap-0.5 rounded-sm text-left outline-none focus-ring hover:text-primary hover-motion'

/** An event as a small mark beside its words, which already say it. */
function SinceMark({ tone }: { tone: HomeSinceTone }): ReactNode {
  switch (tone) {
    case 'failed':
      return <StatusMark state="failed" size="sm" />
    case 'done':
      return <StatusMark state="done" size="sm" />
    case 'ticket':
      return (
        <span aria-hidden="true" className="flex text-info">
          <IconWorld size="sm" />
        </span>
      )
    case 'lifted':
      return (
        <span aria-hidden="true" className="flex text-success">
          <IconHandStop size="sm" />
        </span>
      )
    case 'answer':
      return (
        <span aria-hidden="true" className="flex text-info">
          <IconMessages size="sm" />
        </span>
      )
    case 'info':
      return (
        <span aria-hidden="true" className="flex text-muted-foreground">
          <IconInfoCircle size="sm" />
        </span>
      )
  }
}

function SinceCard({
  group,
  onOpen,
}: {
  group: HomeSinceGroup
  onOpen: (missionId: string) => void
}): ReactNode {
  const folding = useTransition(fold)
  const { missionId, missionKey } = group
  const name = (
    <>
      {missionKey !== undefined && <span className={KEY}>{missionKey}</span>}
      <span className={TITLE}>{group.title}</span>
    </>
  )
  return (
    <motion.li
      className="overflow-hidden pb-3"
      initial={collapse}
      animate={expand}
      exit={collapse}
      transition={folding}
    >
      <Frame
        header={
          <div className="flex min-w-0 items-center gap-3 px-2.5 pt-1.5 pb-2">
            {group.ball !== undefined && <BallMark ball={group.ball} legend />}
            <LetterAvatar name={group.project} />
            {missionId === undefined ? (
              <span className="flex h-control-text min-w-0 flex-1 items-center gap-3 text-sm">
                {name}
              </span>
            ) : (
              <button type="button" className={OPEN} onClick={() => onOpen(missionId)}>
                {name}
              </button>
            )}
          </div>
        }
      >
        <ul aria-label={`What happened to ${missionKey ?? group.title}`} className="flex flex-col">
          <AnimatePresence initial={false}>
            {group.events.map((event) => (
              <motion.li
                key={event.id}
                className={`${EVENT} overflow-hidden`}
                initial={collapse}
                animate={expand}
                exit={collapse}
                transition={folding}
              >
                <SinceMark tone={event.tone} />
                <span className="min-w-0 flex-1 truncate">{event.text}</span>
                <span className={WHEN}>{event.when}</span>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      </Frame>
    </motion.li>
  )
}

function SinceYouLeft({
  since,
  loading,
  quiet,
  onOpen,
}: {
  since: HomeSince
  loading: boolean
  quiet: boolean
  onOpen: (missionId: string) => void
}): ReactNode {
  const { groups } = since
  let body: ReactNode
  if (loading) {
    body = (
      <Frame>
        <ul aria-label="Since you left" aria-busy="true" className="flex flex-col">
          <MissionRowSkeleton project twoLines />
          <MissionRowSkeleton project twoLines />
        </ul>
      </Frame>
    )
  } else if (quiet) {
    body = <Empty face="asleep" title="All quiet" description="Nothing ran while you were away." />
  } else if (groups.length === 0) {
    body = (
      <Frame>
        <p className={EMPTY}>Nothing happened.</p>
      </Frame>
    )
  } else {
    body = (
      <>
        <ul aria-label="Since you left" className="-mb-3 flex flex-col">
          <AnimatePresence initial={false}>
            {groups.map((group) => (
              <SinceCard key={group.id} group={group} onOpen={onOpen} />
            ))}
          </AnimatePresence>
        </ul>
        {since.more && (
          <Button
            variant="secondary"
            size="sm"
            className="self-start"
            state={since.loadingMore ? 'loading' : 'idle'}
            onClick={since.onMore}
          >
            Show earlier
          </Button>
        )}
      </>
    )
  }
  return (
    <section aria-label="Since you left" className="flex flex-col gap-3">
      {/* A count of the pages read so far would say less than there is. */}
      <SectionHead
        title="Since you left"
        count={loading || since.more || groups.length === 0 ? undefined : groups.length}
      />
      {body}
    </section>
  )
}

function Recent({
  rows,
  loading,
  onOpen,
}: {
  rows: readonly HomeRecentRow[]
  loading: boolean
  onOpen: (missionId: string) => void
}): ReactNode {
  return (
    <section aria-label="Recent" className="flex flex-col gap-3">
      <SectionHead title="Recent" />
      <Frame>
        {loading ? (
          <ul aria-label="Recent" aria-busy="true" className="flex flex-col">
            <MissionRowSkeleton project twoLines />
            <MissionRowSkeleton project twoLines />
          </ul>
        ) : rows.length === 0 ? (
          <p className={EMPTY}>No mission yet.</p>
        ) : (
          <ul aria-label="Recent" className="flex flex-col">
            {rows.map((row) => (
              <MissionRow
                key={row.id}
                project={row.project}
                missionKey={row.missionKey}
                title={row.title}
                when={row.when}
                ball={row.ball}
                event={row.event}
                marks={row.marks}
                percent={row.percent}
                onOpen={() => onOpen(row.id)}
              />
            ))}
          </ul>
        )}
      </Frame>
    </section>
  )
}

function Questions({
  rows,
  onOpen,
}: {
  rows: readonly HomeQuestionRow[]
  onOpen: (missionId: string) => void
}): ReactNode {
  const folding = useTransition(fold)
  return (
    <motion.section
      aria-label="Questions"
      className="flex flex-col gap-3 overflow-hidden"
      initial={collapse}
      animate={expand}
      exit={collapse}
      transition={folding}
    >
      <SectionHead title="Questions" count={rows.length} calls />
      <Frame>
        <ul aria-label="Questions" className="flex flex-col">
          {rows.map((row) => (
            <li key={row.id} className={`${CALLING} border-b border-border last:border-b-0`}>
              <span className="flex pt-0.5">
                <StatusMark state="waiting" size="sm" />
              </span>
              <button type="button" className={CALLING_OPEN} onClick={() => onOpen(row.missionId)}>
                <span className="line-clamp-2">{row.title}</span>
                {row.proposed !== undefined && (
                  <span className="line-clamp-1 text-xs text-muted-foreground">
                    Proposed: {row.proposed}
                  </span>
                )}
                <span className={KEY}>
                  {row.missionKey} · {row.when}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Frame>
    </motion.section>
  )
}

export function HomePage({
  today,
  hasProjects,
  needs,
  questions,
  since,
  recent,
  loading = false,
  error,
  onOpen,
  onAddProject,
  onRetry,
}: HomePageProps): ReactNode {
  if (error !== undefined) {
    return (
      <Page className="flex-1 justify-center">
        <ErrorState
          title="Hemera could not read what waits for you"
          description={error}
          onRetry={onRetry}
        />
      </Page>
    )
  }
  if (!hasProjects && !loading) {
    return (
      <Page className="flex-1 justify-center">
        <Empty
          face="asleep"
          title="No Project yet"
          description="A Project is a folder with one or more repositories."
          action={
            <Button variant="primary" onClick={onAddProject}>
              Add a Project
            </Button>
          }
        />
      </Page>
    )
  }
  const calling = needs.rows.filter(waiting).length
  const quiet = calling === 0 && questions.length === 0 && since.groups.length === 0
  return (
    <Page>
      <PageHeader title="Home" about={<span>{today}</span>} />
      <div className={COLUMNS}>
        <div className={MAIN}>
          <SinceYouLeft since={since} loading={loading} quiet={quiet} onOpen={onOpen} />
          <Recent rows={recent} loading={loading} onOpen={onOpen} />
        </div>
        <aside aria-label="What calls" className={RAIL}>
          <section aria-label="Needs you" className="flex flex-col gap-3">
            <SectionHead
              title="Needs you"
              count={loading || calling === 0 ? undefined : calling}
              calls
            />
            <Frame>
              <NeedsYouList {...needs} loading={loading} />
            </Frame>
          </section>
          <AnimatePresence initial={false}>
            {!loading && questions.length > 0 && (
              <Questions key="questions" rows={questions} onOpen={onOpen} />
            )}
          </AnimatePresence>
        </aside>
      </div>
    </Page>
  )
}
