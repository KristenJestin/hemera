/**
 * What the living spec page is drawn from, in the shapes the window gives it: words where the
 * engine has instants, and a plain `kind` where it has tagged unions.
 */

/** A domain or a requirement: proposed by the reading of the code until the user validates it. */
export type LivingState = 'proposed' | 'validated'

/** One scenario of a requirement: what happens (`when`) and what follows (`then`). */
export interface LivingScenario {
  readonly when: string
  readonly then: string
}

/** The mission a requirement comes from, and the Review round that changed it; null: the reading. */
export type LivingOrigin = {
  readonly missionId: string
  readonly key: string | null
  readonly round: number | null
} | null

/** What a re-read proposes on a requirement already there: a replacement, or its removal. */
export type LivingPending =
  | {
      readonly kind: 'replace'
      readonly text: string
      readonly scenarios: readonly LivingScenario[]
      readonly uncertainty: string
    }
  | { readonly kind: 'obsolete'; readonly reason: string }

/** A requirement of a domain, with its origin, its doubt and any re-read proposal on it. */
export interface LivingRequirement {
  readonly id: string
  readonly domainId: string
  readonly text: string
  readonly scenarios: readonly LivingScenario[]
  readonly origin: LivingOrigin
  readonly state: LivingState
  /** What the agent was not sure of; empty when it was. */
  readonly uncertainty: string
  readonly version: number
  readonly removed: boolean
  readonly pending: LivingPending | null
}

/** One change of a requirement, for its history. */
export interface LivingChange {
  readonly what:
    | 'proposed'
    | 'validated'
    | 'rejected'
    | 'dropped'
    | 'added'
    | 'modified'
    | 'removed'
  readonly textBefore: string | null
  readonly textAfter: string | null
  readonly by: 'bootstrap' | 'mission' | 'user'
  readonly byMission: LivingOrigin
  /** As the page says it: `3 Oct`, `yesterday`. */
  readonly at: string
}

/** A domain of the living spec, with its counts and when it last changed, in words. */
export interface LivingDomain {
  readonly id: string
  readonly name: string
  readonly summary: string
  readonly uncertainty: string
  readonly state: LivingState
  readonly proposed: number
  readonly validated: number
  readonly pending: number
  /** As the page says it. */
  readonly lastChange: string
}

/** Where a reading of the code stands. */
export type BootstrapState = 'waiting_for_slot' | 'running' | 'done' | 'failed' | 'stopped'

/** One reading of the code (the whole living spec, or one domain), newest first in the data. */
export interface BootstrapRun {
  readonly id: string
  /** The domain of a re-read; null for the whole living spec. */
  readonly domainId: string | null
  readonly state: BootstrapState
  /** The cap's wait, or why it failed. */
  readonly sentence: string | null
  /** Milliseconds since the epoch. */
  readonly startedAt: number
  readonly endedAt: number | null
}

/** Everything one view of the living spec is drawn from. */
export interface LivingSpecData {
  readonly domains: readonly LivingDomain[]
  /** By domain id; a missing key means "not read yet": skeleton rows. */
  readonly requirements: Readonly<Record<string, readonly LivingRequirement[]>>
  /** The newest first. */
  readonly runs: readonly BootstrapRun[]
  /** No model is set for the reading: a need of the Project, which opens Models by role. */
  readonly noModel?: boolean | undefined
}

/** The props of the living spec page: the data, and a callback for each gesture. */
export interface LivingSpecPageProps {
  projectName: string
  /** Null: the first read is on its way. */
  data: LivingSpecData | null
  error?: string | undefined
  /** The domain shown; null: the first. */
  opened: string | null
  onOpenDomain: (domainId: string) => void
  /** Absent: folded and not read. */
  histories: Readonly<Record<string, 'loading' | readonly LivingChange[]>>
  onHistory: (requirementId: string) => void
  /** The domain or requirement whose gesture is on its way. */
  busy?: string | undefined
  /** The last gesture's refusal, in words, under the domain head. */
  refused?: string | undefined
  onValidate: (domainId: string) => void
  onReject: (domainId: string) => void
  onDrop: (requirementId: string) => void
  onReread: (domainId: string) => void
  onRead: () => void
  onOrigin: (origin: NonNullable<LivingOrigin>) => void
  onModels: () => void
  onRetry: () => void
}
