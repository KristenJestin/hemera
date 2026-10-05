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
  IconDatabase as TablerDatabase,
  IconDeviceMobile as TablerDeviceMobile,
  IconRocket as TablerRocket,
  IconPhoto as TablerPhoto,
  IconPalette as TablerPalette,
  IconHelpCircle as TablerHelpCircle,
  IconPlug as TablerPlug,
  IconShieldLock as TablerShieldLock,
  IconBell as TablerBell,
  IconBellFilled as TablerBellFilled,
  IconGauge as TablerGauge,
  IconGaugeFilled as TablerGaugeFilled,
  IconSend as TablerSend,
  IconSendFilled as TablerSendFilled,
  IconArrowBackUp as TablerArrowBackUp,
  IconArrowUp as TablerArrowUp,
  IconBrandOpenai as TablerBrandOpenai,
  IconAt as TablerAt,
  IconShieldCheck as TablerShieldCheck,
  IconShieldCheckFilled as TablerShieldCheckFilled,
  IconStar as TablerStar,
  IconStarFilled as TablerStarFilled,
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
export const IconDatabase = catalogued(TablerDatabase, TablerDatabase, 'IconDatabase')
export const IconDeviceMobile = catalogued(
  TablerDeviceMobile,
  TablerDeviceMobile,
  'IconDeviceMobile',
)
export const IconRocket = catalogued(TablerRocket, TablerRocket, 'IconRocket')
export const IconPhoto = catalogued(TablerPhoto, TablerPhoto, 'IconPhoto')
export const IconPalette = catalogued(TablerPalette, TablerPalette, 'IconPalette')
export const IconHelpCircle = catalogued(TablerHelpCircle, TablerHelpCircle, 'IconHelpCircle')
export const IconPlug = catalogued(TablerPlug, TablerPlug, 'IconPlug')
export const IconShieldLock = catalogued(TablerShieldLock, TablerShieldLock, 'IconShieldLock')
export const IconBell = catalogued(TablerBellFilled, TablerBell, 'IconBell')
export const IconGauge = catalogued(TablerGaugeFilled, TablerGauge, 'IconGauge')
export const IconSend = catalogued(TablerSendFilled, TablerSend, 'IconSend')
export const IconArrowBackUp = catalogued(TablerArrowBackUp, TablerArrowBackUp, 'IconArrowBackUp')
export const IconArrowUp = catalogued(TablerArrowUp, TablerArrowUp, 'IconArrowUp')
export const IconAt = catalogued(TablerAt, TablerAt, 'IconAt')
export const IconShieldCheck = catalogued(
  TablerShieldCheckFilled,
  TablerShieldCheck,
  'IconShieldCheck',
)
export const IconStar = catalogued(TablerStarFilled, TablerStar, 'IconStar')
export const IconBrandOpenai = catalogued(TablerBrandOpenai, TablerBrandOpenai, 'IconBrandOpenai')

/**
 * A mark Tabler does not draw, vendored as the one path it is (design D17-11).
 *
 * Tabler has a handful of brand icons and the agents Hemera runs are not among them. A mark that
 * may be redistributed is copied in here, next to the rest of the catalogue, rather than fetched:
 * a window that opens offline must not open with holes in it. It is redrawn in `currentColor`
 * and nothing else — a logo with its own colours inside a button would be the one thing on the
 * page that no theme reaches — and where it came from and what allows it is written in
 * `packages/ui/LICENSES.md`.
 *
 * `weight` is read and dropped: a vendored mark is one shape, and there is no solid twin of a
 * logo to swap to.
 */
function vendored(name: string, viewBox: string, path: string): FunctionComponent<IconProps> {
  const Vendored: FunctionComponent<IconProps> = ({
    size = 'md',
    weight: _weight,
    className,
    ...rest
  }) =>
    createElement(
      'svg',
      {
        ...rest,
        viewBox,
        fill: 'currentColor',
        xmlns: 'http://www.w3.org/2000/svg',
        className: cn(SIZE_CLASS[size], className),
      },
      createElement('path', { fillRule: 'evenodd', clipRule: 'evenodd', d: path }),
    )
  Vendored.displayName = name
  return Vendored
}

/**
 * OpenCode's own mark, from `packages/identity/mark.svg` of `anomalyco/opencode` (MIT).
 *
 * The square "o" of the wordmark, kept as the one even-odd path that draws it. The grey block
 * the original sets inside the ring is dropped: it is a second colour, this catalogue draws in
 * one, and the ring is what the mark is recognised by at sixteen pixels.
 *
 * The box is the mark's own and not the file's. The ring sits in 128–384 by 96–416 of a
 * 512-square canvas, so the published viewBox drew it at half the width of an icon slot: beside
 * a Tabler glyph, which fills its box, it read as the mark of a smaller agent. `64 64 384 384`
 * is that same 512-square recentred on the ring, at the proportion every other icon is drawn at.
 */
export const IconBrandOpencode = vendored(
  'IconBrandOpencode',
  '64 64 384 384',
  'M384 416H128V96H384V416ZM320 160H192V352H320V160Z',
)

/** Simple Icons' Claude glyph (CC0 artwork); the mark is Anthropic's, see LICENSES.md. */
export const IconBrandClaude = vendored(
  'IconBrandClaude',
  '0 0 24 24',
  'm4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z',
)
