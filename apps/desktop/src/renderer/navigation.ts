/**
 * Where the window is, and how it moves: a route per page, and for a mission a base (the page of
 * its current stage) with views opened over it as a stack.
 *
 * Plain values and functions, no React: the hook that holds a `Navigation` is `use-navigation.ts`.
 * A mission's base and its views are kept per mission while the window shows another page, so
 * coming back finds the views it had open; the base itself stays mounted under its views, which
 * is what keeps its scroll, its folds and its choice (`MissionFrame`).
 */

import type { NotificationTarget } from '@hemera/ipc'
import { Match } from 'effect'
import {
  AT_BASE,
  closeView,
  openView,
  showView,
  type AppSection,
  type MissionFrameState,
  type SidebarPlace,
} from '@hemera/ui'

export type Route =
  | {
      readonly kind: 'home'
      /** Needs you filtered to one Project's needs, as a notification about it leads there. */
      readonly projectId?: string | undefined
      /** The need unfolded in Needs you, as its notification leads to it. */
      readonly need?: string | undefined
    }
  /**
   * At a section, when a need or a notification about a setting opens it: `linked`, its heading
   * takes the focus.
   */
  | {
      readonly kind: 'settings'
      readonly section?: AppSection | undefined
      readonly linked?: boolean | undefined
    }
  | { readonly kind: 'project'; readonly id: string }
  /** The settings of a Project: its own page, entered from the Project page's header. */
  | { readonly kind: 'projectSettings'; readonly id: string }
  | { readonly kind: 'mission'; readonly projectId: string; readonly key: string }
  /** What the setup agent proposes for a Project just added, and the user's answers. */
  | {
      readonly kind: 'projectSetup'
      readonly id: string
      /** Why the setup could not start or be read, in words: the page says it, with Try again. */
      readonly refused?: string | undefined
    }
  /** A Chat of a Project: listed under it in the sidebar. */
  | { readonly kind: 'chat'; readonly projectId: string; readonly id: string }

export interface Navigation {
  readonly route: Route
  /** The views open over each mission's base, by mission key, kept while another page shows. */
  readonly missions: ReadonlyMap<string, MissionFrameState>
}

export const START: Navigation = { route: { kind: 'home' }, missions: new Map() }

/** Goes to a page; a mission found again keeps the views it had open. */
export function go(navigation: Navigation, route: Route): Navigation {
  return { ...navigation, route }
}

/** The base and the views over it of a mission: its base alone until a view is opened. */
export function frameOf(navigation: Navigation, key: string): MissionFrameState {
  return navigation.missions.get(key) ?? AT_BASE
}

/** Changes the views over the mission the window shows; anywhere else, nothing changes. */
function overMission(
  navigation: Navigation,
  change: (state: MissionFrameState) => MissionFrameState,
): Navigation {
  const { route } = navigation
  if (route.kind !== 'mission') return navigation
  const missions = new Map(navigation.missions)
  missions.set(route.key, change(frameOf(navigation, route.key)))
  return { ...navigation, missions }
}

/** Opens a view over the mission's base, on top of the stack. */
export function open(navigation: Navigation, view: string): Navigation {
  return overMission(navigation, (state) => openView(state, view))
}

/** Shows a view of the stack, closing those above it; null goes back to the base. */
export function show(navigation: Navigation, view: string | null): Navigation {
  return overMission(navigation, (state) => showView(state, view))
}

export function close(navigation: Navigation, view: string): Navigation {
  return overMission(navigation, (state) => closeView(state, view))
}

/**
 * Where a notification leads: a need, Home with that Project's needs and the need unfolded, where
 * it is answered (the mission's page, where its card will also be, is not built yet); a mission,
 * its page; a Project, its page; a group, Home, filtered to its Project when it has one.
 */
export const routeOf = (target: NotificationTarget): Route =>
  Match.value(target).pipe(
    Match.tags({
      Need: ({ projectId, needId }): Route => ({ kind: 'home', projectId, need: needId }),
      Mission: ({ projectId, missionKey }): Route => ({
        kind: 'mission',
        projectId,
        key: missionKey,
      }),
      Project: ({ projectId }): Route => ({ kind: 'project', id: projectId }),
      Home: ({ projectId }): Route =>
        projectId === null ? { kind: 'home' } : { kind: 'home', projectId },
    }),
    Match.exhaustive,
  )

/** The place the sidebar marks for a page: a Project's settings are under the Project. */
export function placeOf(route: Route): SidebarPlace {
  switch (route.kind) {
    case 'home':
      return { kind: 'home' }
    case 'settings':
      return { kind: 'settings' }
    case 'project':
    case 'projectSettings':
    case 'projectSetup':
      return { kind: 'project', id: route.id }
    case 'mission':
      return { kind: 'mission', key: route.key }
    case 'chat':
      return { kind: 'chat', id: route.id }
  }
}

/**
 * Where an answer of the engine leads, if the user is still on the page it was asked from: one who
 * moved to another page meanwhile stays there.
 */
export const goIfStill = (navigation: Navigation, from: Route, to: Route): Navigation =>
  navigation.route === from ? go(navigation, to) : navigation

/** Settings at a section a link names: a need's "Open Settings", a notification's. */
export const linkedSettings = (section: AppSection): Route => ({
  kind: 'settings',
  section,
  linked: true,
})

/** Whether the section a route shows was opened by a link, so its heading takes the focus. */
export const focusOf = (route: Route): boolean => route.kind === 'settings' && route.linked === true

/** The section of Settings a route shows: Appearance unless it names one. */
export const sectionOf = (route: Route): AppSection =>
  route.kind === 'settings' ? (route.section ?? 'appearance') : 'appearance'

/** Where a crumb leads: to a page, or within the mission shown, to a view or back to its base. */
export type Step = { readonly go: Route } | { readonly show: string | null }

export interface Trail {
  readonly id: string
  readonly label: string
  readonly mono?: boolean
  /** Where it leads; the last crumb is where the window is and leads nowhere. */
  readonly step?: Step
}

export interface Names {
  /** A Project's name, when the window knows it. */
  readonly project: (id: string) => string | undefined
  /** A view's title, as the view declares it. */
  readonly view: (id: string) => string
  /** A Chat's title, when the window knows it. */
  readonly chat: (id: string) => string | undefined
}

/** The window's one breadcrumb: the page, then for a mission its key and the views over it. */
export function trailOf(navigation: Navigation, names: Names): Trail[] {
  const { route } = navigation
  const project = (id: string): string => names.project(id) ?? 'Project'
  switch (route.kind) {
    case 'home':
      return route.projectId === undefined
        ? [{ id: 'home', label: 'Home' }]
        : [
            { id: 'home', label: 'Home', step: { go: { kind: 'home' } } },
            { id: 'project', label: project(route.projectId) },
          ]
    case 'settings':
      return [{ id: 'settings', label: 'Settings' }]
    case 'project':
      return [{ id: 'project', label: project(route.id) }]
    case 'projectSettings':
      return [
        {
          id: 'project',
          label: project(route.id),
          step: { go: { kind: 'project', id: route.id } },
        },
        { id: 'settings', label: 'Settings' },
      ]
    case 'projectSetup':
      return [
        {
          id: 'project',
          label: project(route.id),
          step: { go: { kind: 'project', id: route.id } },
        },
        { id: 'setup', label: 'Setup' },
      ]
    case 'chat':
      return [
        {
          id: 'project',
          label: project(route.projectId),
          step: { go: { kind: 'project', id: route.projectId } },
        },
        { id: 'chat', label: names.chat(route.id) ?? 'Chat' },
      ]
    case 'mission': {
      const { open: views } = frameOf(navigation, route.key)
      return [
        {
          id: 'project',
          label: project(route.projectId),
          step: { go: { kind: 'project', id: route.projectId } },
        },
        { id: 'mission', label: route.key, mono: true, step: { show: null } },
        ...views.map((view) => ({
          id: `view:${view}`,
          label: names.view(view),
          step: { show: view },
        })),
      ]
    }
  }
}
