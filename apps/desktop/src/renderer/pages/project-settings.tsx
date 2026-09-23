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
    kind: command.type,
    folder: command.folder ?? '.',
  }
}

/** What the engine writes a command from: the fields a row edits, and the others as they are. */
type CommandWrite = Pick<
  Command,
  'name' | 'line' | 'lineWindows' | 'lineLinux' | 'type' | 'folder' | 'scope' | 'portless'
>

/**
 * A row as the engine writes it. What the row does not show — the per-system lines, the scope,
 * Portless — is kept as the catalogue holds it, and a new command takes the defaults (D8-07).
 */
function writeOf(line: CommandLine, held: Command | undefined): CommandWrite {
  return {
    name: line.name,
    line: line.command,
    lineWindows: held?.lineWindows ?? null,
    lineLinux: held?.lineLinux ?? null,
    type: line.kind,
    // The row's `.` is the Workspace root, which the engine is told as no folder at all.
    folder: line.folder === '.' ? null : line.folder,
    scope: held?.scope ?? 'workspace',
    portless: held?.portless ?? false,
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
        onAddCommand={async (line) => await onSaveCommand(writeOf(line, undefined), false)}
        onUpdateCommand={async (line) =>
          await onSaveCommand(
            writeOf(
              line,
              commands.find((one) => one.name === line.name),
            ),
            true,
          )
        }
        onRemoveCommand={onRemoveCommand}
        onArchive={onArchive}
      />
    </div>
  )
}
