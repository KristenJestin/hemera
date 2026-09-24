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
  IconAlertCircle as TablerAlertCircle,
  IconAlertCircleFilled as TablerAlertCircleFilled,
  IconAlertTriangle as TablerAlertTriangle,
  IconAlertTriangleFilled as TablerAlertTriangleFilled,
  IconArchive as TablerArchive,
  IconArchiveFilled as TablerArchiveFilled,
  IconArrowUp as TablerArrowUp,
  IconAt as TablerAt,
  IconBell as TablerBell,
  IconBellFilled as TablerBellFilled,
  IconBolt as TablerBolt,
  IconBoltFilled as TablerBoltFilled,
  IconBook as TablerBook,
  IconBookFilled as TablerBookFilled,
  IconBorderOuter as TablerBorderOuter,
  IconBrain as TablerBrain,
  IconBrandOpenai as TablerBrandOpenai,
  IconBug as TablerBug,
  IconBugFilled as TablerBugFilled,
  IconBulb as TablerBulb,
  IconBulbFilled as TablerBulbFilled,
  IconCheck as TablerCheck,
  IconCheckFilled as TablerCheckFilled,
  IconChecklist as TablerChecklist,
  IconChevronDown as TablerChevronDown,
  IconChevronDownFilled as TablerChevronDownFilled,
  IconChevronLeft as TablerChevronLeft,
  IconChevronRight as TablerChevronRight,
  IconCommand as TablerCommand,
  IconCompass as TablerCompass,
  IconCompassFilled as TablerCompassFilled,
  IconDatabase as TablerDatabase,
  IconDatabaseFilled as TablerDatabaseFilled,
  IconDeviceDesktop as TablerDeviceDesktop,
  IconDeviceDesktopFilled as TablerDeviceDesktopFilled,
  IconDots as TablerDots,
  IconDotsFilled as TablerDotsFilled,
  IconEye as TablerEye,
  IconEyeFilled as TablerEyeFilled,
  IconFileText as TablerFileText,
  IconFilePlus as TablerFilePlus,
  IconFileTextFilled as TablerFileTextFilled,
  IconFlask as TablerFlask,
  IconFlaskFilled as TablerFlaskFilled,
  IconFolder as TablerFolder,
  IconFolderFilled as TablerFolderFilled,
  IconFolderOpen as TablerFolderOpen,
  IconFolderOpenFilled as TablerFolderOpenFilled,
  IconFolderPlus as TablerFolderPlus,
  IconFolders as TablerFolders,
  IconFoldersFilled as TablerFoldersFilled,
  IconGitBranch as TablerGitBranch,
  IconGitCompare as TablerGitCompare,
  IconHome as TablerHome,
  IconHomeFilled as TablerHomeFilled,
  IconInfoCircle as TablerInfoCircle,
  IconInfoCircleFilled as TablerInfoCircleFilled,
  IconLayoutSidebar as TablerLayoutSidebar,
  IconLayoutList as TablerLayoutList,
  IconLayoutListFilled as TablerLayoutListFilled,
  IconLayoutSidebarFilled as TablerLayoutSidebarFilled,
  IconListCheck as TablerListCheck,
  IconListDetails as TablerListDetails,
  IconListDetailsFilled as TablerListDetailsFilled,
  IconListTree as TablerListTree,
  IconLock as TablerLock,
  IconLockFilled as TablerLockFilled,
  IconMessage as TablerMessage,
  IconMessageFilled as TablerMessageFilled,
  IconMessageQuestion as TablerMessageQuestion,
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
  IconRefresh as TablerRefresh,
  IconRestore as TablerRestore,
  IconPlugConnected as TablerPlugConnected,
  IconRobot as TablerRobot,
  IconRoute as TablerRoute,
  IconSearch as TablerSearch,
  IconSparkles as TablerSparkles,
  IconSearchFilled as TablerSearchFilled,
  IconSettings as TablerSettings,
  IconSettingsFilled as TablerSettingsFilled,
  IconShield as TablerShield,
  IconSun as TablerSun,
  IconSunFilled as TablerSunFilled,
  IconTarget as TablerTarget,
  IconTerminal as TablerTerminal,
  IconTerminal2 as TablerTerminal2,
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
export const IconAlertCircle = catalogued(
  TablerAlertCircleFilled,
  TablerAlertCircle,
  'IconAlertCircle',
)
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
/* The flash of effort: what the composer marks the level an agent is asked to think at with.
   Solid as well as outlined, because a bolt is a shape and not a contour — at sixteen pixels
   the outlined one is a zigzag of hairlines and the filled one is a bolt. */
export const IconBolt = catalogued(TablerBoltFilled, TablerBolt, 'IconBolt')
export const IconBook = catalogued(TablerBookFilled, TablerBook, 'IconBook')
/* The parts of a Spec each wear a glyph of their own (lot 19, revision 4b), and several of those
   are lines with no solid twin in Tabler — a frame, a checklist, a tree of lines, a route, a
   target: the outline stands for both weights, which is what a drawing of lines is anyway. */
export const IconBorderOuter = catalogued(TablerBorderOuter, TablerBorderOuter, 'IconBorderOuter')
export const IconBrain = catalogued(TablerBrain, TablerBrain, 'IconBrain')
export const IconBrandOpenai = catalogued(TablerBrandOpenai, TablerBrandOpenai, 'IconBrandOpenai')
export const IconBug = catalogued(TablerBugFilled, TablerBug, 'IconBug')
export const IconBulb = catalogued(TablerBulbFilled, TablerBulb, 'IconBulb')
export const IconCheck = catalogued(TablerCheckFilled, TablerCheck, 'IconCheck')
export const IconChecklist = catalogued(TablerChecklist, TablerChecklist, 'IconChecklist')
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
export const IconCompass = catalogued(TablerCompassFilled, TablerCompass, 'IconCompass')
export const IconDatabase = catalogued(TablerDatabaseFilled, TablerDatabase, 'IconDatabase')
export const IconDeviceDesktop = catalogued(
  TablerDeviceDesktopFilled,
  TablerDeviceDesktop,
  'IconDeviceDesktop',
)
export const IconDots = catalogued(TablerDotsFilled, TablerDots, 'IconDots')
export const IconEye = catalogued(TablerEyeFilled, TablerEye, 'IconEye')
/* Tabler draws no solid file with a plus, and no solid second terminal further down: the outline
   stands for both weights. */
export const IconFilePlus = catalogued(TablerFilePlus, TablerFilePlus, 'IconFilePlus')
export const IconFileText = catalogued(TablerFileTextFilled, TablerFileText, 'IconFileText')
export const IconFlask = catalogued(TablerFlaskFilled, TablerFlask, 'IconFlask')
export const IconFolder = catalogued(TablerFolderFilled, TablerFolder, 'IconFolder')
export const IconFolderOpen = catalogued(TablerFolderOpenFilled, TablerFolderOpen, 'IconFolderOpen')
/* A folder with a plus in it has no solid twin; the outline is the folder either way. */
export const IconFolderPlus = catalogued(TablerFolderPlus, TablerFolderPlus, 'IconFolderPlus')
export const IconFolders = catalogued(TablerFoldersFilled, TablerFolders, 'IconFolders')
export const IconGitBranch = catalogued(TablerGitBranch, TablerGitBranch, 'IconGitBranch')
export const IconGitCompare = catalogued(TablerGitCompare, TablerGitCompare, 'IconGitCompare')
export const IconHome = catalogued(TablerHomeFilled, TablerHome, 'IconHome')
export const IconInfoCircle = catalogued(TablerInfoCircleFilled, TablerInfoCircle, 'IconInfoCircle')
export const IconLayoutSidebar = catalogued(
  TablerLayoutSidebarFilled,
  TablerLayoutSidebar,
  'IconLayoutSidebar',
)
export const IconLayoutList = catalogued(TablerLayoutListFilled, TablerLayoutList, 'IconLayoutList')
export const IconListCheck = catalogued(TablerListCheck, TablerListCheck, 'IconListCheck')
export const IconListDetails = catalogued(
  TablerListDetailsFilled,
  TablerListDetails,
  'IconListDetails',
)
export const IconListTree = catalogued(TablerListTree, TablerListTree, 'IconListTree')
export const IconLock = catalogued(TablerLockFilled, TablerLock, 'IconLock')
export const IconMessage = catalogued(TablerMessageFilled, TablerMessage, 'IconMessage')
export const IconMessageQuestion = catalogued(
  TablerMessageQuestion,
  TablerMessageQuestion,
  'IconMessageQuestion',
)
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
export const IconRefresh = catalogued(TablerRefresh, TablerRefresh, 'IconRefresh')
export const IconRestore = catalogued(TablerRestore, TablerRestore, 'IconRestore')
export const IconPlugConnected = catalogued(
  TablerPlugConnected,
  TablerPlugConnected,
  'IconPlugConnected',
)
export const IconRobot = catalogued(TablerRobot, TablerRobot, 'IconRobot')
export const IconRoute = catalogued(TablerRoute, TablerRoute, 'IconRoute')
export const IconSparkles = catalogued(TablerSparkles, TablerSparkles, 'IconSparkles')
export const IconSearch = catalogued(TablerSearchFilled, TablerSearch, 'IconSearch')
export const IconSettings = catalogued(TablerSettingsFilled, TablerSettings, 'IconSettings')
export const IconShield = catalogued(TablerShield, TablerShield, 'IconShield')
export const IconSun = catalogued(TablerSunFilled, TablerSun, 'IconSun')
export const IconTarget = catalogued(TablerTarget, TablerTarget, 'IconTarget')
/* Tabler draws no solid prompt: the outline stands for both weights, which is what a prompt is
   anyway, a chevron and a line. */
export const IconTerminal = catalogued(TablerTerminal, TablerTerminal, 'IconTerminal')
export const IconTerminal2 = catalogued(TablerTerminal2, TablerTerminal2, 'IconTerminal2')
export const IconTimelineEvent = catalogued(
  TablerTimelineEventFilled,
  TablerTimelineEvent,
  'IconTimelineEvent',
)
export const IconTrash = catalogued(TablerTrashFilled, TablerTrash, 'IconTrash')
export const IconUser = catalogued(TablerUserFilled, TablerUser, 'IconUser')
export const IconX = catalogued(TablerXFilled, TablerX, 'IconX')

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

/**
 * Hemera's own mark, provisional until a logo is handed over: an `H` on a tinted rounded square.
 *
 * It no longer sits on the line of a call to one of Hemera's tools, which wears the mark of its
 * kind as a native call does (recette 2 of 23 September 2026); it is kept for where Hemera will
 * sign as itself, and the Foundations catalogue still draws it. Unlike the vendored marks
 * it is two colours and not `currentColor`: the tint pair a badge is drawn in, the square in the
 * muted fill and the `H` in its foreground, so it reads as a tinted badge in either theme.
 * `weight` is read and dropped, as for a vendored mark. Nothing here is borrowed, so it has no
 * entry in `packages/ui/LICENSES.md`.
 */
export const IconBrandHemera: FunctionComponent<IconProps> = ({
  size = 'md',
  weight: _weight,
  className,
  ...rest
}) =>
  createElement(
    'svg',
    {
      ...rest,
      viewBox: '0 0 24 24',
      xmlns: 'http://www.w3.org/2000/svg',
      className: cn(SIZE_CLASS[size], className),
    },
    createElement('path', {
      className: 'fill-primary-muted',
      d: 'M6 2h12a4 4 0 0 1 4 4v12a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V6a4 4 0 0 1 4-4Z',
    }),
    createElement('path', {
      className: 'fill-primary-muted-foreground',
      d: 'M7.5 6.5h2.5v4.25h4V6.5h2.5v11h-2.5v-4.25h-4v4.25H7.5Z',
    }),
  )
IconBrandHemera.displayName = 'IconBrandHemera'
