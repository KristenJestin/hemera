import type { ReactNode } from 'react'

import type { Command } from '@hemera/ipc'
import {
  ProjectSettings,
  type CommandLine,
  type ProjectDraft,
  type RepositoryLine,
} from '@hemera/ui'

/** A command of the catalogue, as its row draws it: the Workspace root is `.` on screen. */
function lineOf(command: Command): CommandLine {
  return {
    id: command.name,
    name: command.name,
    command: command.line,
    lineWindows: command.lineWindows,
    lineLinux: command.lineLinux,
    type: command.type,
    scope: command.scope,
    portless: command.portless,
    folder: command.folder ?? '.',
  }
}

/** What the engine writes a command from: every field the row edits (D8-07, D8-10). */
type CommandWrite = Pick<
  Command,
  'name' | 'line' | 'lineWindows' | 'lineLinux' | 'type' | 'folder' | 'scope' | 'portless'
>

/** A row as the engine writes it. */
function writeOf(line: CommandLine): CommandWrite {
  return {
    name: line.name,
    line: line.command,
    lineWindows: line.lineWindows,
    lineLinux: line.lineLinux,
    type: line.type,
    // The row's `.` is the Workspace root, which the engine is told as no folder at all.
    folder: line.folder === '.' ? null : line.folder,
    scope: line.scope,
    portless: line.portless,
  }
}

/** The settings of the active Project (design D4-07): composed, and bound to its callbacks. */
export function ProjectSettingsPage({
  project,
  subtitle,
  repositories,
  folders,
  onSave,
  onBrowse,
  onCheckFolder,
  onMainPathChange,
  onAddRepository,
  onRemoveRepository,
  commands,
  onSaveCommand,
  onRemoveCommand,
  onArchive,
}: {
  project: ProjectDraft
  subtitle?: string
  repositories: RepositoryLine[]
  folders: RepositoryLine[]
  onSave: (draft: ProjectDraft) => Promise<string | null>
  onBrowse: () => Promise<string | null>
  onCheckFolder: (path: string) => Promise<string | null>
  onMainPathChange: (path: string) => void
  onAddRepository: (path: string) => Promise<string | null>
  onRemoveRepository: (path: string) => void
  /** The catalogue of the Project, as the engine answered it (D6-12). */
  commands: readonly Command[]
  /**
   * Writes a command: a new one, or the one of the same name when `existing` is true. The
   * folder is null for the Workspace root. Answers the engine's refusal, or null.
   */
  onSaveCommand: (command: CommandWrite, existing: boolean) => Promise<string | null>
  onRemoveCommand: (name: string) => void
  onArchive: () => void
}): ReactNode {
  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-10">
      <ProjectSettings
        project={project}
        subtitle={subtitle}
        repositories={repositories}
        folders={folders}
        onSave={onSave}
        onBrowse={onBrowse}
        onCheckFolder={onCheckFolder}
        onMainPathChange={onMainPathChange}
        onAddRepository={onAddRepository}
        onRemoveRepository={onRemoveRepository}
        commands={commands.map(lineOf)}
        onAddCommand={async (line) => await onSaveCommand(writeOf(line), false)}
        onUpdateCommand={async (line) => await onSaveCommand(writeOf(line), true)}
        onRemoveCommand={onRemoveCommand}
        onArchive={onArchive}
      />
    </div>
  )
}
