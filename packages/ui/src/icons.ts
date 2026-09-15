/**
 * The icon catalogue: the only door Tabler comes through (design D1-05).
 *
 * Tabler ships five thousand icons at whatever size and stroke the caller asks for. What
 * Hemera wants is a short list drawn the same way everywhere, so each entry is re-exported
 * already sized on a step of the icon scale and already at the application's weight. The
 * boundary check refuses `@tabler/icons-react` anywhere but here, which is what keeps the
 * list short and keeps a hand-written SVG out of the repository.
 *
 * Outlined, at Tabler's own stroke rather than below it. A thinner stroke is what made these
 * look muddy at the sizes an interface actually uses, and a heavier one is the cure; going
 * solid is not. "Filled" is not a uniform mode in Tabler — for an icon whose meaning lives in
 * its outline the filled variant drops the part that carries it, and the sun loses its rays
 * and becomes a dot. `weight="filled"` is kept for the few where a solid shape reads better:
 * a warning, a trash can, a gear.
 */

import {
  IconAlertTriangle as TablerAlertTriangle,
  IconAlertTriangleFilled as TablerAlertTriangleFilled,
  IconBell as TablerBell,
  IconBellFilled as TablerBellFilled,
  IconCheck as TablerCheck,
  IconCheckFilled as TablerCheckFilled,
  IconChevronDown as TablerChevronDown,
  IconChevronDownFilled as TablerChevronDownFilled,
  IconChevronUp as TablerChevronUp,
  IconCommand as TablerCommand,
  IconLayoutSidebar as TablerLayoutSidebar,
  IconLayoutSidebarFilled as TablerLayoutSidebarFilled,
  IconMessages as TablerMessages,
  IconMessagesFilled as TablerMessagesFilled,
  IconMoon as TablerMoon,
  IconMoonFilled as TablerMoonFilled,
  IconPlayerPlay as TablerPlayerPlay,
  IconPlayerPlayFilled as TablerPlayerPlayFilled,
  IconPlus as TablerPlus,
  IconPlusFilled as TablerPlusFilled,
  IconSearch as TablerSearch,
  IconSearchFilled as TablerSearchFilled,
  IconSettings as TablerSettings,
  IconSettingsFilled as TablerSettingsFilled,
  IconSun as TablerSun,
  IconSunFilled as TablerSunFilled,
  IconTimelineEvent as TablerTimelineEvent,
  IconTimelineEventFilled as TablerTimelineEventFilled,
  IconTrash as TablerTrash,
  IconTrashFilled as TablerTrashFilled,
  IconX as TablerX,
  IconXFilled as TablerXFilled,
  type IconProps as TablerIconProps,
  type TablerIcon,
} from '@tabler/icons-react'
import { cn } from 'cn'
import { type FunctionComponent, createElement } from 'react'

/** The steps an icon is drawn at; each one is a named step of the theme's spacing scale. */
export type IconSize = 'sm' | 'md' | 'lg'

/** The two hairlines, or solid. */
export type IconWeight = 'outline' | 'filled'

const SIZE_CLASS: Record<IconSize, string> = {
  sm: 'size-icon-sm',
  md: 'size-icon-md',
  lg: 'size-icon-lg',
}

/** The stroke an outlined icon is drawn with. Tabler's own: anything lighter turns to mush. */
const STROKE = 2

export interface IconProps extends Omit<TablerIconProps, 'size' | 'stroke'> {
  /** One step of the icon scale; `md` unless said otherwise. */
  size?: IconSize
  /** `outline` unless a solid shape reads better, which is rarer than it sounds. */
  weight?: IconWeight
}

/**
 * One icon of the catalogue, at the application's weight and sized by the scale rather than by
 * a number. The size lands as a class and not as a `width` attribute so that it stays a step of
 * the scale the lint knows, and the colour is left alone: Tabler draws in `currentColor`, so an
 * icon takes the colour of the text it sits in.
 */
function catalogued(
  filled: TablerIcon,
  outline: TablerIcon,
  name: string,
): FunctionComponent<IconProps> {
  const Catalogued: FunctionComponent<IconProps> = ({
    size = 'md',
    weight = 'outline',
    className,
    ...rest
  }) =>
    createElement(weight === 'filled' ? filled : outline, {
      ...rest,
      stroke: STROKE,
      className: cn(SIZE_CLASS[size], className),
    })
  Catalogued.displayName = name
  return Catalogued
}

export const IconAlertTriangle = catalogued(
  TablerAlertTriangleFilled,
  TablerAlertTriangle,
  'IconAlertTriangle',
)
export const IconBell = catalogued(TablerBellFilled, TablerBell, 'IconBell')
export const IconCheck = catalogued(TablerCheckFilled, TablerCheck, 'IconCheck')
export const IconChevronDown = catalogued(
  TablerChevronDownFilled,
  TablerChevronDown,
  'IconChevronDown',
)
/* Tabler draws a solid chevron pointing down and none pointing up; the outline stands for
   both weights, which is what a chevron is anyway. */
export const IconChevronUp = catalogued(TablerChevronUp, TablerChevronUp, 'IconChevronUp')
/* Tabler draws no solid command key: the outline stands for both weights, which is what a
   key cap looks like anyway. */
export const IconCommand = catalogued(TablerCommand, TablerCommand, 'IconCommand')
export const IconLayoutSidebar = catalogued(
  TablerLayoutSidebarFilled,
  TablerLayoutSidebar,
  'IconLayoutSidebar',
)
export const IconMessages = catalogued(TablerMessagesFilled, TablerMessages, 'IconMessages')
export const IconMoon = catalogued(TablerMoonFilled, TablerMoon, 'IconMoon')
export const IconPlayerPlay = catalogued(TablerPlayerPlayFilled, TablerPlayerPlay, 'IconPlayerPlay')
export const IconPlus = catalogued(TablerPlusFilled, TablerPlus, 'IconPlus')
export const IconSearch = catalogued(TablerSearchFilled, TablerSearch, 'IconSearch')
export const IconSettings = catalogued(TablerSettingsFilled, TablerSettings, 'IconSettings')
export const IconSun = catalogued(TablerSunFilled, TablerSun, 'IconSun')
export const IconTimelineEvent = catalogued(
  TablerTimelineEventFilled,
  TablerTimelineEvent,
  'IconTimelineEvent',
)
export const IconTrash = catalogued(TablerTrashFilled, TablerTrash, 'IconTrash')
export const IconX = catalogued(TablerXFilled, TablerX, 'IconX')
