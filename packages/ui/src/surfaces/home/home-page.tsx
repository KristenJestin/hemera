import type { ReactNode } from 'react'

import type { Ball } from '../../blocks/ball/ball-mark.tsx'
import { MissionRow, MissionRowSkeleton } from '../../blocks/mission/mission-row.tsx'
import { NeedsYouList, type NeedsYouListProps } from '../../blocks/need/needs-you-list.tsx'
import { Button } from '../../components/button/button.tsx'
import { Empty } from '../../components/empty/empty.tsx'
import { ErrorState } from '../../components/error-state/error-state.tsx'
import { Frame } from '../../components/frame/frame.tsx'
import { SectionHead } from '../../components/section-head/section-head.tsx'
import { Page, PageHeader } from '../page.tsx'

/**
 * Home: the page the window opens on, and the frame of four lists whose content comes later.
 *
 * - **Needs you** and **Questions**, side by side: what blocks and waits for the user across every
 *   Project, and the Planning questions that wait too. The two that call, so they are first and
 *   their counts are in the header.
 * - **Since you left**: what happened while the window was away, in the order it happened.
 * - **Recent**: what was worked on last.
 *
 * Each list is its head — name and count — above a frame, the house motif, whose body holds its rows, the row a mission is
 * everywhere; an empty list says so in three words in the body, and no more. A Home with no
 * Project yet is one empty state in the middle, Hemera asleep, and the way to add one. Rows on
 * their way are the row's own shape, so nothing moves when they arrive.
 */
export interface HomeRow {
  id: string
  /** The Project the row belongs to. */
  project: string
  missionKey: string
  title: string
  /** When, as the row says it: `08:56`, `yesterday`. */
  when: string
  ball: Ball
}

export interface HomeSection {
  rows: readonly HomeRow[]
}

export interface HomePageProps {
  /** The day, as the header says it under the title. */
  today: string
  /** Whether there is a Project at all: without one, Home is one invitation. */
  hasProjects: boolean
  needsYou: HomeSection
  /**
   * The needs themselves, once they are read: Needs you then holds a row per need, answered in
   * place, and counts those still waiting; without them, it holds `needsYou`'s rows.
   */
  needs?: Omit<NeedsYouListProps, 'loading'> | undefined
  questions: HomeSection
  sinceYouLeft: HomeSection
  recent: HomeSection
  loading?: boolean | undefined
  error?: string | undefined
  onOpen: (id: string) => void
  onAddProject: () => void
  onRetry: () => void
}

/** A need still waiting: one answered or expired a moment ago no longer counts. */
const waiting = (row: NeedsYouListProps['rows'][number]): boolean =>
  row.need.status === undefined || row.need.status.state === 'waiting'

/** Side by side, each as tall as what it holds: a card never stretches to its neighbour. */
const TWO = 'grid grid-cols-1 items-start gap-6 lg:grid-cols-2'

const EMPTY = 'px-4 py-3 text-sm text-muted-foreground'

function Rows({
  rows,
  label,
  loading,
  empty,
  onOpen,
}: {
  rows: readonly HomeRow[]
  label: string
  loading: boolean
  empty: string
  onOpen: (id: string) => void
}): ReactNode {
  if (loading) {
    return (
      <ul aria-label={label} aria-busy="true" className="flex flex-col">
        <MissionRowSkeleton project />
        <MissionRowSkeleton project />
      </ul>
    )
  }
  if (rows.length === 0) return <p className={EMPTY}>{empty}</p>
  return (
    <ul aria-label={label} className="flex flex-col">
      {rows.map((row) => (
        <MissionRow
          key={row.id}
          project={row.project}
          missionKey={row.missionKey}
          title={row.title}
          when={row.when}
          ball={row.ball}
          onOpen={() => onOpen(row.id)}
        />
      ))}
    </ul>
  )
}

/** A list of Home: its head above its frame, as every section of the window has it. */
function Section({
  title,
  count,
  children,
}: {
  title: string
  /** How many wait in it; only the lists that call for the user say so. */
  count?: number | undefined
  children: ReactNode
}): ReactNode {
  return (
    <section aria-label={title} className="flex flex-col gap-3">
      <SectionHead title={title} count={count === 0 ? undefined : count} calls />
      <Frame>{children}</Frame>
    </section>
  )
}

export function HomePage({
  today,
  hasProjects,
  needsYou,
  needs,
  questions,
  sinceYouLeft,
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
  return (
    <Page>
      <PageHeader title="Home" about={<span>{today}</span>} />
      <div className={TWO}>
        {needs === undefined ? (
          <Section title="Needs you" count={needsYou.rows.length}>
            <Rows
              rows={needsYou.rows}
              label="Needs you"
              loading={loading}
              empty="Nothing waits for you."
              onOpen={onOpen}
            />
          </Section>
        ) : (
          <Section title="Needs you" count={needs.rows.filter(waiting).length}>
            <NeedsYouList {...needs} loading={loading} />
          </Section>
        )}
        <Section title="Questions" count={questions.rows.length}>
          <Rows
            rows={questions.rows}
            label="Questions"
            loading={loading}
            empty="No open question."
            onOpen={onOpen}
          />
        </Section>
      </div>
      <Section title="Since you left">
        <Rows
          rows={sinceYouLeft.rows}
          label="Since you left"
          loading={loading}
          empty="Nothing happened."
          onOpen={onOpen}
        />
      </Section>
      <Section title="Recent">
        <Rows
          rows={recent.rows}
          label="Recent"
          loading={loading}
          empty="No mission yet."
          onOpen={onOpen}
        />
      </Section>
    </Page>
  )
}
