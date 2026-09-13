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
  ROOT_REPOSITORY,
  projectName,
  repositoryLocations,
  repositoryPath,
} from './domain/project.ts'
export type { Project, Workspace } from './domain/project.ts'
export {
  EmptyMessageError,
  MAX_TITLE_LENGTH,
  NoActiveProjectError,
  UNTITLED_SESSION,
  archivedSessions,
  currentSessions,
  isArchived,
  messageBody,
  titleAfterMessage,
  titleFromMessage,
} from './domain/session.ts'
export type { Mission, Session, SessionEntry } from './domain/session.ts'
