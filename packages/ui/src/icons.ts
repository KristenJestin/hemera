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
  IconActivity as TablerActivity,
  IconAlertTriangle as TablerAlertTriangle,
  IconAlertTriangleFilled as TablerAlertTriangleFilled,
  IconArchive as TablerArchive,
  IconArchiveFilled as TablerArchiveFilled,
  IconArrowUp as TablerArrowUp,
  IconAt as TablerAt,
  IconBell as TablerBell,
  IconBellFilled as TablerBellFilled,
  IconCheck as TablerCheck,
  IconCheckFilled as TablerCheckFilled,
  IconChevronDown as TablerChevronDown,
  IconChevronDownFilled as TablerChevronDownFilled,
  IconChevronLeft as TablerChevronLeft,
  IconChevronRight as TablerChevronRight,
  IconCommand as TablerCommand,
  IconDatabase as TablerDatabase,
  IconDatabaseFilled as TablerDatabaseFilled,
  IconDeviceDesktop as TablerDeviceDesktop,
  IconDeviceDesktopFilled as TablerDeviceDesktopFilled,
  IconDots as TablerDots,
  IconFileText as TablerFileText,
  IconFileTextFilled as TablerFileTextFilled,
  IconFolder as TablerFolder,
  IconFolderFilled as TablerFolderFilled,
  IconFolderOpen as TablerFolderOpen,
  IconFolderOpenFilled as TablerFolderOpenFilled,
  IconFolderPlus as TablerFolderPlus,
  IconGitBranch as TablerGitBranch,
  IconHome as TablerHome,
  IconHomeFilled as TablerHomeFilled,
  IconLayoutSidebar as TablerLayoutSidebar,
  IconLayoutSidebarFilled as TablerLayoutSidebarFilled,
  IconMessage as TablerMessage,
  IconMessageFilled as TablerMessageFilled,
  IconMessages as TablerMessages,
  IconMessagesFilled as TablerMessagesFilled,
  IconMoon as TablerMoon,
  IconMoonFilled as TablerMoonFilled,
  IconPaperclip as TablerPaperclip,
  IconPencil as TablerPencil,
  IconPencilFilled as TablerPencilFilled,
  IconPlayerPlay as TablerPlayerPlay,
  IconPlayerPlayFilled as TablerPlayerPlayFilled,
  IconPlayerStopFilled as TablerPlayerStopFilled,
  IconPlus as TablerPlus,
  IconPlusFilled as TablerPlusFilled,
  IconRestore as TablerRestore,
  IconPlugConnected as TablerPlugConnected,
  IconRobot as TablerRobot,
  IconSearch as TablerSearch,
  IconSparkles as TablerSparkles,
  IconSearchFilled as TablerSearchFilled,
  IconSettings as TablerSettings,
  IconSettingsFilled as TablerSettingsFilled,
  IconSun as TablerSun,
  IconSunFilled as TablerSunFilled,
  IconTimelineEvent as TablerTimelineEvent,
  IconTimelineEventFilled as TablerTimelineEventFilled,
  IconTrash as TablerTrash,
  IconTrashFilled as TablerTrashFilled,
  IconUser as TablerUser,
  IconUserFilled as TablerUserFilled,
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

export const IconActivity = catalogued(TablerActivity, TablerActivity, 'IconActivity')
export const IconAlertTriangle = catalogued(
  TablerAlertTriangleFilled,
  TablerAlertTriangle,
  'IconAlertTriangle',
)
export const IconArchive = catalogued(TablerArchiveFilled, TablerArchive, 'IconArchive')
/* Tabler draws no solid arrow, no solid at-sign and no solid paperclip: the outline stands for
   both weights, which is what a line pointing somewhere looks like anyway. */
export const IconArrowUp = catalogued(TablerArrowUp, TablerArrowUp, 'IconArrowUp')
export const IconAt = catalogued(TablerAt, TablerAt, 'IconAt')
export const IconBell = catalogued(TablerBellFilled, TablerBell, 'IconBell')
export const IconCheck = catalogued(TablerCheckFilled, TablerCheck, 'IconCheck')
export const IconChevronDown = catalogued(
  TablerChevronDownFilled,
  TablerChevronDown,
  'IconChevronDown',
)
/* Tabler draws a solid chevron pointing down and none pointing the other three ways; the
   outline stands for both weights, which is what a chevron is anyway. */
export const IconChevronLeft = catalogued(TablerChevronLeft, TablerChevronLeft, 'IconChevronLeft')
export const IconChevronRight = catalogued(
  TablerChevronRight,
  TablerChevronRight,
  'IconChevronRight',
)
/* Tabler draws no solid command key: the outline stands for both weights, which is what a
   key cap looks like anyway. */
export const IconCommand = catalogued(TablerCommand, TablerCommand, 'IconCommand')
export const IconDatabase = catalogued(TablerDatabaseFilled, TablerDatabase, 'IconDatabase')
export const IconDeviceDesktop = catalogued(
  TablerDeviceDesktopFilled,
  TablerDeviceDesktop,
  'IconDeviceDesktop',
)
/* The three dots a row wears to say it has a menu: Tabler draws no solid twin, and a solid
   one would read as three full stops anyway. */
export const IconDots = catalogued(TablerDots, TablerDots, 'IconDots')
export const IconFileText = catalogued(TablerFileTextFilled, TablerFileText, 'IconFileText')
export const IconFolder = catalogued(TablerFolderFilled, TablerFolder, 'IconFolder')
export const IconFolderOpen = catalogued(TablerFolderOpenFilled, TablerFolderOpen, 'IconFolderOpen')
/* A folder with a plus in it has no solid twin; the outline is the folder either way. */
export const IconFolderPlus = catalogued(TablerFolderPlus, TablerFolderPlus, 'IconFolderPlus')
export const IconGitBranch = catalogued(TablerGitBranch, TablerGitBranch, 'IconGitBranch')
export const IconHome = catalogued(TablerHomeFilled, TablerHome, 'IconHome')
export const IconLayoutSidebar = catalogued(
  TablerLayoutSidebarFilled,
  TablerLayoutSidebar,
  'IconLayoutSidebar',
)
export const IconMessage = catalogued(TablerMessageFilled, TablerMessage, 'IconMessage')
export const IconMessages = catalogued(TablerMessagesFilled, TablerMessages, 'IconMessages')
export const IconMoon = catalogued(TablerMoonFilled, TablerMoon, 'IconMoon')
export const IconPaperclip = catalogued(TablerPaperclip, TablerPaperclip, 'IconPaperclip')
export const IconPencil = catalogued(TablerPencilFilled, TablerPencil, 'IconPencil')
export const IconPlayerPlay = catalogued(TablerPlayerPlayFilled, TablerPlayerPlay, 'IconPlayerPlay')
/* The square that says "this is running, and pressing stops it" is solid in both weights: an
   outlined square at this size reads as an empty checkbox. */
export const IconPlayerStop = catalogued(
  TablerPlayerStopFilled,
  TablerPlayerStopFilled,
  'IconPlayerStop',
)
export const IconPlus = catalogued(TablerPlusFilled, TablerPlus, 'IconPlus')
/* Neither the arrow that brings something back nor the machine that will answer one day has a
   solid twin in Tabler; the outline stands for both weights. */
export const IconRestore = catalogued(TablerRestore, TablerRestore, 'IconRestore')
export const IconPlugConnected = catalogued(
  TablerPlugConnected,
  TablerPlugConnected,
  'IconPlugConnected',
)
export const IconRobot = catalogued(TablerRobot, TablerRobot, 'IconRobot')
export const IconSparkles = catalogued(TablerSparkles, TablerSparkles, 'IconSparkles')
export const IconSearch = catalogued(TablerSearchFilled, TablerSearch, 'IconSearch')
export const IconSettings = catalogued(TablerSettingsFilled, TablerSettings, 'IconSettings')
export const IconSun = catalogued(TablerSunFilled, TablerSun, 'IconSun')
export const IconTimelineEvent = catalogued(
  TablerTimelineEventFilled,
  TablerTimelineEvent,
  'IconTimelineEvent',
)
export const IconTrash = catalogued(TablerTrashFilled, TablerTrash, 'IconTrash')
export const IconUser = catalogued(TablerUserFilled, TablerUser, 'IconUser')
export const IconX = catalogued(TablerXFilled, TablerX, 'IconX')
