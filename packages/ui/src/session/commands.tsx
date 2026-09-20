import { IconArchive, IconMessages, IconPlus, IconRestore } from '../icons.ts'
import type { CommandGroup } from '../shell/command-palette.tsx'
import type { ShellSession } from '../shell/model.ts'
import { type ArchivedSession, shownTitle } from './model.ts'

/**
 * What a Session offers the command palette (design D4b-04, D4b-06).
 *
 * The palette knows nothing of Hemera: it is handed groups of entries and it filters them. So
 * the Sessions are written as groups here, once, rather than in the page that opens the palette
 * — the renderer hands over its lists and its callbacks and the wording stays in the design
 * system, where the sidebar and the header take theirs from.
 *
 * Opening a Session is not a command that then asks which one: every Session is an entry of its
 * own, so typing part of a title narrows to it the way typing part of any other command does.
 * Restoring works the same way, from the archived list, and there is no command that deletes.
 */
export interface SessionCommandsProps {
  /** The Sessions of the active Project, in the order the sidebar lists them. */
  sessions: ShellSession[]
  /** The archived ones, which is what `Restore` reads. */
  archived: ArchivedSession[]
  /** The Session the window is on, and null when it is somewhere else. */
  current: ShellSession | null
  /** The keystroke that creates one, already written for the platform. */
  newSessionKeys?: string | undefined
  onNewSession: () => void
  onOpenSession: (id: string) => void
  onArchiveSession: (id: string) => void
  onRestoreSession: (id: string) => void
}

export function sessionCommands({
  sessions,
  archived,
  current,
  newSessionKeys,
  onNewSession,
  onOpenSession,
  onArchiveSession,
  onRestoreSession,
}: SessionCommandsProps): CommandGroup[] {
  const group: CommandGroup = {
    label: 'Sessions',
    entries: [
      {
        id: 'session-new',
        label: 'New session',
        keys: newSessionKeys,
        icon: <IconPlus size="sm" />,
        onSelect: onNewSession,
      },
      ...sessions.map((session) => ({
        id: `session-open-${session.id}`,
        label: shownTitle(session.title),
        hint: session.writtenAt,
        icon: <IconMessages size="sm" />,
        onSelect: () => onOpenSession(session.id),
      })),
    ],
  }
  if (current !== null) {
    group.entries.push({
      id: 'session-archive',
      label: 'Archive current session',
      hint: shownTitle(current.title),
      icon: <IconArchive size="sm" />,
      onSelect: () => onArchiveSession(current.id),
    })
  }
  if (archived.length === 0) return [group]
  return [
    group,
    {
      label: 'Archived',
      entries: archived.map((session) => ({
        id: `session-restore-${session.id}`,
        label: `Restore ${shownTitle(session.title)}`,
        hint: session.archivedAt,
        icon: <IconRestore size="sm" />,
        onSelect: () => onRestoreSession(session.id),
      })),
    },
  ]
}
