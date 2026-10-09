import type { JournalTail, Mission, MissionsChange, OpenQuestion, SincePage } from '@hemera/ipc'
import { HomePage, type AppSection, type HomePageProps, type HomeSinceGroup } from '@hemera/ui'
import { Predicate } from 'effect'
import { useEffect, useRef, useState, type ReactNode } from 'react'

import {
  UNSEEN,
  leavesLooked,
  mergeSince,
  questionRowsOf,
  refreshSince,
  recentRowsOf,
  sightAfter,
  sinceCursorOf,
  sinceGroupsOf,
} from './home-model.ts'
import type { Link } from './link.ts'
import { handlersFor, needRowsOf, type NeedsState } from './needs.ts'
import type { ProjectsState } from './projects.ts'
import type { ShellActions } from './shell.tsx'

export interface HomeRouteProps {
  link: Link
  engineReady: boolean
  /** Today, as Home's header says it. */
  today: string
  /** Now, which each need's "when" is counted from. */
  now: Date
  projects: ProjectsState
  needs: NeedsState
  /** What the route asks Home to show: one Project's needs, one need unfolded. */
  focus: { projectId?: string | undefined; need?: string | undefined }
  /** Home before the first Project, while nothing waits: the agents and the ways in. */
  firstLaunch: ReactNode
  actions: {
    answer: ShellActions['answer']
    recheck: ShellActions['recheck']
    openSettings: (section: AppSection) => void
    addProject: () => void
    retry: () => void
    openMission: (projectId: string, key: string) => void
  }
}

/** What Home has read: each list is null until its read has answered. */
export interface HomeData {
  questions: ReadonlyArray<OpenQuestion> | null
  since: {
    /** The newest page, heard again after each event worth telling. */
    first: SincePage | null
    /** The older pages asked for, the nearest first. */
    older: ReadonlyArray<SincePage>
    loadingMore: boolean
  }
  recent: { missions: ReadonlyArray<Mission>; tails: ReadonlyArray<JournalTail> } | null
  /** Why a list could not be read, in the engine's words. */
  failure: string | undefined
}

export const NO_HOME_DATA: HomeData = {
  questions: null,
  since: { first: null, older: [], loadingMore: false },
  recent: null,
  failure: undefined,
}

export type HomeView =
  | { readonly kind: 'firstLaunch' }
  | { readonly kind: 'page'; readonly page: HomePageProps }

/** Home from what the window holds and what it has read: the first launch, or the page. */
export function homeViewOf(props: HomeRouteProps, data: HomeData, onMore: () => void): HomeView {
  const { projects, needs, focus, actions, now } = props
  const listed = projects.kind === 'ready' ? projects.projects : []
  const rows = needRowsOf(needs, listed, now, focus.projectId)
  // Something waiting is read on Home, which says it; otherwise the first launch's ways in.
  if (
    projects.kind === 'ready' &&
    needs.kind === 'ready' &&
    listed.length === 0 &&
    rows.length === 0
  ) {
    return { kind: 'firstLaunch' }
  }
  const failure =
    projects.kind === 'failed'
      ? projects.sentence
      : needs.kind === 'failed'
        ? needs.sentence
        : data.failure
  const tools = {
    answer: actions.answer,
    recheck: actions.recheck,
    openSettings: actions.openSettings,
  }
  const groups = sinceGroupsOf(
    mergeSince([data.since.first, ...data.since.older].filter(Predicate.isNotNull)),
    listed,
    now,
  )
  // A row names its mission by id; the route opens it by its Project and key.
  const places = new Map<string, { projectId: string; key: string }>()
  for (const one of data.questions ?? []) {
    places.set(one.missionId, { projectId: one.projectId, key: one.missionKey })
  }
  for (const one of data.since.first?.groups ?? []) {
    if (one.missionId !== null && one.missionKey !== null) {
      places.set(one.missionId, { projectId: one.projectId, key: one.missionKey })
    }
  }
  for (const one of data.since.older.flatMap((page) => page.groups)) {
    if (one.missionId !== null && one.missionKey !== null) {
      places.set(one.missionId, { projectId: one.projectId, key: one.missionKey })
    }
  }
  for (const one of data.recent?.missions ?? []) {
    places.set(one.id, { projectId: one.projectId, key: one.key })
  }
  return {
    kind: 'page',
    page: {
      today: props.today,
      // Something waiting is shown even before the first Project: Git missing, say.
      hasProjects: projects.kind !== 'ready' || projects.projects.length > 0 || rows.length > 0,
      needs: {
        rows,
        projects: ['Hemera', ...listed.map((one) => one.name)],
        open: focus.need,
        onOpenMission: (id) => {
          const owner =
            needs.kind === 'ready' ? needs.needs.find((one) => one.id === id)?.owner : undefined
          if (owner === undefined || !Predicate.isTagged(owner, 'Mission')) return
          const key = needs.kind === 'ready' ? needs.missions.get(owner.missionId)?.key : undefined
          if (key !== undefined) actions.openMission(owner.projectId, key)
        },
        on: (id) => {
          const need = needs.kind === 'ready' ? needs.needs.find((one) => one.id === id) : undefined
          return need === undefined ? {} : handlersFor(need, tools)
        },
      },
      questions: questionRowsOf(data.questions ?? [], now),
      since: {
        groups,
        more: sinceCursorOf(data.since.first, data.since.older) !== null,
        loadingMore: data.since.loadingMore,
        onMore,
      },
      recent: recentRowsOf(data.recent?.missions ?? [], data.recent?.tails ?? [], listed, now),
      loading: projects.kind === 'loading' || needs.kind === 'loading',
      reading: data.questions === null || data.since.first === null || data.recent === null,
      error: failure,
      onOpen: (missionId) => {
        const place = places.get(missionId)
        if (place !== undefined) actions.openMission(place.projectId, place.key)
      },
      onAddProject: actions.addProject,
      onRetry: actions.retry,
    },
  }
}

/**
 * What Home reads once the engine answers: the open questions and the newest page of Since you
 * left, each followed; Recent and its Journal lines, read again whenever a mission changes; and
 * the older pages, asked for one at a time.
 */
function useHomeData(
  link: Link,
  engineReady: boolean,
  attempt: number,
): [HomeData, (cursor: number | null) => void] {
  const [data, setData] = useState<HomeData>(NO_HOME_DATA)
  useEffect(() => {
    if (!engineReady) return undefined
    let stopped = false
    let turn = 0
    const fail = (error: Error): void => {
      if (!stopped) setData((now) => ({ ...now, failure: error.message }))
    }
    const stopQuestions = link.onOpenQuestions((questions) => {
      if (!stopped) setData((now) => ({ ...now, questions }))
    }, fail)
    const stopSince = link.onSinceYouLeft((first) => {
      if (!stopped) {
        setData((now) => ({ ...now, since: { ...now.since, ...refreshSince(now.since, first) } }))
      }
    }, fail)
    // Recent, then the last Journal line of each: shown together, so no row grows after it came.
    const read = (): void => {
      turn += 1
      const mine = turn
      link
        .recentMissions()
        .then(async (missions) => {
          const tails =
            missions.length === 0 ? [] : await link.journalTail(missions.map((one) => one.id))
          if (!stopped && mine === turn) setData((now) => ({ ...now, recent: { missions, tails } }))
        })
        .catch(fail)
    }
    read()
    const stopChanges = link.onMissionChanges((change: MissionsChange) => {
      if (Predicate.isTagged(change, 'MissionChanged')) read()
    }, fail)
    return () => {
      stopped = true
      stopQuestions()
      stopSince()
      stopChanges()
      setData(NO_HOME_DATA)
    }
  }, [link, engineReady, attempt])
  const older = (cursor: number | null): void => {
    if (cursor === null || data.since.loadingMore) return
    setData((now) => ({ ...now, since: { ...now.since, loadingMore: true } }))
    link.sinceYouLeft(cursor).then(
      (page) => {
        setData((now) => ({
          ...now,
          since: { ...now.since, older: [...now.since.older, page], loadingMore: false },
        }))
      },
      (error: Error) => {
        setData((now) => ({
          ...now,
          failure: error.message,
          since: { ...now.since, loadingMore: false },
        }))
      },
    )
  }
  return [data, older]
}

/** What the window offers the watch over Home's sight: its focus and when it is hidden or closed. */
export interface LookedEnvironment {
  readonly window: EventTarget
  readonly document: EventTarget & { readonly visibilityState: string; hasFocus: () => boolean }
}

export interface LookedWatch {
  /** Home is shown with its content (or not), and `upTo` is the highest event it draws. */
  readonly update: (now: { shown: boolean; upTo: number }) => void
  /** Home is left: what was seen is told, and the watch ends. */
  readonly stop: () => void
}

/**
 * Tells the engine what the user looked at: the events drawn on Home, up to the highest one,
 * once Home was shown with its content while the window had the focus. It is told on leaving
 * Home, and also when the window is hidden or closed on Home, which no unmount would report.
 */
export function watchLooked(
  link: Pick<Link, 'lookedAtHome'>,
  env: LookedEnvironment,
  initial: { shown: boolean; upTo: number } = { shown: false, upTo: 0 },
): LookedWatch {
  let sight = sightAfter(UNSEEN, { focused: env.document.hasFocus() })
  let state = initial
  let told = 0
  const tell = (): void => {
    if (!leavesLooked(sight) || state.upTo <= told) return
    told = state.upTo
    link.lookedAtHome(state.upTo).catch(() => undefined)
  }
  const gained = (): void => {
    sight = sightAfter(sight, { focused: true })
  }
  const lost = (): void => {
    sight = sightAfter(sight, { focused: false })
  }
  const hidden = (): void => {
    if (env.document.visibilityState === 'hidden') tell()
  }
  env.window.addEventListener('focus', gained)
  env.window.addEventListener('blur', lost)
  env.window.addEventListener('beforeunload', tell)
  env.document.addEventListener('visibilitychange', hidden)
  sight = sightAfter(sight, { shown: state.shown })
  return {
    update: (now) => {
      state = now
      sight = sightAfter(sight, { shown: now.shown })
    },
    stop: () => {
      env.window.removeEventListener('focus', gained)
      env.window.removeEventListener('blur', lost)
      env.window.removeEventListener('beforeunload', tell)
      env.document.removeEventListener('visibilitychange', hidden)
      tell()
    },
  }
}

/** The highest event Home draws, the one the user has seen up to. */
export const renderedUpTo = (groups: ReadonlyArray<HomeSinceGroup>): number =>
  Math.max(0, ...groups.flatMap((one) => one.events.map((event) => Number(event.id))))

function useLooked(link: Link, shown: boolean, upTo: number): void {
  const watch = useRef<LookedWatch | null>(null)
  useEffect(() => {
    const kept = watchLooked(link, { window, document })
    watch.current = kept
    return () => {
      watch.current = null
      kept.stop()
    }
  }, [link])
  useEffect(() => {
    watch.current?.update({ shown, upTo })
  }, [shown, upTo])
}

/** Home drawn from what was read: the page, or the first launch. */
export function HomeBody(
  props: HomeRouteProps & { data: HomeData; onMore: () => void },
): ReactNode {
  const view = homeViewOf(props, props.data, props.onMore)
  if (view.kind === 'firstLaunch') return props.firstLaunch
  return (
    <HomePage
      // A need led to by its notification is unfolded: the list opens on it.
      key={props.focus.need ?? ''}
      {...view.page}
    />
  )
}

/** Home: what happened since the user left, what was opened last, and what calls. */
export function HomeRoute(props: HomeRouteProps): ReactNode {
  const { link, engineReady, actions } = props
  const [attempt, setAttempt] = useState(0)
  const [data, older] = useHomeData(link, engineReady, attempt)
  const view = homeViewOf(props, data, () =>
    older(sinceCursorOf(data.since.first, data.since.older)),
  )
  useLooked(
    link,
    view.kind === 'page' &&
      view.page.loading !== true &&
      view.page.reading !== true &&
      view.page.error === undefined,
    view.kind === 'page' ? renderedUpTo(view.page.since.groups) : 0,
  )
  return (
    <HomeBody
      {...props}
      actions={{
        ...actions,
        retry: () => {
          setAttempt((one) => one + 1)
          actions.retry()
        },
      }}
      data={data}
      onMore={() => older(sinceCursorOf(data.since.first, data.since.older))}
    />
  )
}
