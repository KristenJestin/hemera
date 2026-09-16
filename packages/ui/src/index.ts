/**
 * The public surface of the design system: the components the application composes with.
 *
 * The theme, the motion preset, the icon catalogue and the window colours are reached
 * through their own subpaths, because the bundler and the main process need them alone.
 */

export {
  Button,
  IconButton,
  type ButtonProps,
  type ButtonState,
  type IconButtonProps,
} from './components/button/button.tsx'
export { Dialog, DialogClose, type DialogProps } from './components/dialog/dialog.tsx'
export { Badge, type BadgeProps } from './components/badge/badge.tsx'
export { Input, Textarea, type InputProps, type TextareaProps } from './components/field/field.tsx'
export { Menu, type MenuItem, type MenuProps } from './components/menu/menu.tsx'
export {
  Select,
  type SelectGroup,
  type SelectItem,
  type SelectProps,
} from './components/select/select.tsx'
export { Loading, type LoadingProps } from './components/loading/loading.tsx'
export {
  Tooltip,
  TooltipProvider,
  type TooltipProps,
  type TooltipSide,
} from './components/tooltip/tooltip.tsx'
export { Popover, type PopoverProps } from './components/popover/popover.tsx'
export { Tabs, type TabsItem, type TabsProps } from './components/tabs/tabs.tsx'
export { Kbd, type KbdProps } from './components/kbd/kbd.tsx'

/**
 * The shell: the window's own layout, with no data of its own. The application composes it
 * with fixtures in this lot and with its Projects and Sessions in lot 4.
 */
export { ContentArea, OverlayRoot, Shell, type ShellProps } from './shell/shell.tsx'
export { ChromeBar, type ChromeBarProps } from './shell/chrome-bar.tsx'
export { Sidebar, type SidebarProps } from './shell/sidebar.tsx'
export { Gutter, type GutterProps } from './shell/gutter.tsx'
export {
  JOURNAL_ENTRY,
  PROJECT_SETTINGS_ENTRY,
  SIDEBAR_DEFAULT,
  SIDEBAR_MAX,
  SIDEBAR_MIN,
  SIDEBAR_RAIL,
  type ProjectTone,
  type ShellProject,
  type ShellSession,
} from './shell/model.ts'
