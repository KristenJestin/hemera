/**
 * In-memory navigation of the window.
 *
 * There is no address bar and no history: the window holds one route at a time. The
 * demonstration route exists only in a `dev` package, so a `prod` package offers no way to
 * reach it — not a route, not an entry, not a shortcut.
 */

import type { Channel } from '../platform/channel.ts'

/** Routes the window can hold. */
export type Route = 'sessions' | 'showcase'

/** Routes a package of this channel exposes. */
export function routesOf(channel: Channel): Route[] {
  return channel === 'dev' ? ['sessions', 'showcase'] : ['sessions']
}

/** Whether a route can be reached from a package of this channel. */
export function canReach(route: Route, channel: Channel): boolean {
  return routesOf(channel).includes(route)
}

/** The route to open, falling back to the default when the asked one is out of reach. */
export function routeOrDefault(route: Route, channel: Channel): Route {
  return canReach(route, channel) ? route : 'sessions'
}
