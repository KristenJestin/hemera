/** The Session surfaces: its head, its empty state, its archives, and its rows in the sidebar. */

export { ArchivedSessions, type ArchivedSessionsProps } from './archived-sessions.tsx'
export { sessionCommands, type SessionCommandsProps } from './commands.tsx'
export { NEW_SESSION_TITLE, committedTitle, shownTitle, type ArchivedSession } from './model.ts'
export { SessionEmpty } from './session-empty.tsx'
export { SessionHeader, type SessionHeaderProps } from './session-header.tsx'
export {
  SidebarSessionEntry,
  SidebarSessions,
  type SidebarSessionEntryProps,
  type SidebarSessionsProps,
} from './sidebar-sessions.tsx'
