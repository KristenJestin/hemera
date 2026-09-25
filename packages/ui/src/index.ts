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
export {
  Dialog,
  DialogClose,
  type DialogProps,
  type DialogSize,
} from './components/dialog/dialog.tsx'
export { Badge, type BadgeProps } from './components/badge/badge.tsx'
export { Checkbox, type CheckboxProps } from './components/checkbox/checkbox.tsx'
export { Input, Textarea, type InputProps, type TextareaProps } from './components/field/field.tsx'
export { Menu, type MenuItem, type MenuProps } from './components/menu/menu.tsx'
export {
  Select,
  type SelectGroup,
  type SelectItem,
  type SelectProps,
} from './components/select/select.tsx'
export { Loading, type LoadingProps } from './components/loading/loading.tsx'
/** Where a piece of work stands, said as a dot: a tool call, a turn, a row of a list. */
export {
  StatusDot,
  type StatusDotProps,
  type StatusTone,
} from './components/status-dot/status-dot.tsx'
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
  CommandList,
  DangerZone,
  ProjectSettings,
  RepositoryList,
  type ProjectSettingsProps,
  type ProjectSettingsSection,
} from './project/project-settings.tsx'
/** The dialogs a repository and a command of the Project are added and edited in. */
export { CommandDialog, type CommandDialogProps } from './project/command-dialog.tsx'
export { RepositoryDialog, type RepositoryDialogProps } from './project/repository-dialog.tsx'

export {
  REPOSITORY_ICONS,
  type CommandLine,
  type ProjectDraft,
  type ProjectSettingsDraft,
  type RepositoryDraft,
  type RepositoryIcon,
  type RepositoryLine,
} from './project/model.ts'
/** The preparation of a Project: the ordered recipe each dedicated Workspace replays (D8-05). */
export {
  PreparationEditor,
  type PreparationEditorProps,
  type RecipeCommand,
  type RecipeKind,
  type RecipeStepDraft,
  type RecipeStepLine,
} from './project/preparation-editor.tsx'

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
export {
  Composer,
  ComposerActions,
  ComposerAttachments,
  MentionMenu,
  PromptInput,
  WorkspacePill,
  type ComposerActionsProps,
  type ComposerAttachmentsProps,
  type ComposerProps,
  type MentionMenuProps,
  type PromptInputProps,
  type PromptShape,
  type WorkspaceChoice,
  type WorkspacePillProps,
} from './composer/index.ts'

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
  type ToolSubject,
  toolKindLabel,
} from './activity/tool-call-card.tsx'
export { TerminalOutput, type TerminalOutputProps } from './activity/terminal-output.tsx'
export { DiffBlock, type DiffBlockProps } from './activity/diff-block.tsx'
/** The tools Hemera lends the agent (HEM-18): the call it made, and the command it ran. A call
 * to one of Hemera's own tools is not the agent's business alone, so it says whose it is. */
export {
  HemeraToolCall,
  type HemeraToolArgument,
  type HemeraToolCallProps,
  type HemeraToolMark,
  type HemeraToolStatus,
} from './activity/hemera-tool-call.tsx'
export { CommandRun, type CommandRunProps, type CommandState } from './activity/command-run.tsx'
/** A command the agent proposes for the catalogue, and the human's answer (D8-11). */
export {
  CommandProposal,
  type CommandProposalProps,
  type CommandProposalState,
} from './activity/command-proposal.tsx'
/** The seven types of a command and the icon the design system fixes for each (D8-07). */
export {
  COMMAND_SCOPES,
  COMMAND_TYPES,
  COMMAND_TYPE_ICONS,
  COMMAND_TYPE_LABELS,
  type CommandScope,
  type CommandType,
} from './activity/command-type.ts'

/** The gate a turn stops at, and the one line the answer leaves behind. */
export {
  PermissionRequest,
  type PermissionOption,
  type PermissionOptionKind,
  type PermissionParameter,
  type PermissionRequestProps,
} from './approval/permission-request.tsx'
export { DecisionSummary, type DecisionSummaryProps } from './approval/decision-summary.tsx'

/**
 * What an agent advertises, what the reader sets, and what the session has spent.
 *
 * The agent, its model and its effort are one control — `AgentModelMenu` — because they are one
 * question asked in three steps, and three selectors in the foot of the composer was three
 * controls wrapping onto a second line. What the agent may do without asking is a different
 * question and stays a control of its own.
 */
export {
  AgentModelMenu,
  BlockedBanner,
  ModeSelector,
  UsageMeter,
  type AgentChoice,
  type AgentModelMenuProps,
  type BlockedBannerProps,
  type EffortChoice,
  type ModeChoice,
  type ModeSelectorProps,
  type ModelChoice,
  type OfferedAgent,
  type UsageCost,
  type UsageMeterProps,
} from './composer/index.ts'

/** The agents this machine has, with what it can say about each. */
export {
  AgentsSection,
  type AgentOnTheMachine,
  type AgentStanding,
  type AgentsSectionProps,
  type BareMode,
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
  SessionDetails,
  type SessionDetailsProps,
  type SessionDetailsTab,
  type TouchedFile,
} from './session/session-details.tsx'
export {
  CommandsPanel,
  type CommandPanelRun,
  type CommandsPanelProps,
} from './session/commands-panel.tsx'
export {
  ContextView,
  type ContextCommand,
  type ContextEntry,
  type ContextTool,
  type ContextViewProps,
  type ContextWorkspace,
} from './session/context-view.tsx'
export {
  BareModeState,
  type BareModeEntry,
  type BareModeStateProps,
} from './session/bare-mode-state.tsx'
export { StoppedTurn, type StoppedTurnProps } from './session/stopped-turn.tsx'
/** What the turn is doing right now, at the end of the thread while it runs. */
export { ActivityRow, type ActivityRowProps, type ActivityState } from './session/activity-row.tsx'
export {
  ResumeFallbackBanner,
  type ResumeFallbackBannerProps,
} from './session/resume-fallback-banner.tsx'

/** The variables, the services and the details of a run of a Workspace (lot 20). */
export { VariablesEditor, type VariablesEditorProps } from './workspace/variables-editor.tsx'
export { ServiceList, type ServiceListProps } from './workspace/service-list.tsx'
export { RunDetails, type RunDetailsProps, type RunState } from './activity/run-details.tsx'
export type {
  PortClaim,
  PortConflict,
  Readiness,
  ServiceLine,
  VariableLine,
} from './workspace/services-model.ts'
/** The Workspace and its preparation (lot 20). */
export { CleanupDialog, type CleanupDialogProps } from './workspace/cleanup-dialog.tsx'
export {
  CreateWorkspaceDialog,
  type CreateWorkspaceDialogProps,
} from './workspace/create-workspace-dialog.tsx'
export {
  type GitState,
  type PlanRepositoryLine,
  type PreparationStepLine,
  type StepKind,
  type StepState,
  type WorkspaceDraft,
  type WorkspaceRepositoryLine,
  type WorkspaceRow,
  type WorkspaceState,
  type WorkspaceSummary,
} from './workspace/model.ts'
export { PreparationSteps, type PreparationStepsProps } from './workspace/preparation-steps.tsx'
export { WorkspaceList, type WorkspaceListProps } from './workspace/workspace-list.tsx'
export {
  WorkspaceRepositories,
  type WorkspaceRepositoriesProps,
} from './workspace/workspace-repositories.tsx'
/**
 * The panel a Session's mission opens beside the chat, and the rail it is fed with: the fold, the
 * width that pushes the chat, the band; groups of items that say what needs attention. The Spec
 * panel stands in it; a `build` panel is the next.
 */
export { MissionPanel, type MissionPanelProps } from './session/mission-panel.tsx'
export {
  MissionRail,
  type MissionRailGroup,
  type MissionRailItem,
  type MissionRailProps,
  type RailAttention,
  type RailChoice,
  type RailIcon,
} from './session/mission-rail.tsx'

/**
 * The Spec panel of a `define` Session (lot 19, brief revision 4): folded to a band beside the
 * chat, and unfolded a head over the rail — the readiness at its foot — and the stage that shows
 * one part, or one phase; the pieces a Session reading or reworking a Spec adds to it; and the
 * three blocks of the thread — the thin Hemera line of what the agent was handed, a question of
 * the Spec asked in the chat, and the agent proposing a Spec in a `free` Session. View types
 * only: the domain arrives with phase 1.
 */
export {
  SpecPanel,
  SpecPart,
  SpecStage,
  type SpecPanelProps,
  type SpecPartHandlers,
  type SpecPartProps,
  type SpecStageProps,
} from './spec/spec-panel.tsx'
export {
  SpecRail,
  type RailGroup,
  type RailRow,
  type SpecRailProps,
  type StageChoice,
} from './spec/spec-rail.tsx'
export { SpecHead, type SpecHeadProps } from './spec/spec-head.tsx'
export { SectionPart, type SectionPartProps } from './spec/section-part.tsx'
export { StoriesPart, type StoriesPartProps } from './spec/stories-part.tsx'
export { TasksPart, type TasksPartProps } from './spec/tasks-part.tsx'
export { QuestionsPart, type QuestionsPartProps } from './spec/questions-part.tsx'
export { ConflictBanner, type ConflictBannerProps } from './spec/conflict-banner.tsx'
export { ReaderBar, type ReaderBarProps } from './spec/reader-bar.tsx'
export { ReworkDialog, type ReworkDialogProps } from './spec/rework-dialog.tsx'
export { MissionBrief, type MissionBriefProps } from './spec/mission-brief.tsx'
export { SpecQuestion, type SpecQuestionProps } from './spec/spec-question.tsx'
export {
  CreateSpecProposal,
  type CreateSpecProposalProps,
  type ProposalState,
} from './spec/create-spec-proposal.tsx'
export type {
  Author,
  ConflictView,
  Executor,
  GateCheck,
  GateCheckView,
  Mark,
  PhaseName,
  PhaseState,
  PhaseView,
  ReaderView,
  ReadinessItem,
  ReadinessView,
  RevisionView,
  SectionName,
  SectionView,
  SpecAnswer,
  SpecQuestionOption,
  SpecQuestionView,
  SpecStatus,
  SpecTarget,
  SpecType,
  SpecView,
  StoryView,
  TaskView,
} from './spec/model.ts'

/**
 * The build view of a `build` Session (lot 22, D10-12): the build at the centre — its phase, its
 * actions, the approach, the tasks by state — the stage of one task with its tries,
 * their checks and the files they changed, and the blocks that hand a task to the user — a task
 * that is theirs, a blocker the agent raised — in the view and as a banner above the composer;
 * the frozen Spec, opened beside the view read only; and the page of a `build` Session, the view at
 * the centre and the chat narrow beside it. View types only, close to the engine's `BuildView`: the
 * renderer maps one onto the other.
 */
export { BuildView, FINAL_CHECKS_ENTRY, type BuildViewProps } from './build/build-view.tsx'
export { TaskStage, type TaskStageProps } from './build/task-stage.tsx'
export { YoursBlock, type YoursBlockProps } from './build/yours-block.tsx'
export { BlockerBlock, type BlockerBlockProps } from './build/blocker-block.tsx'
export { BuildSpecPanel, type BuildSpecPanelProps } from './build/build-spec-panel.tsx'
export { BuildSession, type BuildSessionProps } from './build/build-session.tsx'
export type {
  BuildAttemptResult,
  BuildAttemptScope,
  BuildAttemptView,
  BuildBlockerView,
  BuildCheckVerdict,
  BuildCheckView,
  BuildExecutor,
  BuildFileView,
  BuildPhase,
  BuildStoryState,
  BuildStoryView,
  BuildTaskState,
  BuildTaskView,
  BuildViewData,
} from './build/model.ts'
