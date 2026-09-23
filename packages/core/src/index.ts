/** Public surface of the Hemera domain and use cases. */

export {
  FIRST_RANK,
  InvalidRankError,
  RankOrderError,
  compareRanks,
  isRank,
  rankBetween,
  ranksFor,
} from './domain/rank.ts'
export {
  InvalidProjectNameError,
  InvalidRepositoryPathError,
  MAIN_WORKSPACE,
  MAX_PROJECT_NAME_LENGTH,
  PROJECT_TONES,
  ROOT_REPOSITORY,
  projectName,
  repositoryLocations,
  repositoryPath,
} from './domain/project.ts'
export type { Project, ProjectTone, Workspace } from './domain/project.ts'
export {
  EmptyMessageError,
  EmptyTitleError,
  MAX_TITLE_LENGTH,
  NEW_SESSION_TITLE,
  NoActiveProjectError,
  NoAgentError,
  archivedSessions,
  currentSessions,
  isArchived,
  messageBody,
  sessionTitle,
  titleAfterMessage,
  titleFromMessage,
} from './domain/session.ts'
export type {
  AgentProvider,
  Mission,
  NativeState,
  Session,
  SessionEntry,
  SessionEntryKind,
  SessionEntryRole,
  SessionEntryOrigin,
  SessionTitleSource,
} from './domain/session.ts'
export {
  AGENT_PROVIDERS,
  NATIVE_STATES,
  SESSION_ENTRY_KINDS,
  SESSION_ENTRY_ORIGINS,
} from './domain/session.ts'
export {
  READ_PAGE_BYTES,
  SEARCH_MATCH_LIMIT,
  SEARCH_SCAN_BYTES,
  SEARCH_SKIPS_LISTED,
  TOOL_LABELS,
  TOOL_NAMES,
  admitTool,
  hemeraToolNamed,
  offeredTools,
} from './domain/tools.ts'
export type {
  GuardDecision,
  SearchHit,
  SearchLimit,
  SearchResult,
  SearchSkip,
  ToolLabel,
  ToolMark,
  ToolName,
} from './domain/tools.ts'
export {
  COMMAND_SCOPES,
  COMMAND_TYPES,
  DuplicateCommandNameError,
  EmptyCommandLineError,
  EmptyCommandNameError,
  UnknownCommandScopeError,
  UnknownCommandTypeError,
  addressIn,
  commandLine,
  commandName,
  commandScope,
  commandType,
  joinsRunningRun,
  runsInMain,
  lineFor,
  portOf,
} from './domain/commands.ts'
export type { Command, CommandScope, CommandType } from './domain/commands.ts'
export {
  AGENTS_FILE,
  CONTEXT_BASE,
  CONTEXT_REACHES,
  CONTEXT_SOURCES,
  DELIVERY_MARKER,
  contextUri,
  deliveryText,
} from './domain/context.ts'
export type { BaseReach, ContextReach, ContextSource } from './domain/context.ts'
export {
  InvalidVariableKeyError,
  InvalidWorkspaceNameError,
  RECIPE_KINDS,
  RECIPE_SCOPES,
  STEP_KINDS,
  STEP_STATES,
  WORKSPACE_STATES,
  branchNameFor,
  defaultBranchPrefix,
  mergedEnvironment,
  nextPending,
  resumedSteps,
  slugOf,
  stepsFor,
  variableKey,
  workspaceName,
  workspaceStateOf,
} from './domain/workspace.ts'
export type {
  RecipeKind,
  RecipeScope,
  RecipeStep,
  StepKind,
  StepState,
  Variables,
  WorkspaceState,
  WorkspaceStep,
} from './domain/workspace.ts'
