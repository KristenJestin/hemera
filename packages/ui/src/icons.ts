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
  IconArrowLeft as TablerArrowLeft,
  IconArrowsMaximize as TablerArrowsMaximize,
  IconArrowsMinimize as TablerArrowsMinimize,
  IconBan as TablerBan,
  IconBook2 as TablerBook2,
  IconCheck as TablerCheck,
  IconCheckFilled as TablerCheckFilled,
  IconChevronDown as TablerChevronDown,
  IconChevronDownFilled as TablerChevronDownFilled,
  IconChevronRight as TablerChevronRight,
  IconClockPause as TablerClockPause,
  IconCopy as TablerCopy,
  IconCopyFilled as TablerCopyFilled,
  IconDots as TablerDots,
  IconDotsFilled as TablerDotsFilled,
  IconExternalLink as TablerExternalLink,
  IconExternalLinkFilled as TablerExternalLinkFilled,
  IconFileText as TablerFileText,
  IconFolder as TablerFolder,
  IconFolderFilled as TablerFolderFilled,
  IconGitBranch as TablerGitBranch,
  IconGitCompare as TablerGitCompare,
  IconHome as TablerHome,
  IconHomeFilled as TablerHomeFilled,
  IconInbox as TablerInbox,
  IconInfoCircle as TablerInfoCircle,
  IconInfoCircleFilled as TablerInfoCircleFilled,
  IconLayoutSidebarLeftCollapse as TablerLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftCollapseFilled as TablerLayoutSidebarLeftCollapseFilled,
  IconLayoutSidebarLeftExpand as TablerLayoutSidebarLeftExpand,
  IconLayoutSidebarLeftExpandFilled as TablerLayoutSidebarLeftExpandFilled,
  IconListCheck as TablerListCheck,
  IconMessages as TablerMessages,
  IconMinus as TablerMinus,
  IconPackage as TablerPackage,
  IconPencil as TablerPencil,
  IconPencilFilled as TablerPencilFilled,
  IconPlayerPlay as TablerPlayerPlay,
  IconPlayerPlayFilled as TablerPlayerPlayFilled,
  IconPlayerStop as TablerPlayerStop,
  IconPlayerStopFilled as TablerPlayerStopFilled,
  IconPlus as TablerPlus,
  IconPlusFilled as TablerPlusFilled,
  IconRefresh as TablerRefresh,
  IconSearch as TablerSearch,
  IconSearchFilled as TablerSearchFilled,
  IconSettings as TablerSettings,
  IconSettingsFilled as TablerSettingsFilled,
  IconSquare as TablerSquare,
  IconTerminal as TablerTerminal,
  IconTrash as TablerTrash,
  IconTrashFilled as TablerTrashFilled,
  IconX as TablerX,
  IconXFilled as TablerXFilled,
  IconAdjustments as TablerAdjustments,
  IconAlertCircle as TablerAlertCircle,
  IconBraces as TablerBraces,
  IconBrowserCheck as TablerBrowserCheck,
  IconBug as TablerBug,
  IconCloudDownload as TablerCloudDownload,
  IconDeviceDesktop as TablerDeviceDesktop,
  IconEye as TablerEye,
  IconEyeOff as TablerEyeOff,
  IconFolderOpen as TablerFolderOpen,
  IconGripVertical as TablerGripVertical,
  IconHandStop as TablerHandStop,
  IconHammer as TablerHammer,
  IconLink as TablerLink,
  IconLock as TablerLock,
  IconScript as TablerScript,
  IconServer as TablerServer,
  IconTestPipe as TablerTestPipe,
  IconVariable as TablerVariable,
  IconWorld as TablerWorld,
  IconBolt as TablerBolt,
  IconChecklist as TablerChecklist,
  IconListNumbers as TablerListNumbers,
  IconStack2 as TablerStack2,
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
export const IconBan = catalogued(TablerBan, TablerBan, 'IconBan')
export const IconCheck = catalogued(TablerCheckFilled, TablerCheck, 'IconCheck')
export const IconChevronDown = catalogued(
  TablerChevronDownFilled,
  TablerChevronDown,
  'IconChevronDown',
)
export const IconClockPause = catalogued(TablerClockPause, TablerClockPause, 'IconClockPause')
export const IconCopy = catalogued(TablerCopyFilled, TablerCopy, 'IconCopy')
export const IconDots = catalogued(TablerDotsFilled, TablerDots, 'IconDots')
export const IconExternalLink = catalogued(
  TablerExternalLinkFilled,
  TablerExternalLink,
  'IconExternalLink',
)
export const IconFolder = catalogued(TablerFolderFilled, TablerFolder, 'IconFolder')
export const IconGitBranch = catalogued(TablerGitBranch, TablerGitBranch, 'IconGitBranch')
export const IconInfoCircle = catalogued(TablerInfoCircleFilled, TablerInfoCircle, 'IconInfoCircle')
export const IconPencil = catalogued(TablerPencilFilled, TablerPencil, 'IconPencil')
export const IconPlayerPlay = catalogued(TablerPlayerPlayFilled, TablerPlayerPlay, 'IconPlayerPlay')
export const IconPlayerStop = catalogued(TablerPlayerStopFilled, TablerPlayerStop, 'IconPlayerStop')
export const IconPlus = catalogued(TablerPlusFilled, TablerPlus, 'IconPlus')
export const IconRefresh = catalogued(TablerRefresh, TablerRefresh, 'IconRefresh')
export const IconSearch = catalogued(TablerSearchFilled, TablerSearch, 'IconSearch')
export const IconSettings = catalogued(TablerSettingsFilled, TablerSettings, 'IconSettings')
export const IconTerminal = catalogued(TablerTerminal, TablerTerminal, 'IconTerminal')
export const IconTrash = catalogued(TablerTrashFilled, TablerTrash, 'IconTrash')
export const IconX = catalogued(TablerXFilled, TablerX, 'IconX')
export const IconArrowLeft = catalogued(TablerArrowLeft, TablerArrowLeft, 'IconArrowLeft')
export const IconBook2 = catalogued(TablerBook2, TablerBook2, 'IconBook2')
export const IconChevronRight = catalogued(
  TablerChevronRight,
  TablerChevronRight,
  'IconChevronRight',
)
export const IconFileText = catalogued(TablerFileText, TablerFileText, 'IconFileText')
export const IconGitCompare = catalogued(TablerGitCompare, TablerGitCompare, 'IconGitCompare')
export const IconHome = catalogued(TablerHomeFilled, TablerHome, 'IconHome')
export const IconInbox = catalogued(TablerInbox, TablerInbox, 'IconInbox')
export const IconLayoutSidebarLeftCollapse = catalogued(
  TablerLayoutSidebarLeftCollapseFilled,
  TablerLayoutSidebarLeftCollapse,
  'IconLayoutSidebarLeftCollapse',
)
export const IconLayoutSidebarLeftExpand = catalogued(
  TablerLayoutSidebarLeftExpandFilled,
  TablerLayoutSidebarLeftExpand,
  'IconLayoutSidebarLeftExpand',
)
export const IconListCheck = catalogued(TablerListCheck, TablerListCheck, 'IconListCheck')
export const IconMessages = catalogued(TablerMessages, TablerMessages, 'IconMessages')
export const IconMinus = catalogued(TablerMinus, TablerMinus, 'IconMinus')
export const IconPackage = catalogued(TablerPackage, TablerPackage, 'IconPackage')
export const IconSquare = catalogued(TablerSquare, TablerSquare, 'IconSquare')
export const IconArrowsMaximize = catalogued(
  TablerArrowsMaximize,
  TablerArrowsMaximize,
  'IconArrowsMaximize',
)
export const IconArrowsMinimize = catalogued(
  TablerArrowsMinimize,
  TablerArrowsMinimize,
  'IconArrowsMinimize',
)
export const IconAdjustments = catalogued(TablerAdjustments, TablerAdjustments, 'IconAdjustments')
export const IconAlertCircle = catalogued(TablerAlertCircle, TablerAlertCircle, 'IconAlertCircle')
export const IconBraces = catalogued(TablerBraces, TablerBraces, 'IconBraces')
export const IconBrowserCheck = catalogued(
  TablerBrowserCheck,
  TablerBrowserCheck,
  'IconBrowserCheck',
)
export const IconBug = catalogued(TablerBug, TablerBug, 'IconBug')
export const IconCloudDownload = catalogued(
  TablerCloudDownload,
  TablerCloudDownload,
  'IconCloudDownload',
)
export const IconDeviceDesktop = catalogued(
  TablerDeviceDesktop,
  TablerDeviceDesktop,
  'IconDeviceDesktop',
)
export const IconEye = catalogued(TablerEye, TablerEye, 'IconEye')
export const IconEyeOff = catalogued(TablerEyeOff, TablerEyeOff, 'IconEyeOff')
export const IconFolderOpen = catalogued(TablerFolderOpen, TablerFolderOpen, 'IconFolderOpen')
export const IconGripVertical = catalogued(
  TablerGripVertical,
  TablerGripVertical,
  'IconGripVertical',
)
export const IconHandStop = catalogued(TablerHandStop, TablerHandStop, 'IconHandStop')
export const IconHammer = catalogued(TablerHammer, TablerHammer, 'IconHammer')
export const IconLink = catalogued(TablerLink, TablerLink, 'IconLink')
export const IconLock = catalogued(TablerLock, TablerLock, 'IconLock')
export const IconScript = catalogued(TablerScript, TablerScript, 'IconScript')
export const IconServer = catalogued(TablerServer, TablerServer, 'IconServer')
export const IconTestPipe = catalogued(TablerTestPipe, TablerTestPipe, 'IconTestPipe')
export const IconVariable = catalogued(TablerVariable, TablerVariable, 'IconVariable')
export const IconWorld = catalogued(TablerWorld, TablerWorld, 'IconWorld')
export const IconBolt = catalogued(TablerBolt, TablerBolt, 'IconBolt')
export const IconChecklist = catalogued(TablerChecklist, TablerChecklist, 'IconChecklist')
export const IconListNumbers = catalogued(TablerListNumbers, TablerListNumbers, 'IconListNumbers')
export const IconStack2 = catalogued(TablerStack2, TablerStack2, 'IconStack2')
