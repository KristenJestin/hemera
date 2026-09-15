/** Behaviour of a journal entry: how its moment reads. */

export interface UseTimelineItemOptions {
  /** Moment the entry was recorded. */
  at: Date
  /** Clock the caller reads, so a test never depends on the real one. */
  now?: Date | undefined
}

export interface TimelineItemBehaviour {
  /** Time of day, as the entry announces it. */
  timestamp: string
  /** True when the entry was recorded on another day than `now`. */
  earlierDay: boolean
}

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value)
}

export function useTimelineItem({ at, now }: UseTimelineItemOptions): TimelineItemBehaviour {
  const reference = now ?? at
  return {
    timestamp: `${pad(at.getHours())}:${pad(at.getMinutes())}`,
    earlierDay: at.toDateString() !== reference.toDateString(),
  }
}
