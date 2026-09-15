/**
 * The icon catalogue: the only door Tabler comes through (design D1-05).
 *
 * Tabler ships five thousand icons at whatever size and stroke the caller asks for. What
 * Hemera wants is a short list drawn the same way everywhere, so each entry is re-exported
 * already sized on a step of the icon scale and already at the application's stroke. The
 * boundary check refuses `@tabler/icons-react` anywhere but here, which is what keeps the
 * list short and keeps a hand-written SVG out of the repository.
 */

import {
  IconAlertTriangle as TablerAlertTriangle,
  IconCheck as TablerCheck,
  IconChevronDown as TablerChevronDown,
  IconMoon as TablerMoon,
  IconPlayerPlay as TablerPlayerPlay,
  IconPlus as TablerPlus,
  IconSearch as TablerSearch,
  IconSettings as TablerSettings,
  IconSun as TablerSun,
  IconTrash as TablerTrash,
  IconX as TablerX,
  type IconProps as TablerIconProps,
  type TablerIcon,
} from '@tabler/icons-react'
import { cn } from 'cn'
import { type FunctionComponent, createElement } from 'react'

/** The steps an icon is drawn at; each one is a named step of the theme's spacing scale. */
export type IconSize = 'sm' | 'md' | 'lg'

const SIZE_CLASS: Record<IconSize, string> = {
  sm: 'size-icon-sm',
  md: 'size-icon-md',
  lg: 'size-icon-lg',
}

/** The stroke every icon of the application is drawn with. */
const STROKE = 1.75

export interface IconProps extends Omit<TablerIconProps, 'size' | 'stroke'> {
  /** One step of the icon scale; `md` unless said otherwise. */
  size?: IconSize
}

/**
 * One Tabler icon, fixed at the application's stroke and sized by the scale rather than by a
 * number. The size lands as a class and not as a `width` attribute so that it stays a step of
 * the scale the lint knows, and the colour is left alone: Tabler already strokes in
 * `currentColor`, so an icon takes the colour of the text it sits in.
 */
function catalogued(icon: TablerIcon, name: string): FunctionComponent<IconProps> {
  const Catalogued: FunctionComponent<IconProps> = ({ size = 'md', className, ...rest }) =>
    createElement(icon, { ...rest, stroke: STROKE, className: cn(SIZE_CLASS[size], className) })
  Catalogued.displayName = name
  return Catalogued
}

export const IconAlertTriangle = catalogued(TablerAlertTriangle, 'IconAlertTriangle')
export const IconCheck = catalogued(TablerCheck, 'IconCheck')
export const IconChevronDown = catalogued(TablerChevronDown, 'IconChevronDown')
export const IconMoon = catalogued(TablerMoon, 'IconMoon')
export const IconPlayerPlay = catalogued(TablerPlayerPlay, 'IconPlayerPlay')
export const IconPlus = catalogued(TablerPlus, 'IconPlus')
export const IconSearch = catalogued(TablerSearch, 'IconSearch')
export const IconSettings = catalogued(TablerSettings, 'IconSettings')
export const IconSun = catalogued(TablerSun, 'IconSun')
export const IconTrash = catalogued(TablerTrash, 'IconTrash')
export const IconX = catalogued(TablerX, 'IconX')
