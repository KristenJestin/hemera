import { cn } from 'cn'
import type { ReactNode } from 'react'

import { Button, IconButton } from '../../components/button/button.tsx'
import { Input } from '../../components/field/field.tsx'
import { Frame } from '../../components/frame/frame.tsx'
import { Tooltip } from '../../components/tooltip/tooltip.tsx'
import { IconFolderOpen, IconGitBranch, IconX } from '../../icons.ts'
import { FieldSkeleton, Section, SectionHead } from './parts.tsx'

/**
 * Where a Project's Workspaces are made on disk, and what their branches start with.
 *
 * Two fields, each empty until the user writes in it: an empty field is the default, and the
 * default is what the field shows in its quiet tone — Hemera's own folder for the Project, the
 * Project's name as a slug — so what applies is always read in the field and never in a sentence
 * beside it. A field the user wrote in carries an × inside its end that empties it, back to the
 * default. The prefix's field ends with what follows it, `/{workspace}`, so the branch is read
 * whole. A value is kept when the field is left or Enter is pressed; a prefix Git would refuse is
 * said under the field, in Git's rules.
 */
export interface WorkspacesFieldsProps {
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
  folderError?: string | undefined
  prefixError?: string | undefined
  /** Side by side on one line, under another list; one under the other in a section of their own. */
  inline?: boolean | undefined
}

const TAIL = 'font-mono text-xs text-muted-foreground'

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

export function WorkspacesFields({
  folder,
  defaultFolder,
  onFolder,
  onChooseFolder,
  prefix,
  defaultPrefix,
  onPrefix,
  folderError,
  prefixError,
  inline = false,
}: WorkspacesFieldsProps): ReactNode {
  return (
    <div className={cn('flex w-full min-w-0', inline ? 'items-start gap-4' : 'flex-col gap-4')}>
      <Input
        label="Workspaces folder"
        className={inline ? 'min-w-0 flex-2' : undefined}
        icon={<IconFolderOpen size="sm" />}
        placeholder={defaultFolder}
        value={folder ?? ''}
        onValueChange={(value) => onFolder(chosen(value))}
        error={folderError}
        trailing={
          folder === null ? undefined : <Reset what="folder" onReset={() => onFolder(null)} />
        }
        action={<Button onClick={onChooseFolder}>Choose…</Button>}
      />
      <Input
        label="Branch prefix"
        className={inline ? 'min-w-0 flex-1' : undefined}
        icon={<IconGitBranch size="sm" />}
        placeholder={defaultPrefix}
        value={prefix ?? ''}
        onValueChange={(value) => onPrefix(chosen(value))}
        error={prefixError}
        trailing={
          <>
            <span className={TAIL}>/{'{workspace}'}</span>
            {prefix !== null && <Reset what="prefix" onReset={() => onPrefix(null)} />}
          </>
        }
      />
    </div>
  )
}

export interface WorkspacesSectionProps extends Omit<WorkspacesFieldsProps, 'inline'> {
  loading?: boolean | undefined
}

/** The Workspaces as a section of their own. */
export function WorkspacesSection({
  loading = false,
  ...fields
}: WorkspacesSectionProps): ReactNode {
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
            <WorkspacesFields {...fields} />
          )}
        </div>
      </Frame>
    </Section>
  )
}
