import type { LivingOrigin, LivingRequirement } from './living-spec-types.ts'

/** How an origin is said: `bootstrap`, `ACME-12`, `ACME-12, round 1`. */
export function originWords(origin: LivingOrigin): string {
  if (origin === null) return 'bootstrap'
  const key = origin.key ?? 'a deleted mission'
  return origin.round === null ? key : `${key}, round ${String(origin.round)}`
}

/** The requirements of a domain that wait on the user. */
export function waitingOf(requirements: readonly LivingRequirement[]): LivingRequirement[] {
  return requirements.filter(
    (one) => !one.removed && (one.state === 'proposed' || one.pending !== null),
  )
}
