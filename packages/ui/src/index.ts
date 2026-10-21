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
export { Face, type FaceProps } from './components/face/face.tsx'
export { FACE_SIZES, type FaceSize } from './components/face/face-sizes.ts'
export { FACE_STATES, type FaceState } from './components/face/states.ts'
export {
  Frame,
  FrameFooter,
  FrameHeader,
  NESTED_RADIUS,
  type FrameProps,
} from './components/frame/frame.tsx'
export { Kbd, type KbdProps } from './components/kbd/kbd.tsx'
export { LetterAvatar, type LetterAvatarProps } from './components/letter-avatar/letter-avatar.tsx'
export {
  LETTER_TONES,
  initialsOf,
  letterToneOf,
  type LetterTone,
} from './components/letter-avatar/letter-names.ts'
export { List, ListItem, type ListItemProps, type ListProps } from './components/list/list.tsx'
export {
  Loading,
  Skeleton,
  type LoadingProps,
  type SkeletonProps,
  type SkeletonShape,
} from './components/loading/loading.tsx'
export { LiveChip, type LiveChipProps, type LiveState } from './components/live-chip/live-chip.tsx'
export {
  LiveChipGlance,
  type LiveChipGlanceProps,
  type LiveGlance,
  type LiveKind,
} from './components/live-chip/live-chip-glance.tsx'
export {
  LIVE_WORDS,
  STUCK_AFTER,
  durationOf,
  glanceWordsOf,
} from './components/live-chip/live-words.ts'
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
  MentionBadge,
  MentionField,
  MentionFieldSkeleton,
  mentionsFor,
  type Mentionable,
  type MentionFieldProps,
  type MentionKind,
  type MentionRef,
} from './components/mention-field/mention-field.tsx'
export { loadMentionEditor } from './components/mention-field/load-mention-editor.ts'
export {
  EffortGauge,
  ModelPicker,
  type Effort,
  type Judge,
  type ModelChoice,
  type ModelPickerProps,
  type PickerAgent,
  type PickerModel,
} from './components/model-picker/model-picker.tsx'
export { choiceWords, EFFORTS } from './components/model-picker/model-choice.ts'
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
export { Slider, type SliderProps } from './components/slider/slider.tsx'
export {
  OVER_MARK,
  SlidingMark,
  type SlidingMarkProps,
} from './components/sliding-mark/sliding-mark.tsx'
export {
  StatusMark,
  type MarkSize,
  type StatusMarkProps,
} from './components/status-mark/status-mark.tsx'
export { MARK_LEGENDS, type MarkState } from './components/status-mark/mark-legends.ts'
export { Tabs, type TabsItem, type TabsProps } from './components/tabs/tabs.tsx'
export { Legend, type LegendProps } from './components/tooltip/legend.tsx'
export {
  Tooltip,
  TooltipProvider,
  type TooltipProps,
  type TooltipSide,
} from './components/tooltip/tooltip.tsx'
export { OverlayContainerProvider, type OverlayContainer } from './overlay.ts'
export { BallMark, type BallMarkProps } from './blocks/ball/ball-mark.tsx'
export { BALL_LEGENDS, type Ball } from './blocks/ball/ball-legends.ts'
export {
  NeedCard,
  type NeedAsk,
  type NeedCardProps,
  type NeedState,
  type PermissionChoice,
} from './blocks/need/need-card.tsx'
export { NEED_KINDS, type NeedKind } from './blocks/need/need-kinds.ts'
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
/** The values the diff view draws, by their own names: `Diff.DiffFile`, `Diff.DiffComment`. */
export * as Diff from './surfaces/diff/diff-types.ts'
export {
  CommentedVersion,
  DiffActions,
  DiffView,
  type DiffViewHandlers,
  type DiffViewProps,
} from './surfaces/diff/diff-view.tsx'
export type { CommentAction, CommentHandlers, NewComment } from './surfaces/diff/diff-comments.tsx'
export type { DiffLayout, StageTarget } from './surfaces/diff/diff-stage.tsx'
export { idOf as diffFileId } from './surfaces/diff/diff-tree.tsx'
// The mission frame's own `MissionStage` (a stage chip) gives way to the vocabulary's.
export { type MissionStage } from './blocks/mission/vocabulary.ts'
export * from './blocks/mission/vocabulary.ts'
export * from './blocks/mission/mission-marks.tsx'
export * from './blocks/mission/mission-row.tsx'
export * from './blocks/mission/kept-agent-chip.tsx'
export * from './blocks/mission/kept-agent-words.ts'
export * from './blocks/mission/stage-card.tsx'
export * from './surfaces/living-spec/living-spec-types.ts'
export * from './surfaces/living-spec/living-spec-page.tsx'
/** The values the Planning page draws, by their engine names: `Planning.Question`, `Planning.Probe`. */
export * as Planning from './blocks/planning/planning-types.ts'
export { PlanningPage, type PlanningPageProps } from './surfaces/planning/planning-page.tsx'
export { discussionViewId, probeViewId } from './surfaces/planning/planning-view-ids.ts'
export {
  freezeOf,
  planningNow,
  planningSteps,
  type FreezeOffer,
  type Planner,
  type PlanningFacts,
  type PlanningNow,
  type PlanningTarget,
} from './blocks/planning/planning-progress.ts'
export { FreezeButton, FreezeNote } from './blocks/planning/freeze.tsx'
export { answerStepOf, type AnswerStep } from './blocks/planning/answer-step.ts'
export { planningViews, type PlanningViewsOf } from './surfaces/planning/planning-views.tsx'
export {
  DiscussionThread,
  type DiscussionThreadProps,
} from './blocks/planning/discussion-thread.tsx'
export { ProbeReport } from './blocks/planning/probes.tsx'
/** The values the Ready and Building pages draw, by the words they use: `Building.Task`. */
export * as Building from './surfaces/building/building-types.ts'
export {
  ReadyPage,
  blockerOf,
  launchable,
  type ReadyHandlers,
  type ReadyPageProps,
} from './surfaces/building/ready-page.tsx'
export {
  BuildingPage,
  measuresOf,
  type BuildingHandlers,
  type BuildingPageProps,
  type ServiceAction,
} from './surfaces/building/building-page.tsx'
export { TaskView } from './surfaces/building/task-view.tsx'
/** The values the Review page, its round view and Ship draw, by the words they use: `Review.Remark`. */
export * as Review from './surfaces/review/review-types.ts'
export { ReviewPage, type ReviewPageProps } from './surfaces/review/review-page.tsx'
export {
  type Attached,
  type FeedbackHandlers,
  type NewRemark,
} from './surfaces/review/review-feedback.tsx'
export { type RailHandlers } from './surfaces/review/review-rail.tsx'
export { RoundView, type PointAction, type RoundViewProps } from './surfaces/review/round-view.tsx'
export { ShipDialog, type ShipDialogProps } from './surfaces/review/ship-dialog.tsx'
export * from './blocks/project-settings/provider-model.ts'
export * from './blocks/project-settings/ticket-providers.tsx'
export * from './blocks/project-settings/provider-forms.tsx'
export * from './blocks/project-settings/spec-fields-model.ts'
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
export * from './surfaces/project/mission-field.ts'
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
  type RemoteChoice,
  type RepositoryDraft,
} from './blocks/project-settings/repositories.tsx'
export {
  type BaseFreshness,
  type SettingsRepository,
} from './blocks/project-settings/repositories-model.ts'
export { WorkspacesSection } from './blocks/project-settings/workspaces.tsx'
export { TestsForm, TestsSection } from './blocks/project-settings/tests.tsx'
export {
  RUNNERS,
  draftOfTests,
  testsProblem,
  unchosen,
  type Custom as TestsCustom,
  type Guess as TestsGuess,
  type RepositoryTests,
  type Runner as TestsRunner,
  type TestsDraft,
  type TestsRefusal,
} from './blocks/project-settings/tests-model.ts'
export { CommandForm, CommandsSection } from './blocks/project-settings/commands.tsx'
export {
  COMMAND_TYPES,
  typeIcon,
  type CommandType,
} from './blocks/project-settings/command-types.tsx'
export {
  NEW_COMMAND,
  type CommandDraft,
  type SettingsCommand,
} from './blocks/project-settings/commands-model.ts'
export { RecipeSection, StepForm } from './blocks/project-settings/recipe.tsx'
export {
  NEW_STEP,
  type SettingsStep,
  type StepDraft,
  type StepKind,
} from './blocks/project-settings/recipe-model.ts'
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
export {
  CheckForm,
  ChecksSection,
  type CheckRefusals,
  type ProofLimitField,
} from './blocks/project-settings/checks.tsx'
export {
  NEW_CHECK,
  type CheckDraft,
  type SettingsCheck,
} from './blocks/project-settings/checks-model.ts'
export {
  DocRecipeForm,
  DocRecipesSection,
  type DocRecipeRefusals,
} from './blocks/project-settings/doc-recipes.tsx'
export {
  NEW_DOC_RECIPE,
  recipeName,
  type DocRecipeDraft,
  type SettingsDocRecipe,
} from './blocks/project-settings/doc-recipes-model.ts'
export {
  DeliveryRulesSection,
  type DeliveryTarget,
} from './blocks/project-settings/delivery-rules.tsx'
export {
  PushForm,
  RepositoryForm as DeliveryRepositoryForm,
  ReviewersForm,
  StepForm as DeliveryStepForm,
  TemplateForm,
  type PushDraft,
  type RepositoryDraft as DeliveryRepositoryDraft,
  type ReviewersListing,
  type StepAnchor,
  type StepDraft as DeliveryStepDraft,
} from './blocks/project-settings/delivery-forms.tsx'
export {
  CLEANUP_KINDS as DELIVERY_CLEANUP_KINDS,
  newStep,
} from './blocks/project-settings/delivery-form-options.ts'
export { filled, templateRefusal } from './blocks/project-settings/delivery-words.ts'
export { placeOf as deliveryPlaceOf } from './blocks/project-settings/delivery-drafts.ts'
export {
  CATALOGUE,
  MOMENT_WORDS,
  STEP_WORDS,
  kindsOn,
  type CleanupStep,
  type CliState as DeliveryCliState,
  type DeliveryRefusals,
  type DeliveryRepository as DeliveryRepositoryShown,
  type DeliveryRules as DeliveryRulesShown,
  type DeliveryStep,
  type Dependency as DeliveryDependencyShown,
  type ForgeKind,
  type ForgeView,
  type Moment,
  type Preset,
  type PullRequestRules,
  type RecipeStep as DeliveryRecipeStep,
  type Reviewer,
  type StepConfig,
  type StepKind as DeliveryStepKind,
} from './blocks/project-settings/delivery-model.ts'
export { SectionHead, type SectionHeadProps } from './components/section-head/section-head.tsx'
export {
  ProjectMark,
  type Identity,
  type ProjectMarkProps,
} from './components/project-mark/project-mark.tsx'
export { MARK_ICONS, type MarkIcon } from './components/project-mark/mark-icons.tsx'
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
export { AppSettings, type AppSettingsProps } from './surfaces/app-settings/app-settings.tsx'
export { APP_SECTIONS, type AppSection } from './surfaces/app-settings/app-sections.tsx'
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
  type InstructionsSectionProps,
} from './blocks/project-settings/instructions.tsx'
export {
  readingOf,
  type AgentInstructions,
  type Reading,
  type RepositoryInstructions,
} from './blocks/project-settings/instructions-model.ts'
export {
  type Proposal,
  type ProposedCommand,
  type ProposedNever,
  type ProposedRepository,
  type ProposedStep,
  type ProposedVariable,
} from './blocks/setup/proposal.tsx'
export { SETUP_KINDS, SETUP_TITLES, type SetupKind } from './blocks/setup/setup-kinds.tsx'
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
