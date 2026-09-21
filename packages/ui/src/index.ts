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
  type HomeSession,
  type QuickAction,
  type SessionsFrameProps,
} from './home/home.tsx'

/**
 * The composer: what a Session is started from and what is written into one.
 *
 * The `Start chat` of the Home and the `Send` of a Session are one control: the word on it is
 * the page's, and the write is `onSend`, which answers with the reason it could not be written.
 */
export { Composer, type ComposerProps } from './composer/composer.tsx'
export { PromptInput, type PromptInputProps, type PromptShape } from './composer/prompt-input.tsx'
export { ComposerActions, type ComposerActionsProps } from './composer/composer-actions.tsx'
export {
  ComposerAttachments,
  type ComposerAttachmentsProps,
} from './composer/composer-attachments.tsx'
export { MentionMenu, type MentionMenuProps } from './composer/mention-menu.tsx'
export { WorkspacePill } from './composer/workspace-pill.tsx'

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

/**
 * The thread of a Session: what the user wrote, grouped by author, and what Hemera says about
 * the Session itself (design D4b-08, D4b-09).
 */
export {
  LiveMarker,
  MessageBubble,
  MessageDaySeparator,
  MessageFooter,
  MessageGroup,
  MessageHeader,
  MessageRow,
  type MessageBubbleProps,
  type MessageFooterProps,
  type MessageGroupProps,
  type MessageHeaderProps,
  type MessageRowProps,
} from './message/message.tsx'
/** What an agent says, drawn from the Markdown that is still arriving. */
export { AgentText } from './message/agent-text.tsx'
export { MessageText } from './message/message-text.tsx'
export {
  type MessageAuthor,
  type MessageLine,
  type MessageState,
  type MessageTone,
} from './message/model.ts'
/** The viewport a thread is read in: the rail of marks, and the way back to the live edge. */
export {
  LatestPill,
  MessageScroller,
  NavigationRail,
  type LatestPillProps,
  type MessageScrollerProps,
  type NavigationMark,
  type NavigationRailProps,
  type ScrollerDay,
  type ScrollerEntry,
  type ScrollerMessage,
} from './message/scroller/scroller.tsx'

/** The Session as a surface: its head, its empty state, its archives, its line in the sidebar. */
export {
  ArchivedSessions,
  SessionEmpty,
  SessionHeader,
  SidebarSessionEntry,
  type ArchivedSession,
  type ArchivedSessionsProps,
  type SessionHeaderProps,
} from './session/session.tsx'

/** A turn with an agent, drawn as it happens: what it thought, what it called, what it ran, and
 * what it changed. These are the blocks the thread of a Session with an agent is made of. */
export { Disclosure, type DisclosureProps } from './activity/disclosure.tsx'
export { ThoughtBlock, type ThoughtBlockProps } from './activity/thought-block.tsx'
export {
  ToolCallCard,
  type ToolCallCardProps,
  type ToolKind,
  type ToolLocation,
  type ToolStatus,
} from './activity/tool-call-card.tsx'
export { TerminalOutput, type TerminalOutputProps } from './activity/terminal-output.tsx'
export { DiffBlock, type DiffBlockProps } from './activity/diff-block.tsx'

/** The gate a turn stops at, and the one line the answer leaves behind. */
export {
  PermissionRequest,
  type PermissionOption,
  type PermissionOptionKind,
  type PermissionParameter,
  type PermissionRequestProps,
} from './approval/permission-request.tsx'
export { DecisionSummary, type DecisionSummaryProps } from './approval/decision-summary.tsx'

/** What an agent advertises, what the reader sets, and what the session has spent. */
export { type AgentChoice } from './composer/agent-choice.ts'
export { ModelSelector, type ModelSelectorProps } from './composer/model-selector.tsx'
export { EffortSelector, type EffortSelectorProps } from './composer/effort-selector.tsx'
export { ModeSelector, type ModeSelectorProps } from './composer/mode-selector.tsx'
export { UsageMeter, type UsageCost, type UsageMeterProps } from './composer/usage-meter.tsx'
export { BlockedBanner, type BlockedBannerProps } from './composer/blocked-banner.tsx'

/** The agents this machine has, with what it can say about each. */
export {
  AgentsSection,
  type AgentOnTheMachine,
  type AgentStanding,
  type AgentsSectionProps,
} from './settings/agents-section.tsx'

/** What a Session says about itself beside its thread: its plan, its files, a turn that was
 * stopped, and a thread that was rebuilt rather than resumed. */
export {
  PlanPanel,
  type PlanEntry,
  type PlanPanelProps,
  type PlanPriority,
  type PlanStatus,
} from './session/plan-panel.tsx'
export {
  SessionSideColumn,
  type SessionSideColumnProps,
  type TouchedFile,
} from './session/session-side-column.tsx'
export { StoppedTurn, type StoppedTurnProps } from './session/stopped-turn.tsx'
export {
  ResumeFallbackBanner,
  type ResumeFallbackBannerProps,
} from './session/resume-fallback-banner.tsx'
