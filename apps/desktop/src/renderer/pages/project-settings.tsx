import type { ReactNode } from 'react'

import type { Command } from '@hemera/ipc'
import {
  ProjectSettings,
  type CommandLine,
  type ProjectSettingsDraft,
  type RepositoryLine,
} from '@hemera/ui'

/** A command of the catalogue, as its row draws it: the Workspace root is `.` on screen. */
function lineOf(command: Command): CommandLine {
  return {
    id: command.name,
    name: command.name,
    command: command.line,
    kind: command.kind,
    folder: command.folder ?? '.',
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
  project: ProjectSettingsDraft
  subtitle?: string
  repositories: RepositoryLine[]
  folders: RepositoryLine[]
  onSave: (draft: ProjectSettingsDraft) => Promise<string | null>
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
  onSaveCommand: (
    command: { name: string; line: string; kind: Command['kind']; folder: string | null },
    existing: boolean,
  ) => Promise<string | null>
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
        // The row's `.` is the Workspace root, which the engine is told as no folder at all.
        onAddCommand={async (line) =>
          await onSaveCommand(
            {
              name: line.name,
              line: line.command,
              kind: line.kind,
              folder: line.folder === '.' ? null : line.folder,
            },
            false,
          )
        }
        onUpdateCommand={async (line) =>
          await onSaveCommand(
            {
              name: line.name,
              line: line.command,
              kind: line.kind,
              folder: line.folder === '.' ? null : line.folder,
            },
            true,
          )
        }
        onRemoveCommand={onRemoveCommand}
        onArchive={onArchive}
      />
    </div>
  )
}
