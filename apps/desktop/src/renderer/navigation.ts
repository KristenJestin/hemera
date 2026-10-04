/**
 * Where the window is, and how it moves: a route per page, and for a mission a base (the page of
 * its current stage) with views opened over it as a stack.
 *
 * Plain values and functions, no React: the hook that holds a `Navigation` is `use-navigation.ts`.
 * A mission's base and its views are kept per mission while the window shows another page, so
 * coming back finds the views it had open; the base itself stays mounted under its views, which
 * is what keeps its scroll, its folds and its choice (`MissionFrame`).
 */

import {
  AT_BASE,
  closeView,
  openView,
  showView,
  type MissionFrameState,
  type SidebarPlace,
} from '@hemera/ui'

export type Route =
  | { readonly kind: 'home' }
  | { readonly kind: 'settings' }
  | { readonly kind: 'project'; readonly id: string }
  /** The settings of a Project: its own page, entered from the Project page's header. */
  | { readonly kind: 'projectSettings'; readonly id: string }
  | { readonly kind: 'mission'; readonly projectId: string; readonly key: string }

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

/** The place the sidebar marks for a page: a Project's settings are under the Project. */
export function placeOf(route: Route): SidebarPlace {
  switch (route.kind) {
    case 'home':
      return { kind: 'home' }
    case 'settings':
      return { kind: 'settings' }
    case 'project':
    case 'projectSettings':
      return { kind: 'project', id: route.id }
    case 'mission':
      return { kind: 'mission', key: route.key }
  }
}

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
}

/** The window's one breadcrumb: the page, then for a mission its key and the views over it. */
export function trailOf(navigation: Navigation, names: Names): Trail[] {
  const { route } = navigation
  const project = (id: string): string => names.project(id) ?? 'Project'
  switch (route.kind) {
    case 'home':
      return [{ id: 'home', label: 'Home' }]
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
