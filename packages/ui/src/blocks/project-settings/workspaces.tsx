import type { ReactNode } from 'react'

import { Button, IconButton } from '../../components/button/button.tsx'
import { Input } from '../../components/field/field.tsx'
import { Frame } from '../../components/frame/frame.tsx'
import { SectionHead } from '../../components/section-head/section-head.tsx'
import { Tooltip } from '../../components/tooltip/tooltip.tsx'
import { IconFolderOpen, IconGitBranch, IconX } from '../../icons.ts'
import { FieldSkeleton, Section } from './parts.tsx'

/**
 * Where a Project's Workspaces are made on disk, and what their branches start with: a section of
 * its own in the settings.
 *
 * Two fields, each empty until the user writes in it: an empty field is the default, and the
 * default is what the field shows in its quiet tone — Hemera's folder for the Project, `hemera/` —
 * so what applies is always read in the field. A field the user wrote in carries an × inside its
 * end that empties it, back to the default. Under them, what they make for one mission, as values:
 * the folder its Workspace is created in and the branch it is on — `…/acme/ACME-12` on
 * `hemera/ACME-12` — following what is typed. A prefix Git would refuse is said under its field,
 * in Git's rules.
 */
export interface WorkspacesSectionProps {
  /** The folder the user chose; null for the default. */
  folder: string | null
  /** Where the Workspaces go when no folder is chosen. */
  defaultFolder: string
  onFolder: (folder: string | null) => void
  onChooseFolder: () => void
  /** The prefix the user chose; null for the default. */
  prefix: string | null
  /** What the branches start with when no prefix is chosen. */
  defaultPrefix: string
  onPrefix: (prefix: string | null) => void
  /** The mission the example is drawn for: `ACME-12`. */
  example: string
  folderError?: string | undefined
  prefixError?: string | undefined
  loading?: boolean | undefined
}

/** The × that empties a field back to its default. */
function Reset({ what, onReset }: { what: string; onReset: () => void }): ReactNode {
  return (
    <Tooltip label="Back to the default">
      <IconButton
        variant="ghost"
        size="sm"
        icon={<IconX size="sm" />}
        aria-label={`Back to the default ${what}`}
        onClick={onReset}
      />
    </Tooltip>
  )
}

/** A value as it was typed: an empty field is the default. */
function chosen(value: string): string | null {
  return value.trim() === '' ? null : value
}

/** The folder a mission's Workspace is made in, under the Workspaces folder. */
export function workspaceFolderOf(folder: string, mission: string): string {
  return `${folder.replace(/[/\\]+$/, '')}/${mission}`
}

const EXAMPLE = 'flex flex-col gap-1.5 border-t border-border px-4 py-3'

const EXAMPLE_HEAD = 'text-xs text-muted-foreground'

const VALUES = 'flex min-w-0 flex-wrap items-center gap-x-6 gap-y-1.5'

const VALUE = 'flex min-w-0 items-center gap-1.5 font-mono text-xs'

const VALUE_ICON = 'flex shrink-0 text-muted-foreground'

export function WorkspacesSection({
  folder,
  defaultFolder,
  onFolder,
  onChooseFolder,
  prefix,
  defaultPrefix,
  onPrefix,
  example,
  folderError,
  prefixError,
  loading = false,
}: WorkspacesSectionProps): ReactNode {
  const path = workspaceFolderOf(folder ?? defaultFolder, example)
  const branch = `${prefix ?? defaultPrefix}${example}`
  return (
    <Section label="Workspaces">
      <SectionHead title="Workspaces" />
      <Frame>
        <div className="flex flex-col gap-4 p-4" aria-busy={loading}>
          {loading ? (
            <>
              <FieldSkeleton label="Workspaces folder" />
              <FieldSkeleton label="Branch prefix" />
            </>
          ) : (
            <>
              <Input
                label="Workspaces folder"
                icon={<IconFolderOpen size="sm" />}
                placeholder={defaultFolder}
                value={folder ?? ''}
                onValueChange={(value) => onFolder(chosen(value))}
                error={folderError}
                trailing={
                  folder === null ? undefined : (
                    <Reset what="folder" onReset={() => onFolder(null)} />
                  )
                }
                action={<Button onClick={onChooseFolder}>Choose…</Button>}
              />
              <Input
                label="Branch prefix"
                icon={<IconGitBranch size="sm" />}
                placeholder={defaultPrefix}
                value={prefix ?? ''}
                onValueChange={(value) => onPrefix(chosen(value))}
                error={prefixError}
                trailing={
                  prefix === null ? undefined : (
                    <Reset what="prefix" onReset={() => onPrefix(null)} />
                  )
                }
              />
            </>
          )}
        </div>
        {!loading && (
          <div className={EXAMPLE} data-example="">
            <span className={EXAMPLE_HEAD}>{example}</span>
            <div className={VALUES}>
              <span className={VALUE}>
                <span className={VALUE_ICON}>
                  <IconFolderOpen size="sm" aria-hidden="true" />
                </span>
                <span className="sr-only">Folder:</span>
                <span className="truncate" data-example-folder="">
                  {path}
                </span>
              </span>
              <span className={VALUE}>
                <span className={VALUE_ICON}>
                  <IconGitBranch size="sm" aria-hidden="true" />
                </span>
                <span className="sr-only">Branch:</span>
                <span className="truncate" data-example-branch="">
                  {branch}
                </span>
              </span>
            </div>
          </div>
        )}
      </Frame>
    </Section>
  )
}
