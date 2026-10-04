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
export { EngineVeil, type EngineState, type EngineVeilProps } from './shell/engine-veil.tsx'
export {
  NoticeStack,
  type NoticeItem,
  type NoticeStackProps,
  type NoticeTone,
} from './shell/notice.tsx'
export {
  Sidebar,
  SidebarRow,
  type SidebarPlace,
  type SidebarProject,
  type SidebarProps,
  type SidebarRowProps,
} from './shell/sidebar.tsx'
export { WindowShell, type WindowShellProps } from './shell/window-shell.tsx'
export { ContentHeader, type ContentHeaderProps, type Crumb } from './shell/content-header.tsx'
export {
  HomePage,
  type HomePageProps,
  type HomeRow,
  type HomeSection,
} from './surfaces/home/home-page.tsx'
export {
  MissionFrame,
  type MissionFrameProps,
  type MissionStage,
  type MissionView,
  type StageTone,
  type ViewWidth,
} from './surfaces/mission/mission-frame.tsx'
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
export {
  ProjectPage,
  type ProjectMissionRow,
  type ProjectPageProps,
  type ProjectRepository,
  type ProjectStageGroup,
} from './surfaces/project/project-page.tsx'
export {
  ProjectSettings,
  type ProjectSettingsProps,
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
  type CommandDraft,
  type CommandType,
  type SettingsCommand,
} from './blocks/project-settings/commands.tsx'
export {
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
export { SheetFoot, TemplateMenu } from './blocks/project-settings/parts.tsx'
export { SectionHead, type SectionHeadProps } from './components/section-head/section-head.tsx'
export {
  MARK_ICONS,
  ProjectMark,
  type Identity,
  type MarkIcon,
  type ProjectMarkProps,
} from './components/project-mark/project-mark.tsx'
export {
  CommandLineField,
  type CatalogueChoice,
  type CommandLineValue,
} from './blocks/project-settings/command-line.tsx'
export { IdentityField, type IdentityFieldProps } from './surfaces/add-project/identity-field.tsx'
