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
export { Card, CardRow, type CardProps } from './components/card/card.tsx'
export {
  Frame,
  FrameFooter,
  FrameHeader,
  NESTED_RADIUS,
  type FrameProps,
} from './components/frame/frame.tsx'
export { List, ListItem, type ListItemProps, type ListProps } from './components/list/list.tsx'
export {
  Timeline,
  TimelineDays,
  TimelineSection,
  TimelineStop,
  type TimelineProps,
  type TimelineStopProps,
} from './components/timeline/timeline.tsx'
export { ToneSwatches, type ToneSwatchesProps } from './components/tone-swatches/tone-swatches.tsx'

/**
 * The shell: the window's own layout, with no data of its own. The application composes it
 * with fixtures in this lot and with its Projects and Sessions in lot 4.
 */
export { ContentArea, OverlayRoot, Shell, type ShellProps } from './shell/shell.tsx'
export { ChromeBar, type ChromeBarProps } from './shell/chrome-bar.tsx'
export {
  CommandPalette,
  EVERYWHERE_PREFIX,
  type CommandEntry,
  type CommandGroup,
  type CommandPaletteProps,
} from './shell/command-palette.tsx'
export { Sidebar, type SidebarProps } from './shell/sidebar.tsx'

/** The Project surfaces: where one is created, and where the one in front is configured. */
export { EMPTY_DRAFT, ProjectDialog, type ProjectDialogProps } from './project/project-dialog.tsx'
export {
  DangerZone,
  ProjectSettings,
  RepositoryList,
  type ProjectSettingsProps,
} from './project/project-settings.tsx'

export type { ProjectDraft, RepositoryLine } from './project/model.ts'

/** The settings of the application, and the bell of the chrome bar. */
export {
  AppearanceSection,
  ArchivedProjects,
  ProfileSection,
  Settings,
  type AppearanceSectionProps,
  type ArchivedProject,
  type ArchivedProjectsProps,
  type ProfileFacts,
  type ProfileSectionProps,
  type SettingsProps,
} from './settings/settings.tsx'
export {
  NotificationBell,
  NotificationList,
  type NotificationBellProps,
  type NotificationLine,
  type NotificationListProps,
} from './notifications/notifications.tsx'

/** The Home of a Project, and the page a window with no Project shows instead. */
export {
  ActivityFrame,
  EmptyProject,
  FirstLaunch,
  Greeting,
  QuickActions,
  SessionsFrame,
  type ActivityFrameProps,
  type FirstLaunchProps,
  type QuickAction,
  type SessionsFrameProps,
} from './home/home.tsx'

/** The Session surfaces: its head, its empty state, its archives, its rows in the sidebar. */
export {
  ArchivedSessions,
  NEW_SESSION_TITLE,
  SessionEmpty,
  SessionHeader,
  SidebarSessionEntry,
  SidebarSessions,
  sessionCommands,
  shownTitle,
  type ArchivedSession,
  type ArchivedSessionsProps,
  type SessionCommandsProps,
  type SessionHeaderProps,
  type SidebarSessionEntryProps,
  type SidebarSessionsProps,
} from './session/index.ts'

/** The composer: complete, and what a Session is written from. */
export { Composer, type ComposerProps } from './composer/composer.tsx'
export { PromptInput, type PromptInputProps } from './composer/prompt-input.tsx'
export { ComposerActions, type ComposerActionsProps } from './composer/composer-actions.tsx'
export {
  ComposerAttachments,
  type ComposerAttachmentsProps,
} from './composer/composer-attachments.tsx'
export { MentionMenu, type MentionMenuProps } from './composer/mention-menu.tsx'
export { WorkspacePill } from './composer/workspace-pill.tsx'

/** The thread of a Session: the messages, and the scrolling that follows the live edge. */
export {
  LatestPill,
  LiveMarker,
  MessageBubble,
  MessageDaySeparator,
  MessageFooter,
  MessageGroup,
  MessageHeader,
  MessageRow,
  MessageScroller,
  NavigationRail,
  type LatestPillProps,
  type MessageBubbleProps,
  type MessageFooterProps,
  type MessageGroupProps,
  type MessageHeaderProps,
  type MessageRowProps,
  type MessageScrollerProps,
  type MessageSide,
  type MessageState,
  type NavigationRailProps,
  type NavigationTick,
} from './message/index.ts'

/** The Journal: what happened, in the order it happened. */
export {
  DaySeparator,
  Journal,
  JournalEntry,
  JournalFilters,
  LoadEarlier,
  type JournalAuthor,
  type JournalEntityKind,
  type JournalFilter,
  type JournalLine,
  type JournalProps,
} from './journal/journal.tsx'
export { Gutter, type GutterProps } from './shell/gutter.tsx'
export {
  HOME_ENTRY,
  JOURNAL_ENTRY,
  PROJECT_SETTINGS_ENTRY,
  PROJECT_TONES,
  SIDEBAR_DEFAULT,
  SIDEBAR_MAX,
  SIDEBAR_MIN,
  SIDEBAR_RAIL,
  type ProjectTone,
  type ShellProject,
  type ShellSession,
} from './shell/model.ts'

export { useAppForm, withForm } from './form/app-form.ts'
export { PathField, TextField, ToneField } from './form/fields.tsx'
export { SubmitButton } from './form/submit-button.tsx'
export {
  NAME_LIMIT,
  folderSchema,
  nameSchema,
  projectFormSchema,
  relativePathSchema,
  tonesSchema,
} from './form/schemas.ts'
export { SuggestInput, type Suggestion } from './components/suggest/suggest-input.tsx'
export { AlertDialog } from './components/alert-dialog/alert-dialog.tsx'
