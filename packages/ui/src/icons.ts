/**
 * The icon catalogue: the only door Tabler comes through.
 *
 * Tabler ships five thousand icons at whatever size and stroke the caller asks for. What Hemera
 * wants is a short list drawn the same way everywhere, so each entry is re-exported already sized
 * on a step of the icon scale and at the application's weight. An icon a component needs is added
 * here, never imported from Tabler beside it.
 *
 * Outlined, at Tabler's own stroke: a thinner one looks muddy at the sizes an interface uses.
 * `weight="filled"` is kept for the few where a solid shape reads better.
 */

import {
  IconAlertTriangle as TablerAlertTriangle,
  IconAlertTriangleFilled as TablerAlertTriangleFilled,
  IconCheck as TablerCheck,
  IconCheckFilled as TablerCheckFilled,
  IconChevronDown as TablerChevronDown,
  IconChevronDownFilled as TablerChevronDownFilled,
  IconClockPause as TablerClockPause,
  IconCopy as TablerCopy,
  IconCopyFilled as TablerCopyFilled,
  IconDots as TablerDots,
  IconDotsFilled as TablerDotsFilled,
  IconFolder as TablerFolder,
  IconFolderFilled as TablerFolderFilled,
  IconGitBranch as TablerGitBranch,
  IconPencil as TablerPencil,
  IconPencilFilled as TablerPencilFilled,
  IconPlayerStop as TablerPlayerStop,
  IconPlayerStopFilled as TablerPlayerStopFilled,
  IconPlus as TablerPlus,
  IconPlusFilled as TablerPlusFilled,
  IconSearch as TablerSearch,
  IconSearchFilled as TablerSearchFilled,
  IconSettings as TablerSettings,
  IconSettingsFilled as TablerSettingsFilled,
  IconTerminal as TablerTerminal,
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

/** The outline, or solid. */
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
 * One icon of the catalogue, at the application's weight and sized by the scale. The size lands
 * as a class and not as a `width` attribute, so it stays a step of the scale; the colour is left
 * alone: Tabler draws in `currentColor`, so an icon takes the colour of the text it sits in.
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
export const IconCheck = catalogued(TablerCheckFilled, TablerCheck, 'IconCheck')
export const IconChevronDown = catalogued(
  TablerChevronDownFilled,
  TablerChevronDown,
  'IconChevronDown',
)
export const IconClockPause = catalogued(TablerClockPause, TablerClockPause, 'IconClockPause')
export const IconCopy = catalogued(TablerCopyFilled, TablerCopy, 'IconCopy')
export const IconDots = catalogued(TablerDotsFilled, TablerDots, 'IconDots')
export const IconFolder = catalogued(TablerFolderFilled, TablerFolder, 'IconFolder')
export const IconGitBranch = catalogued(TablerGitBranch, TablerGitBranch, 'IconGitBranch')
export const IconPencil = catalogued(TablerPencilFilled, TablerPencil, 'IconPencil')
export const IconPlayerStop = catalogued(TablerPlayerStopFilled, TablerPlayerStop, 'IconPlayerStop')
export const IconPlus = catalogued(TablerPlusFilled, TablerPlus, 'IconPlus')
export const IconSearch = catalogued(TablerSearchFilled, TablerSearch, 'IconSearch')
export const IconSettings = catalogued(TablerSettingsFilled, TablerSettings, 'IconSettings')
export const IconTerminal = catalogued(TablerTerminal, TablerTerminal, 'IconTerminal')
export const IconTrash = catalogued(TablerTrashFilled, TablerTrash, 'IconTrash')
export const IconX = catalogued(TablerXFilled, TablerX, 'IconX')
