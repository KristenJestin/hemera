import type { ReactNode } from 'react'

import { Button } from '../components/button/button.tsx'
import { Card } from '../components/card/card.tsx'
import {
  TimelineDays,
  TimelineSection,
  TimelineStop,
  type TimelineTone,
} from '../components/timeline/timeline.tsx'
import {
  IconChevronDown,
  IconDeviceDesktop,
  IconPlugConnected,
  IconRobot,
  IconSparkles,
  IconUser,
} from '../icons.ts'

/**
 * The Journal of one Project: what happened, newest first, grouped by the day it happened on
 * (design D4-05, D4-07).
 *
 * It holds nothing and computes nothing. The entries arrive in the order they are shown, each
 * carrying the day and the time already written for the platform the page is running on — a
 * design system that formatted a date would be a design system with a locale of its own. The
 * days are grouped here because grouping a list that is already in order is a walk, not a
 * decision.
 *
 * The filters say what is wanted; what answers them is the engine, one page at a time. The
 * component says which are on and calls back, so a filter never quietly hides an entry that was
 * read into the page: the page is asked again instead.
 */
const PAGE = 'mx-auto flex w-full max-w-5xl flex-col gap-4 px-6 py-10'

/**
 * The entities an entry can be about: a Project, a Session, the Profile, and a Spec — each step
 * of one, from its creation to `ready` and its rework (lot 19, D7-13).
 */
export type JournalEntityKind = 'project' | 'session' | 'profile' | 'spec'

/**
 * Who did the thing, which is not the same question as what it was about.
 *
 * Five of them, and each is someone who can really act on a Project: the user at the keyboard,
 * Hemera on its own behalf, an agent working inside a Session, a client driving Hemera from
 * outside over MCP, and the machine — a start, a scheduled run, a thing nobody asked for at
 * that moment. `hemera` and `system` are worth telling apart: one is the application deciding,
 * the other is the application being woken.
 */
export type JournalAuthor = 'human' | 'hemera' | 'agent' | 'mcp' | 'system'

/** What a filter is set to: one entity, or everything. */
export type JournalFilter = JournalEntityKind | 'all'

export interface JournalLine {
  /** The global sequence of the event, which is what a reader quotes. */
  sequence: number
  kind: JournalEntityKind
  /** What happened, already written for a human to read. */
  label: string
  /** The day it happened on, already written: `Today`, `Yesterday`, `12 September`. */
  day: string
  /** The time it happened at, already written for the platform. */
  time: string
  author: JournalAuthor
  /** What the entry is about and how to go there, when there is somewhere to go. */
  target?: { label: string; onOpen: () => void } | undefined
}

/**
 * Who acted, drawn where the sequence used to be.
 *
 * A number nothing links to is a number nobody reads; who did it is the first thing anyone
 * scanning a Journal wants, and it belongs at the head of the line rather than at the end of
 * the row under it. The name is carried with it for whoever is not looking at the icon.
 */
const AUTHOR = {
  human: { icon: <IconUser size="sm" />, name: 'you' },
  hemera: { icon: <IconSparkles size="sm" />, name: 'Hemera' },
  agent: { icon: <IconRobot size="sm" />, name: 'an agent' },
  mcp: { icon: <IconPlugConnected size="sm" />, name: 'MCP' },
  system: { icon: <IconDeviceDesktop size="sm" />, name: 'the system' },
} satisfies Record<JournalAuthor, { icon: ReactNode; name: string }>

/**
 * What an entry is about, in the colour of its mark on the rail.
 *
 * This is where the badge went. A chip in front of every line said the same three words down
 * the whole column and pushed what actually happened to the right of them; the mark says it in
 * the one place the eye is already following, and the line starts with what was done.
 */
const TONE: Record<JournalEntityKind, TimelineTone> = {
  project: 'info',
  session: 'primary',
  profile: 'neutral',
  spec: 'success',
}

/** One event, as a stop of the timeline: its sequence, what it was about, and what it says. */
export function JournalEntry({ entry }: { entry: JournalLine }): ReactNode {
  return (
    <TimelineStop
      marker={
        <span className="flex items-center text-muted-foreground">
          {AUTHOR[entry.author].icon}
          <span className="sr-only">by {AUTHOR[entry.author].name}</span>
        </span>
      }
      quiet={entry.author !== 'human'}
      tone={TONE[entry.kind]}
      meta={
        <>
          <span>{entry.time}</span>
          {entry.target !== undefined && (
            <Button variant="link" size="sm" onClick={entry.target.onOpen}>
              {entry.target.label}
            </Button>
          )}
        </>
      }
    >
      {/* Said for whoever cannot see the colour of the mark: what an entry is about is not a
          thing to carry in a hue alone, and a filter names it in words that are read out. */}
      <span className="sr-only">{entry.kind}</span>
      {entry.label}
    </TimelineStop>
  )
}

/** The day a run of entries happened on, with the entries of that day inside it. */
export function DaySeparator({ day, children }: { day: string; children: ReactNode }): ReactNode {
  return <TimelineSection name={day}>{children}</TimelineSection>
}

export interface JournalFiltersProps {
  filter: JournalFilter
  onFilterChange: (filter: JournalFilter) => void
  /** Whether only what the user did themselves is wanted. */
  byYou: boolean
  onByYouChange: (byYou: boolean) => void
}

/** What is being asked for, which the Journal then asks the engine again. */
export function JournalFilters({
  filter,
  onFilterChange,
  byYou,
  onByYouChange,
}: JournalFiltersProps): ReactNode {
  const choices: { value: JournalFilter; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'session', label: 'Sessions' },
    { value: 'spec', label: 'Specs' },
    { value: 'project', label: 'Project' },
    { value: 'profile', label: 'Profile' },
  ]
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filters">
      {choices.map((choice) => (
        <Button
          key={choice.value}
          variant={choice.value === filter ? 'primary' : 'secondary'}
          size="sm"
          aria-pressed={choice.value === filter}
          onClick={() => onFilterChange(choice.value)}
        >
          {choice.label}
        </Button>
      ))}
      <Button
        variant={byYou ? 'primary' : 'secondary'}
        size="sm"
        className="ml-auto"
        aria-pressed={byYou}
        onClick={() => onByYouChange(!byYou)}
      >
        <IconUser size="sm" />
        by you
      </Button>
    </div>
  )
}

/** The one way further back, which asks for the page before the oldest entry shown. */
export function LoadEarlier({
  loading,
  onLoadEarlier,
}: {
  loading: boolean
  onLoadEarlier: () => void
}): ReactNode {
  return (
    <div className="flex justify-center pt-2">
      <Button
        variant="secondary"
        size="sm"
        state={loading ? 'loading' : 'idle'}
        onClick={onLoadEarlier}
      >
        <IconChevronDown size="sm" />
        Earlier entries
      </Button>
    </div>
  )
}

export interface JournalProps {
  /** The name of the Project whose Journal this is, said in the heading. */
  projectName: string
  /** The page as it stands, newest first, days already written on each entry. */
  entries: JournalLine[]
  filter: JournalFilter
  onFilterChange: (filter: JournalFilter) => void
  byYou: boolean
  onByYouChange: (byYou: boolean) => void
  /** Whether there is an older page to ask for. */
  hasEarlier: boolean
  onLoadEarlier: () => void
  loading?: boolean | undefined
}

export function Journal({
  projectName,
  entries,
  filter,
  onFilterChange,
  byYou,
  onByYouChange,
  hasEarlier,
  onLoadEarlier,
  loading = false,
}: JournalProps): ReactNode {
  return (
    <div className={PAGE}>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-medium">Journal</h1>
        <p className="text-sm text-muted-foreground">
          Every change made in {projectName}, in the order it happened.
        </p>
      </div>

      <JournalFilters
        filter={filter}
        onFilterChange={onFilterChange}
        byYou={byYou}
        onByYouChange={onByYouChange}
      />

      <Card>
        {entries.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Nothing here yet. Every change made in {projectName} will be written down.
          </p>
        ) : (
          <TimelineDays
            label={`Journal of ${projectName}`}
            days={entries.map((entry) => ({
              key: String(entry.sequence),
              day: entry.day,
              stop: <JournalEntry entry={entry} />,
            }))}
          />
        )}
        {hasEarlier && <LoadEarlier loading={loading} onLoadEarlier={onLoadEarlier} />}
      </Card>

      {!hasEarlier && entries.length > 0 && (
        <p className="text-center text-xs text-muted-foreground">
          That is the whole Journal of {projectName}.
        </p>
      )}
    </div>
  )
}
