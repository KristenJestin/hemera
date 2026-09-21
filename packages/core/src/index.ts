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
  SessionTitleSource,
} from './domain/session.ts'
export { AGENT_PROVIDERS, NATIVE_STATES, SESSION_ENTRY_KINDS } from './domain/session.ts'
