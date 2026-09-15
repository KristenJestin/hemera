/**
 * Behaviour of a badge: what it reads out.
 *
 * A count badge caps what it paints so a large number cannot stretch the row it sits in.
 */

export type BadgeStatus = 'ok' | 'warn' | 'bad' | 'info'
export type BadgeMission = 'define' | 'build' | 'free'

export type UseBadgeOptions =
  | { kind: 'count'; count: number; max?: number }
  | { kind: 'status'; status: BadgeStatus; label: string }
  | { kind: 'tag'; mission: BadgeMission; label: string }

export interface BadgeBehaviour {
  /** What the badge paints. */
  text: string
  /** True when a count was capped. */
  capped: boolean
}

/** Largest count painted in full before the badge caps it. */
export const DEFAULT_COUNT_CAP = 99

export function useBadge(options: UseBadgeOptions): BadgeBehaviour {
  if (options.kind !== 'count') return { text: options.label, capped: false }
  const cap = options.max ?? DEFAULT_COUNT_CAP
  const capped = options.count > cap
  return { text: capped ? `${cap}+` : String(options.count), capped }
}
