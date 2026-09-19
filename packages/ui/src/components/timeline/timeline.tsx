import { cn } from 'cn'
import { Fragment, type ReactNode } from 'react'

/**
 * The timeline: what happened, one stop at a time (design D4-05, D4-07).
 *
 * The Journal of a Project draws one, the Activity frame of the Home draws a shorter one, and
 * the thread of a Session will draw a third — which is the whole reason it is a component and
 * not a shape the Journal keeps to itself.
 *
 * One rail runs the length of the run and every stop is a mark on it. The rail belongs to the
 * run and not to its stops: drawn as a border on each of them it comes out as a column of
 * separate strokes, one per entry, stopping and starting at every gap — which is a list with
 * lines beside it, not a timeline. Here it is a single bar, inset at both ends so it begins at
 * the first mark and dies at the last.
 *
 * A mark is a filled dot inside a ring of the surface the timeline is drawn on. The ring is
 * what cuts the rail cleanly around the dot: without it the dot reads as a thicker piece of
 * rail rather than as a point on it. Four shapes were drawn and looked at on three days of a
 * real Project before this one was kept.
 *
 * Every stop has a first row, which is what happened, and a second, which is where and when.
 * Both are handed over already written: a timeline that formatted a date would be a timeline
 * with a locale of its own.
 */
const RUN = 'relative flex flex-col pl-6'

/** A run of stops with one rail through them, which is what `timeline-rail` draws. */
const SECTION = 'timeline-rail flex flex-col'

/**
 * The heading of a section: a day, a date, whatever the caller groups by.
 *
 * It reaches back out past the text column to the very edge of the run: a date sitting in the
 * same column as the entries reads as one of them, and a date at the margin reads as a heading
 * over what follows. The rule takes the rest of the width so the break is a full one.
 */
const GROUP = '-ml-6 flex items-center gap-3 pt-5 pb-3'

const GROUP_NAME = 'text-xs font-medium tracking-wide text-muted-foreground uppercase'

const GROUP_RULE = 'h-0 flex-1 border-t border-border'

const STOP = 'relative flex flex-col gap-1 py-2.5'

/** The ring of surface the dot sits in, centred on the rail rather than beside it. */
const MARK =
  'absolute top-3 -left-4 flex size-4 -translate-x-1/2 items-center justify-center rounded-full bg-surface-body'

const DOT = 'size-2 rounded-full'

/**
 * What the dot is filled with, which is what the stop is about.
 *
 * A timeline of one colour says only that something happened; a timeline whose marks carry the
 * tone of what happened says what kind of thing, down the whole column, without a word being
 * read. The tones are the theme's own and a caller picks one by name, never by colour.
 */
const TONES = {
  primary: 'bg-primary',
  info: 'bg-info',
  success: 'bg-success',
  warning: 'bg-warning',
  neutral: 'bg-mission-free',
} satisfies Record<string, string>

export type TimelineTone = keyof typeof TONES

/** What the engine did itself: still read, and told apart from what the user did. */
const QUIET = 'text-muted-foreground'

const HEAD = 'flex flex-wrap items-center gap-2 text-base'

const META = 'flex flex-wrap items-center gap-2 text-xs text-muted-foreground'

export interface TimelineProps {
  /** What the run is called to a screen reader. */
  label: string
  className?: string | undefined
  children: ReactNode
}

export function Timeline({ label, className, children }: TimelineProps): ReactNode {
  return (
    <div role="list" aria-label={label} className={cn(RUN, SECTION, className)}>
      {children}
    </div>
  )
}

/**
 * One day of a run, with its stops inside it.
 *
 * A section and not a heading dropped between the stops. The rail belongs to the run of stops
 * it joins, so it has to be able to see where that run begins and ends — which it can only do
 * if they are its own children. Left flat, the best it could manage was a segment per stop,
 * and a segment per stop hangs past the last mark of the day and above the first.
 *
 * The heading is not one of the listed things — which is why the whole is a `role="list"` of
 * `role="listitem"` rather than a `<ul>`: a day is a heading over the stops, and counting it
 * among them would make “three entries today” read as four.
 */
export function TimelineSection({
  name,
  children,
}: {
  name: string
  children: ReactNode
}): ReactNode {
  return (
    <>
      <p className={GROUP}>
        <span className={GROUP_NAME}>{name}</span>
        <span aria-hidden="true" className={GROUP_RULE} />
      </p>
      <div className={SECTION}>{children}</div>
    </>
  )
}

export interface TimelineDay {
  /** What tells this stop from the next one, for React. */
  key: string
  /** The day it happened on, already written. Consecutive equal days are one section. */
  day: string
  /** The stop itself, drawn by whoever knows what it says. */
  stop: ReactNode
}

/**
 * A whole run, handed over flat and cut into its days here.
 *
 * The caller has a page of entries, not a tree of them, and turning one into the other is the
 * same walk every time: a day is a run of entries carrying the same one, and a new day is the
 * moment that run ends. Written out at each call site it would be written out differently at
 * each call site, and a section put together by hand is a section whose rail can be wrong.
 *
 * It is a walk and not a sort. The order is the one the entries arrive in, because that order
 * was decided by whatever produced them; a component that sorted its own input would be a
 * component overruling an engine that had already answered the question.
 *
 * Nothing is formatted here. The day is a string the caller has already written for its own
 * platform — a timeline that turned a date into words would be a timeline with a locale.
 */
export function TimelineDays({
  label,
  days,
  className,
}: {
  label: string
  days: readonly TimelineDay[]
  className?: string | undefined
}): ReactNode {
  const sections: { day: string; stops: TimelineDay[] }[] = []
  for (const entry of days) {
    const open = sections.at(-1)
    if (open?.day === entry.day) open.stops.push(entry)
    else sections.push({ day: entry.day, stops: [entry] })
  }
  return (
    <div role="list" aria-label={label} className={cn(RUN, className)}>
      {sections.map((section) => (
        <TimelineSection key={section.day} name={section.day}>
          {section.stops.map((one) => (
            <Fragment key={one.key}>{one.stop}</Fragment>
          ))}
        </TimelineSection>
      ))}
    </div>
  )
}

export interface TimelineStopProps {
  /**
   * What stands at the head of the line, before what happened: who did it, or whatever else
   * identifies the stop. Handed over already drawn — what identifies a stop is the caller's to
   * decide, not a shape this component has an opinion about.
   */
  marker?: ReactNode
  /** What the stop is about. */
  children: ReactNode
  /** Where and when, on the row under it. */
  meta?: ReactNode
  /** Whether this is something the engine did rather than the user. */
  quiet?: boolean | undefined
  /** What the stop is about, in the tone the dot is filled with. */
  tone?: TimelineTone | undefined
}

export function TimelineStop({
  marker,
  children,
  meta,
  quiet = false,
  tone = 'primary',
}: TimelineStopProps): ReactNode {
  return (
    <div role="listitem" className={cn(STOP, quiet && QUIET)}>
      <span aria-hidden="true" className={MARK}>
        <span className={cn(DOT, TONES[tone])} />
      </span>
      <span className={HEAD}>
        {marker}
        {children}
      </span>
      {meta !== undefined && <span className={META}>{meta}</span>}
    </div>
  )
}
