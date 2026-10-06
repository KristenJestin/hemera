/**
 * Needs you as the window follows it: every pending need of the Profile, read once and kept up to
 * date by the engine's changes, with the mission each one belongs to (for its key and its latest
 * activity), and the answers on their way from the cards. A need that ends stays a moment, settled,
 * before it leaves; one answered from a card does the same.
 *
 * Plain values and functions over the link, no React: the hook that holds them is
 * `use-needs.ts`, and the list and cards that draw them are the design system's.
 */

import {
  ChosenAnswer,
  PermissionAnswer,
  type NeedAnswer,
  type NeedFields,
} from '@hemera/core/domain'
import type { MissionsChange, Need, NeedAnswerAsked } from '@hemera/ipc'
import {
  APP_SECTIONS,
  type AppSection,
  type NeedAsk,
  type NeedCardProps,
  type NeedRow,
  type NeedState as CardState,
  type PermissionChoice,
} from '@hemera/ui'
import { Match, Predicate } from 'effect'

import type { Link } from './link.ts'

/** How long a need that ended stays in the list, settled, before it leaves. */
export const LINGER = 3000

/** What the list knows of a mission: its key, and when it last moved. */
export interface MissionSummary {
  readonly key: string
  readonly updatedAt: string
}

/** An answer from a card: on its way under its button's label, or refused with why. */
export type Answering = { readonly answering: string } | { readonly failure: string }

export type NeedsState =
  | { readonly kind: 'loading' }
  | {
      readonly kind: 'ready'
      /** Pending, and those that ended a moment ago, in the engine's order. */
      readonly needs: ReadonlyArray<Need>
      readonly missions: ReadonlyMap<string, MissionSummary>
      /** The answers on their way or refused, by need. */
      readonly answers: ReadonlyMap<string, Answering>
    }
  | { readonly kind: 'failed'; readonly sentence: string }

const pending = (need: Need): boolean => need.state === 'pending'

/** How many needs wait: the sidebar's badge and Needs you's count. */
export const waitingCount = (state: NeedsState): number =>
  state.kind === 'ready' ? state.needs.filter(pending).length : 0

/** A need as a change left it: in its place, or at the end when it is new and pending. */
export function needsAfter(needs: ReadonlyArray<Need>, changed: Need): ReadonlyArray<Need> {
  if (needs.some((one) => one.id === changed.id)) {
    return needs.map((one) => (one.id === changed.id ? changed : one))
  }
  return pending(changed) ? [...needs, changed] : needs
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY_OF = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' })

const dayOf = (date: Date): number =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()

/** When a need was raised, as its card says it: `now`, `4 min`, `2 h`, `yesterday`, `1 Oct`. */
export function whenOf(createdAt: string, now: Date): string {
  const at = new Date(createdAt)
  const since = now.getTime() - at.getTime()
  if (since < MINUTE) return 'now'
  if (since < HOUR) return `${String(Math.floor(since / MINUTE))} min`
  const days = Math.round((dayOf(now) - dayOf(at)) / (24 * HOUR))
  if (days === 0) return `${String(Math.floor(since / HOUR))} h`
  if (days === 1) return 'yesterday'
  return DAY_OF.format(at)
}

/** The label of each permission choice's button, which an answer on its way is known by. */
const CHOICE_LABELS: Record<PermissionChoice, string> = {
  'allow-once': 'Allow once',
  'allow-for-mission': 'Allow for this mission',
  deny: 'Deny',
}

/** What an applied permission says it did. */
const CHOICE_DONE: Record<PermissionChoice, string> = {
  'allow-once': 'Allowed once',
  'allow-for-mission': 'Allowed for this mission',
  deny: 'Denied',
}

const APPLY = 'Apply'
const RETRY = 'Retry'

const sectionOf = (id: string | null): AppSection | undefined =>
  [...APP_SECTIONS.keys()].find((section) => section === id)

/** The options of a decision, the recommended one first and marked with its reason. */
function optionsOf(
  fields: Extract<NeedFields, { _tag: 'Decision' }>,
): Array<{ label: string; recommended?: string }> {
  const { recommended } = fields
  const options = fields.options.map((label) =>
    recommended !== null && recommended.option === label
      ? { label, recommended: recommended.reason }
      : { label },
  )
  return [
    ...options.filter((option) => option.recommended !== undefined),
    ...options.filter((option) => option.recommended === undefined),
  ]
}

/** What the card of a need says, its title and text first, then what its kind asks. */
const wordsOf = (
  need: Need,
): { readonly title: string; readonly text?: string | undefined; readonly ask: NeedAsk } =>
  Match.value(need.fields).pipe(
    Match.tagsExhaustive({
      Environment: (fields) => {
        const section = sectionOf(fields.settingsSection)
        const label = section === undefined ? undefined : APP_SECTIONS.get(section)
        return {
          title: fields.missing,
          text: fields.action,
          ask:
            label === undefined
              ? { kind: 'environment' as const }
              : { kind: 'environment' as const, settings: label },
        }
      },
      Decision: (fields) => ({
        title: fields.question,
        ask: { kind: 'decision' as const, options: optionsOf(fields) },
      }),
      Error: (fields) => {
        const [proposed] = fields.proposals
        return {
          title: fields.failed,
          ask:
            proposed === undefined
              ? { kind: 'error' as const, attempts: fields.attempts }
              : { kind: 'error' as const, attempts: fields.attempts, proposed },
        }
      },
      // The engine gives a permission no title of its own: the agent's reason says what it wants.
      Permission: (fields) => ({
        title: fields.agentReason,
        ask: {
          kind: 'permission' as const,
          command: fields.call,
          hemeraReason: fields.hemeraReason,
          choices: need.choices,
        },
      }),
    }),
  )

/** What a need that ended says: the answer applied, or why it went. */
function statusOf(need: Need): CardState {
  switch (need.state) {
    case 'pending':
      return { state: 'waiting' }
    case 'answered':
      return { state: 'applied', answer: answerWords(need.answer) }
    // Withdrawn by its owner: what it waited for came about, which is said as it is.
    case 'withdrawn':
      return { state: 'applied', answer: need.endedReason ?? 'no longer needed' }
    case 'expired':
      return { state: 'expired', reason: need.endedReason ?? 'it no longer holds' }
  }
}

const answerWords = (answer: NeedAnswer | null): string =>
  answer === null
    ? 'answered'
    : Match.value(answer).pipe(
        Match.tagsExhaustive({
          Chosen: ({ option }) => option,
          Written: ({ text }) => text,
          Permission: ({ choice }) => CHOICE_DONE[choice],
        }),
      )

export type NeedCard = NeedRow['need']

/** The card of a need, with the key of its mission when it has one and the window knows it. */
export function cardOf(
  need: Need,
  now: Date,
  missionKey?: string | undefined,
  answering?: Answering | undefined,
): NeedCard {
  const words = wordsOf(need)
  return {
    ...words,
    missionKey,
    when: whenOf(need.createdAt, now),
    role: need.requestedBy ?? undefined,
    status: statusOf(need),
    answering:
      answering !== undefined && 'answering' in answering ? answering.answering : undefined,
    failure: answering !== undefined && 'failure' in answering ? answering.failure : undefined,
  }
}

/** Who a need belongs to, for the order of the list: the Project, and the mission in it. */
const projectOf = (need: Need): string | null =>
  Match.value(need.owner).pipe(
    Match.tag('Application', () => null),
    Match.orElse((owner) => owner.projectId),
  )

const missionOf = (need: Need): string | null =>
  Predicate.isTagged(need.owner, 'Mission') ? need.owner.missionId : null

export interface ListedProject {
  readonly id: string
  readonly name: string
}

/**
 * The rows of Needs you, in the order they wait in: Hemera's own first, then each Project in the
 * sidebar's order; within a Project, its own needs first, then its missions' by the latest
 * activity first; within each, the oldest first. Filtered to one Project when `projectId` says.
 */
export function needRowsOf(
  state: NeedsState,
  projects: ReadonlyArray<ListedProject>,
  now: Date,
  projectId?: string | undefined,
): NeedRow[] {
  if (state.kind !== 'ready') return []
  const { needs, missions, answers } = state
  const row = (need: Need, project: string): NeedRow => {
    const mission = missionOf(need)
    const key = mission === null ? undefined : missions.get(mission)?.key
    return { id: need.id, project, need: cardOf(need, now, key, answers.get(need.id)) }
  }
  const oldestFirst = (a: Need, b: Need): number => a.createdAt.localeCompare(b.createdAt)
  const activityOf = (mission: string, of: ReadonlyArray<Need>): string =>
    missions.get(mission)?.updatedAt ??
    of.reduce((latest, need) => (need.createdAt > latest ? need.createdAt : latest), '')
  const ofProject = (id: string, name: string): NeedRow[] => {
    const theirs = needs.filter((need) => projectOf(need) === id)
    const own = theirs.filter((need) => missionOf(need) === null).toSorted(oldestFirst)
    const byMission = new Map<string, Need[]>()
    for (const need of theirs) {
      const mission = missionOf(need)
      if (mission !== null) byMission.set(mission, [...(byMission.get(mission) ?? []), need])
    }
    const ordered = [...byMission.entries()].toSorted(([a, of], [b, other]) =>
      activityOf(b, other).localeCompare(activityOf(a, of)),
    )
    return [
      ...own.map((need) => row(need, name)),
      ...ordered.flatMap(([, of]) => of.toSorted(oldestFirst).map((need) => row(need, name))),
    ]
  }
  const known = new Set(projects.map((project) => project.id))
  const others = [...new Set(needs.flatMap((need) => projectOf(need) ?? [])).values()].filter(
    (id) => !known.has(id),
  )
  const rows = [
    ...needs
      .filter((need) => projectOf(need) === null)
      .toSorted(oldestFirst)
      .map((need) => row(need, 'Hemera')),
    ...projects.flatMap((project) => ofProject(project.id, project.name)),
    // A Project the sidebar does not list yet: its needs still show, under a plain name.
    ...others.flatMap((id) => ofProject(id, 'Project')),
  ]
  return projectId === undefined
    ? rows
    : rows.filter((one) =>
        needs.some((need) => need.id === one.id && projectOf(need) === projectId),
      )
}

/** What the window does for a card: answer, check again, open a setting. */
export interface NeedTools {
  readonly answer: (id: string, label: string, answer: NeedAnswer) => void
  readonly recheck: (id: string) => void
  readonly openSettings: (section: AppSection) => void
}

export type NeedHandlers = Pick<
  NeedCardProps,
  'onPermission' | 'onChoose' | 'onWrite' | 'onApply' | 'onRetry' | 'onSettings'
>

/**
 * What a card's buttons do. A decision is answered by its options alone (open question 7: no
 * answer of one's own in 1.0); an error's Apply chooses what it proposes.
 */
export function handlersFor(need: Need, tools: NeedTools): NeedHandlers {
  return Match.value(need.fields).pipe(
    Match.tagsExhaustive({
      Environment: (fields): NeedHandlers => {
        const section = sectionOf(fields.settingsSection)
        return {
          onRetry: () => tools.recheck(need.id),
          onSettings: section === undefined ? undefined : () => tools.openSettings(section),
        }
      },
      Decision: (): NeedHandlers => ({
        onChoose: (option) => tools.answer(need.id, option, ChosenAnswer.make({ option })),
      }),
      Error: (fields): NeedHandlers => {
        const [proposed] = fields.proposals
        return {
          onApply:
            proposed === undefined
              ? undefined
              : () => tools.answer(need.id, APPLY, ChosenAnswer.make({ option: proposed })),
        }
      },
      Permission: (): NeedHandlers => ({
        onPermission: (choice) =>
          tools.answer(need.id, CHOICE_LABELS[choice], PermissionAnswer.make({ choice })),
      }),
    }),
  )
}

export interface NeedsFollowing {
  /** Reads again, after a failure. */
  readonly retry: () => void
  readonly stop: () => void
  /** Sends a card's answer, known by its button's label while it is on its way. */
  readonly answer: (id: string, label: string, answer: NeedAnswer) => void
  /** Checks a need of something missing again. */
  readonly recheck: (id: string) => void
}

type NeedsLink = Pick<Link, 'needs' | 'mission' | 'answerNeed' | 'retryNeed' | 'onMissionChanges'>

/** Waits `LINGER`, then calls `end`; answers how to stop waiting. */
export type Linger = (end: () => void) => () => void

const lingerFor: Linger = (end) => {
  const timer = setTimeout(end, LINGER)
  return () => clearTimeout(timer)
}

const STILL_MISSING = 'It is still missing.'

/**
 * Follows Needs you: listening starts before the read, so a change heard while the read is on its
 * way is applied to what it answers. A need that ends stays `LINGER`, then leaves.
 */
export function followNeeds(
  link: NeedsLink,
  onState: (state: NeedsState) => void,
  linger: Linger = lingerFor,
): NeedsFollowing {
  let stopped = false
  let needs: ReadonlyArray<Need> | null = null
  let heard: MissionsChange[] = []
  const missions = new Map<string, MissionSummary>()
  const asked = new Set<string>()
  const answers = new Map<string, Answering>()
  const leaving = new Map<string, () => void>()
  let reads = 0

  const emit = (): void => {
    if (stopped || needs === null) return
    onState({ kind: 'ready', needs, missions: new Map(missions), answers: new Map(answers) })
  }

  /** Reads the missions of the needs that the window does not know yet, once each. */
  const readMissions = (): void => {
    for (const need of needs ?? []) {
      const mission = missionOf(need)
      if (mission === null || missions.has(mission) || asked.has(mission)) continue
      asked.add(mission)
      link.mission(mission).then(
        (found) => {
          missions.set(found.id, { key: found.key, updatedAt: found.updatedAt })
          emit()
        },
        // Without its mission, a need still shows, with no key.
        () => undefined,
      )
    }
  }

  const leave = (id: string): void => {
    leaving.delete(id)
    answers.delete(id)
    needs = (needs ?? []).filter((need) => need.id !== id)
    emit()
  }

  const apply = (changed: Need): void => {
    if (needs === null) return
    needs = needsAfter(needs, changed)
    if (!pending(changed) && needs.some((need) => need.id === changed.id)) {
      if (!leaving.has(changed.id))
        leaving.set(
          changed.id,
          linger(() => leave(changed.id)),
        )
    }
  }

  const hear = (change: MissionsChange): void =>
    Match.value(change).pipe(
      Match.tagsExhaustive({
        MissionChanged: ({ mission }) => {
          missions.set(mission.id, { key: mission.key, updatedAt: mission.updatedAt })
        },
        NeedChanged: ({ need }) => apply(need),
      }),
    )

  const unsubscribe = link.onMissionChanges(
    (change) => {
      if (needs === null) {
        heard.push(change)
        return
      }
      hear(change)
      readMissions()
      emit()
    },
    () => undefined,
  )

  const load = (): void => {
    reads += 1
    const asking = reads
    needs = null
    if (!stopped) onState({ kind: 'loading' })
    link.needs().then(
      (groups) => {
        if (asking !== reads) return
        needs = groups.flatMap((group) => group.needs)
        for (const change of heard) hear(change)
        heard = []
        readMissions()
        emit()
      },
      (failure: Error) => {
        if (asking !== reads || stopped) return
        onState({ kind: 'failed', sentence: failure.message })
      },
    )
  }

  /** Sends what a card asked, its button waiting until the engine answers. */
  const send = (
    id: string,
    label: string,
    ask: () => Promise<Need>,
    kept: (need: Need) => boolean,
  ) => {
    answers.set(id, { answering: label })
    emit()
    ask().then(
      (need) => {
        if (kept(need)) answers.set(id, { failure: STILL_MISSING })
        else answers.delete(id)
        apply(need)
        emit()
      },
      (failure: Error) => {
        answers.set(id, { failure: failure.message })
        emit()
      },
    )
  }

  load()
  return {
    retry: load,
    stop: () => {
      stopped = true
      unsubscribe()
      for (const stop of leaving.values()) stop()
    },
    answer: (id, label, answer) => {
      const asking: NeedAnswerAsked = { id, answer, key: crypto.randomUUID() }
      send(
        id,
        label,
        () => link.answerNeed(asking),
        () => false,
      )
    },
    recheck: (id) => send(id, RETRY, () => link.retryNeed(id), pending),
  }
}
