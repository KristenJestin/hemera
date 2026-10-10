/**
 * The design system: what the renderer draws with. The theme comes through `@hemera/ui/theme.css`,
 * the motion kinds through `@hemera/ui/motion` and the icons through `@hemera/ui/icons`.
 */

export { AlertDialog, type AlertDialogProps } from './components/alert-dialog/alert-dialog.tsx'
export {
  Button,
  IconButton,
  type ButtonProps,
  type ButtonState,
  type IconButtonProps,
} from './components/button/button.tsx'
export {
  Checkbox,
  Tick,
  type CheckboxProps,
  type TickProps,
} from './components/checkbox/checkbox.tsx'
export {
  Dialog,
  DialogClose,
  type DialogProps,
  type DialogSize,
} from './components/dialog/dialog.tsx'
export { Input, Textarea, type InputProps, type TextareaProps } from './components/field/field.tsx'
export { Empty, type EmptyProps } from './components/empty/empty.tsx'
export { ErrorState, type ErrorStateProps } from './components/error-state/error-state.tsx'
export { FACE_SIZES, Face, type FaceProps, type FaceSize } from './components/face/face.tsx'
export { FACE_STATES, type FaceState } from './components/face/states.ts'
export {
  Frame,
  FrameFooter,
  FrameHeader,
  NESTED_RADIUS,
  type FrameProps,
} from './components/frame/frame.tsx'
export { Kbd, type KbdProps } from './components/kbd/kbd.tsx'
export {
  LETTER_TONES,
  LetterAvatar,
  initialsOf,
  letterToneOf,
  type LetterAvatarProps,
  type LetterTone,
} from './components/letter-avatar/letter-avatar.tsx'
export { List, ListItem, type ListItemProps, type ListProps } from './components/list/list.tsx'
export {
  Loading,
  Skeleton,
  type LoadingProps,
  type SkeletonProps,
  type SkeletonShape,
} from './components/loading/loading.tsx'
export {
  LIVE_WORDS,
  LiveChip,
  STUCK_AFTER,
  durationOf,
  type LiveChipProps,
  type LiveState,
} from './components/live-chip/live-chip.tsx'
export {
  LiveChipGlance,
  glanceWordsOf,
  type LiveChipGlanceProps,
  type LiveGlance,
  type LiveKind,
} from './components/live-chip/live-chip-glance.tsx'
export { Menu, type MenuItem, type MenuProps } from './components/menu/menu.tsx'
export {
  ChatThread,
  type ChatAction,
  type ChatActionKind,
  type ChatItem,
  type ChatLineTone,
  type ChatThreadProps,
  type HeldAnswer,
} from './blocks/chat/chat-thread.tsx'
export { ChatPage, type ChatPageProps, type ChatTurn } from './surfaces/chat/chat-page.tsx'
export {
  kindOf,
  loadMentionEditor,
  MentionBadge,
  MentionField,
  MentionFieldSkeleton,
  mentionsFor,
  type Mentionable,
  type MentionFieldProps,
  type MentionKind,
  type MentionRef,
} from './components/mention-field/mention-field.tsx'
export {
  choiceWords,
  EFFORTS,
  EffortGauge,
  ModelPicker,
  type Effort,
  type Judge,
  type ModelChoice,
  type ModelPickerProps,
  type PickerAgent,
  type PickerModel,
} from './components/model-picker/model-picker.tsx'
export { Popover, type PopoverProps } from './components/popover/popover.tsx'
export {
  Select,
  type SelectGroup,
  type SelectItem,
  type SelectProps,
} from './components/select/select.tsx'
export {
  SheetStack,
  type SheetStackProps,
  type SheetView,
  type SheetWidth,
} from './components/sheet/sheet.tsx'
export {
  OVER_MARK,
  SlidingMark,
  type SlidingMarkProps,
} from './components/sliding-mark/sliding-mark.tsx'
export {
  MARK_LEGENDS,
  StatusMark,
  type MarkSize,
  type MarkState,
  type StatusMarkProps,
} from './components/status-mark/status-mark.tsx'
export { Tabs, type TabsItem, type TabsProps } from './components/tabs/tabs.tsx'
export { Legend, type LegendProps } from './components/tooltip/legend.tsx'
export {
  Tooltip,
  TooltipProvider,
  type TooltipProps,
  type TooltipSide,
} from './components/tooltip/tooltip.tsx'
export { OverlayContainerProvider, type OverlayContainer } from './overlay.ts'
export { BALL_LEGENDS, BallMark, type Ball, type BallMarkProps } from './blocks/ball/ball-mark.tsx'
export {
  NEED_KINDS,
  NeedCard,
  type NeedAsk,
  type NeedCardProps,
  type NeedKind,
  type NeedState,
  type PermissionChoice,
} from './blocks/need/need-card.tsx'
export {
  NeedsYouList,
  type NeedRow,
  type NeedsYouListProps,
} from './blocks/need/needs-you-list.tsx'
export { EngineVeil, type EngineState, type EngineVeilProps } from './shell/engine-veil.tsx'
export {
  NoticeStack,
  type NoticeItem,
  type NoticeStackProps,
  type NoticeTone,
} from './shell/notice.tsx'
export * from './shell/sidebar.tsx'
export { WindowShell, type WindowShellProps } from './shell/window-shell.tsx'
export { ContentHeader, type ContentHeaderProps, type Crumb } from './shell/content-header.tsx'
export * from './surfaces/home/home-page.tsx'
export * from './surfaces/mission/mission-frame.tsx'
// The mission frame's own `MissionStage` (a stage chip) gives way to the vocabulary's.
export { type MissionStage } from './blocks/mission/vocabulary.ts'
export * from './blocks/mission/vocabulary.ts'
export * from './blocks/mission/mission-marks.tsx'
export * from './blocks/mission/mission-row.tsx'
export * from './surfaces/living-spec/living-spec-types.ts'
export * from './surfaces/living-spec/living-spec-page.tsx'
export * from './blocks/project-settings/ticket-providers.tsx'
export * from './blocks/project-settings/spec-fields.tsx'
export * from './blocks/project-settings/exclusive-resources.tsx'
export {
  AT_BASE,
  closeView,
  openView,
  showView,
  type MissionFrameState,
} from './surfaces/mission/navigation.ts'
export {
  Page,
  PageError,
  PageHeader,
  type PageHeaderProps,
  type PageProps,
} from './surfaces/page.tsx'
export * from './surfaces/project/project-page.tsx'
export {
  ProjectSettings,
  type ProjectSettingsProps,
  type SetUpAction,
  type SettingsForm,
  type SettingsSection,
} from './surfaces/project-settings/project-settings.tsx'
export {
  AddProject,
  type AddProjectProps,
  type FoundRepository,
} from './surfaces/add-project/add-project.tsx'
export {
  RepositoriesSection,
  RepositoryForm,
  type BaseFreshness,
  type RemoteChoice,
  type RepositoryDraft,
  type SettingsRepository,
} from './blocks/project-settings/repositories.tsx'
export { WorkspacesSection } from './blocks/project-settings/workspaces.tsx'
export {
  COMMAND_TYPES,
  CommandForm,
  CommandsSection,
  NEW_COMMAND,
  typeIcon,
  type CommandDraft,
  type CommandType,
  type SettingsCommand,
} from './blocks/project-settings/commands.tsx'
export {
  NEW_STEP,
  RecipeSection,
  StepForm,
  type SettingsStep,
  type StepDraft,
  type StepKind,
} from './blocks/project-settings/recipe.tsx'
export {
  VariableForm,
  VariablesSection,
  type SettingsVariable,
  type VariableDraft,
} from './blocks/project-settings/variables.tsx'
export {
  ServicesSection,
  type RunnableCommand,
  type SettingsRun,
} from './blocks/project-settings/services.tsx'
export { FormFoot, TemplateMenu } from './blocks/project-settings/parts.tsx'
export { SectionHead, type SectionHeadProps } from './components/section-head/section-head.tsx'
export {
  MARK_ICONS,
  ProjectMark,
  type Identity,
  type MarkIcon,
  type ProjectMarkProps,
} from './components/project-mark/project-mark.tsx'
export { MarkPicker, type MarkPickerProps } from './components/project-mark/mark-picker.tsx'
export {
  CommandLineField,
  type CatalogueChoice,
  type CommandLineValue,
} from './blocks/project-settings/command-line.tsx'
export {
  AgentsSection,
  AppearanceSection,
  DeveloperSection,
  HemeraAutoSection,
  JevKeyForm,
  ModelsSection,
  NotificationsSection,
  ProfileSection,
  type AgentRow,
  type Decision,
  type JevKey,
  type RoleModel,
  type RowErrors,
  type SoundStyleChoice,
  type Toggle,
} from './blocks/app-settings/app-sections.tsx'
export {
  APP_SECTIONS,
  AppSettings,
  type AppSection,
  type AppSettingsProps,
} from './surfaces/app-settings/app-settings.tsx'
export {
  NeverForm,
  NeverSection,
  type NeverFormProps,
  type NeverLine,
  type NeverSectionProps,
} from './blocks/project-settings/never.tsx'
export {
  RoleModelsSection,
  type ProjectRoleModel,
  type RoleModelsSectionProps,
} from './blocks/project-settings/role-models.tsx'
export {
  BudgetSection,
  type BudgetLimit,
  type BudgetSectionProps,
} from './blocks/project-settings/budget.tsx'
export {
  InstructionsSection,
  readingOf,
  type AgentInstructions,
  type InstructionsSectionProps,
  type Reading,
  type RepositoryInstructions,
} from './blocks/project-settings/instructions.tsx'
export {
  SETUP_KINDS,
  SETUP_TITLES,
  type Proposal,
  type ProposedCommand,
  type ProposedNever,
  type ProposedRepository,
  type ProposedStep,
  type ProposedVariable,
  type SetupKind,
} from './blocks/setup/proposal.tsx'
export { SetupCard, type CardStatus, type SetupCardProps } from './blocks/setup/setup-card.tsx'
export {
  type ProjectSetupProps,
  type SetupAgent,
  type SetupCardEntry,
} from './surfaces/project-setup/project-setup.tsx'
export {
  ProjectTasks,
  SetupTask,
  SetupProposals,
  type SetupTaskProps,
} from './surfaces/project-setup/setup-task.tsx'
export { FirstLaunch, type FirstLaunchProps } from './surfaces/first-launch/first-launch.tsx'
export * from './blocks/start/start-field.tsx'
