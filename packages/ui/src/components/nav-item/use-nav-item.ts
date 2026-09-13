/** Behaviour of a navigation entry: the same selection rule as a list row. */

import { useListItem } from '../list-item/use-list-item.ts'
import type { ListItemBehaviour, UseListItemOptions } from '../list-item/use-list-item.ts'

export type UseNavItemOptions = UseListItemOptions
export type NavItemBehaviour = ListItemBehaviour

export function useNavItem(options: UseNavItemOptions): NavItemBehaviour {
  return useListItem(options)
}
