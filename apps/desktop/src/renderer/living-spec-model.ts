/**
 * The living spec as the window feeds it: the engine's domains, requirements, runs and history in
 * the words the page draws, and the follower that reads them, keeps them up to date and sends the
 * user's gestures. Plain values and functions over the link, no React: the hook that holds them is
 * `use-living-spec.ts`, and the page that draws them is the design system's.
 */

import {
  type BootstrapRun as EngineRun,
  type LivingChange as EngineChange,
  type LivingDomain as EngineDomain,
  type LivingPending as EnginePending,
  type LivingRequirement as EngineRequirement,
  type LivingSpecState,
  type NeedGroup,
  livingSeen,
} from '@hemera/ipc'
import { Predicate } from 'effect'
import type {
  BootstrapRun,
  LivingChange,
  LivingDomain,
  LivingPending,
  LivingRequirement,
  LivingSpecData,
  LivingSpecPageProps,
} from '@hemera/ui'

import type { Link } from './link.ts'
import { whenOf } from './needs.ts'
import { latestWrites } from './project-agents.ts'

/** A date the page says in words; what is not a date is kept as it is. */
const wordsOf = (at: string, now: Date): string =>
  Number.isNaN(Date.parse(at)) ? at : whenOf(at, now)

const pendingOf = (pending: EnginePending | null): LivingPending | null =>
  pending === null
    ? null
    : Predicate.isTagged(pending, 'Replace')
      ? {
          kind: 'replace',
          text: pending.text,
          scenarios: pending.scenarios,
          uncertainty: pending.uncertainty,
        }
      : { kind: 'obsolete', reason: pending.reason }

/** A requirement as the page draws it. */
export const requirementOf = (one: EngineRequirement): LivingRequirement => ({
  id: one.id,
  domainId: one.domainId,
  text: one.text,
  scenarios: one.scenarios,
  origin: one.origin,
  state: one.state,
  uncertainty: one.uncertainty,
  version: one.version,
  removed: one.removed,
  pending: pendingOf(one.pending),
})

/** A change of a requirement's history, its date in words. */
export const changeOf = (one: EngineChange, now: Date): LivingChange => ({
  what: one.what,
  textBefore: one.textBefore,
  textAfter: one.textAfter,
  by: one.by,
  byMission: one.byMission,
  at: wordsOf(one.at, now),
})

/** A domain as the page draws it, when it last changed in words. */
export const domainOf = (one: EngineDomain, now: Date): LivingDomain => ({
  id: one.id,
  name: one.name,
  summary: one.summary,
  uncertainty: one.uncertainty,
  state: one.state,
  proposed: one.proposed,
  validated: one.validated,
  pending: one.pending,
  lastChange: wordsOf(one.lastChange, now),
})

/** A run as the page draws it, its instants in milliseconds. */
export const runOf = (one: EngineRun): BootstrapRun => ({
  id: one.id,
  domainId: one.domainId,
  state: one.state,
  sentence: one.sentence,
  startedAt: Date.parse(one.startedAt),
  endedAt: one.endedAt === null ? null : Date.parse(one.endedAt),
})

/** What the page is drawn from; a domain whose requirements were not read has no key. */
export function livingDataOf(
  state: LivingSpecState,
  requirements: ReadonlyMap<string, ReadonlyArray<EngineRequirement>>,
  noModel: boolean,
  now: Date,
): LivingSpecData {
  return {
    domains: state.domains.map((one) => domainOf(one, now)),
    requirements: Object.fromEntries(
      state.domains.flatMap((one) => {
        const read = requirements.get(one.id)
        return read === undefined ? [] : [[one.id, read.map(requirementOf)]]
      }),
    ),
    runs: state.runs.map(runOf),
    noModel,
  }
}

/** Starts with the living spec agent's name, which its Project's need is written under. */
const AGENT_STARTS = 'The living spec agent '

/**
 * Whether the Project has a pending need of the reading's model: the living spec agent cannot
 * start, or stopped, on a model that is not offered; it is answered in Models by role.
 */
export function noModelIn(groups: ReadonlyArray<NeedGroup>, projectId: string): boolean {
  return groups.some(
    (group) =>
      group.projectId === projectId &&
      group.needs.some(
        (need) =>
          need.state === 'pending' &&
          Predicate.isTagged(need.fields, 'Environment') &&
          need.fields.settingsSection === 'models' &&
          need.fields.missing.startsWith(AGENT_STARTS),
      ),
  )
}

/** What the page shows of the follower. */
export type LivingSpecView = Pick<
  LivingSpecPageProps,
  'data' | 'error' | 'opened' | 'histories' | 'busy' | 'refused'
>

type Histories = LivingSpecPageProps['histories']

export const LOADING_LIVING_SPEC: LivingSpecView = { data: null, opened: null, histories: {} }

export interface LivingSpecFollowing {
  readonly openDomain: (domainId: string) => void
  readonly history: (requirementId: string) => void
  readonly validate: (domainId: string) => void
  readonly reject: (domainId: string) => void
  readonly drop: (requirementId: string) => void
  readonly reread: (domainId: string) => void
  readonly read: () => void
  /** Reads again, after a failure. */
  readonly retry: () => void
  readonly stop: () => void
}

export type LivingSpecLink = Pick<
  Link,
  | 'onLivingSpec'
  | 'livingSpecRequirements'
  | 'livingSpecRequirement'
  | 'validateDomain'
  | 'rejectDomain'
  | 'dropRequirement'
  | 'bootstrapLivingSpec'
  | 'needs'
>

/**
 * Follows a Project's living spec. A domain's requirements are read when it is opened and again
 * after each change of it; the answer of a read that a later one overtook is dropped, and so is
 * the answer of a gesture that a later one overtook. Validating or rejecting a domain names the
 * requirements the page shows of it.
 */
export function followLivingSpec(
  link: LivingSpecLink,
  projectId: string,
  onView: (view: LivingSpecView) => void,
  clock: () => Date = () => new Date(),
): LivingSpecFollowing {
  let stopped = false
  let state: LivingSpecState | null = null
  let noModel = false
  let error: string | undefined
  let opened: string | null = null
  let busy: string | undefined
  let refused: string | undefined
  let histories: Histories = {}
  const requirements = new Map<string, ReadonlyArray<EngineRequirement>>()
  const reads = new Map<string, number>()
  const historyReads = new Map<string, number>()
  let unsubscribe: () => void = () => undefined
  let gestures = 0
  const write = latestWrites()

  const emit = (): void => {
    if (stopped) return
    onView({
      data: state === null ? null : livingDataOf(state, requirements, noModel, clock()),
      error,
      opened,
      histories,
      busy,
      refused,
    })
  }

  const shownDomain = (): string | undefined =>
    state?.domains.find((one) => one.id === opened)?.id ?? state?.domains[0]?.id

  const setHistory = (id: string, value: 'loading' | readonly LivingChange[]): void => {
    histories = { ...histories, [id]: value }
  }

  /** Reads a domain's requirements; a read overtaken by a later one is not heard. */
  const readRequirements = (domainId: string): void => {
    const mine = (reads.get(domainId) ?? 0) + 1
    reads.set(domainId, mine)
    link.livingSpecRequirements(projectId, domainId).then(
      (read) => {
        if (stopped || reads.get(domainId) !== mine) return
        const before = requirements.get(domainId) ?? []
        requirements.set(domainId, read)
        // A requirement that changed while its history is shown has its history read again.
        for (const one of read) {
          const was = before.find((other) => other.id === one.id)
          if (was !== undefined && was.version !== one.version && histories[one.id] !== undefined) {
            readHistory(one.id)
          }
        }
        emit()
      },
      (failure: Error) => {
        if (stopped || reads.get(domainId) !== mine) return
        refused = failure.message
        emit()
      },
    )
  }

  function readHistory(requirementId: string): void {
    const mine = (historyReads.get(requirementId) ?? 0) + 1
    historyReads.set(requirementId, mine)
    link.livingSpecRequirement(requirementId).then(
      (detail) => {
        if (stopped || historyReads.get(requirementId) !== mine) return
        const now = clock()
        setHistory(
          requirementId,
          detail.history.map((one) => changeOf(one, now)),
        )
        emit()
      },
      (failure: Error) => {
        if (stopped || historyReads.get(requirementId) !== mine) return
        setHistory(requirementId, [])
        refused = failure.message
        emit()
      },
    )
  }

  let lastRun: string | null = null
  const readNeeds = (): void => {
    link.needs().then(
      (groups) => {
        if (stopped) return
        const now = noModelIn(groups, projectId)
        if (now === noModel) return
        noModel = now
        emit()
      },
      // Without the needs the page still draws: it only cannot say the model is missing.
      () => undefined,
    )
  }

  const heard = (next: LivingSpecState): void => {
    if (stopped) return
    const before = state
    state = next
    error = undefined
    const newest = next.runs[0]
    const run = newest === undefined ? null : `${newest.id}:${newest.state}`
    if (before === null || run !== lastRun) readNeeds()
    lastRun = run
    for (const domain of next.domains) {
      const was = before?.domains.find((one) => one.id === domain.id)
      const loaded = requirements.has(domain.id)
      const changed = was === undefined || JSON.stringify(was) !== JSON.stringify(domain)
      if (domain.id === shownDomain() ? !loaded || changed : loaded && changed) {
        readRequirements(domain.id)
      }
    }
    for (const id of [...requirements.keys()]) {
      if (!next.domains.some((one) => one.id === id)) requirements.delete(id)
    }
    emit()
  }

  const start = (): void => {
    unsubscribe = link.onLivingSpec(projectId, heard, (ended) => {
      if (stopped) return
      error = ended.message
      emit()
    })
  }
  start()

  /** Runs a gesture on `target`; its answer is heard only if no later gesture was made. */
  const gesture = <A>(
    target: string | undefined,
    run: () => Promise<A>,
    then: () => void,
  ): void => {
    gestures += 1
    const mine = gestures
    busy = target
    refused = undefined
    emit()
    write(
      run,
      () => {
        if (stopped) return
        if (mine === gestures) busy = undefined
        then()
        emit()
      },
      (failure) => {
        if (stopped) return
        if (mine === gestures) busy = undefined
        refused = failure.message
        emit()
      },
    )
  }

  /** The domain's requirements as the page shows them. */
  const shown = (domainId: string): ReadonlyArray<EngineRequirement> =>
    requirements.get(domainId) ?? []

  const domainOfRequirement = (requirementId: string): string | undefined =>
    [...requirements].find(([, list]) => list.some((one) => one.id === requirementId))?.[0]

  return {
    openDomain: (domainId) => {
      opened = domainId
      refused = undefined
      readRequirements(domainId)
      emit()
    },
    history: (requirementId) => {
      setHistory(requirementId, histories[requirementId] ?? 'loading')
      readHistory(requirementId)
      emit()
    },
    validate: (domainId) =>
      gesture(
        domainId,
        () => link.validateDomain(domainId, livingSeen(shown(domainId))),
        () => readRequirements(domainId),
      ),
    reject: (domainId) =>
      gesture(
        domainId,
        () => link.rejectDomain(domainId, livingSeen(shown(domainId))),
        () => readRequirements(domainId),
      ),
    drop: (requirementId) =>
      gesture(
        requirementId,
        () => link.dropRequirement(requirementId),
        () => {
          const domainId = domainOfRequirement(requirementId)
          if (domainId !== undefined) readRequirements(domainId)
        },
      ),
    reread: (domainId) =>
      gesture(
        domainId,
        () => link.bootstrapLivingSpec(projectId, domainId),
        () => undefined,
      ),
    read: () =>
      gesture(
        undefined,
        () => link.bootstrapLivingSpec(projectId),
        () => undefined,
      ),
    retry: () => {
      unsubscribe()
      error = undefined
      state = null
      emit()
      start()
    },
    stop: () => {
      stopped = true
      unsubscribe()
    },
  }
}
