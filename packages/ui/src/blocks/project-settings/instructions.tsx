import type { ReactNode } from 'react'

import { AgentMark } from '../../components/agent-mark/agent-mark.tsx'
import { Button } from '../../components/button/button.tsx'
import { Empty } from '../../components/empty/empty.tsx'
import { Frame } from '../../components/frame/frame.tsx'
import { Skeleton } from '../../components/loading/loading.tsx'
import { SectionHead } from '../../components/section-head/section-head.tsx'
import { Legend } from '../../components/tooltip/legend.tsx'
import { IconFileText } from '../../icons.ts'
import { Section } from './parts.tsx'
import {
  type RepositoryInstructions,
  type AgentInstructions,
  readingOf,
} from './instructions-model.ts'

const ROW =
  'flex min-h-control-lg min-w-0 items-center gap-4 border-b border-border px-4 py-2 last:border-b-0'

const PATH = 'w-settings-name min-w-0 shrink-0 truncate font-mono text-sm font-medium'

const FILES = 'flex min-w-0 flex-1 flex-wrap items-center gap-3'

const FILE = 'flex min-w-0 items-center gap-1.5'

const FILE_NAME = 'inline-flex h-control-sm items-center gap-1.5 px-2 text-muted-foreground'

const READERS = 'flex flex-wrap items-center gap-1'

const NONE = 'text-xs text-muted-foreground'

const NOTE = 'max-w-measure px-4 py-3 text-xs text-muted-foreground'

/** The marks of the agents that read this file of this repository by themselves. */
function Readers({
  repository,
  file,
  agents,
}: {
  repository: RepositoryInstructions
  file: string
  agents: readonly AgentInstructions[]
}): ReactNode {
  const readers = agents.filter((agent) => {
    const reading = readingOf(repository, agent)
    return reading?.by === 'agent' && reading.file === file
  })
  if (readers.length === 0) return null
  return (
    <span className={READERS}>
      {readers.map((agent) => (
        <Legend
          key={agent.id}
          label={`${agent.agent} reads ${file} of ${repository.repository} by itself`}
        >
          <span className="inline-flex" data-reader={agent.id}>
            <AgentMark id={agent.id} name={agent.agent} size="sm" />
          </span>
        </Legend>
      ))}
    </span>
  )
}

function SkeletonRow(): ReactNode {
  return (
    <li aria-hidden="true" className={ROW} data-row-skeleton="">
      <span className={PATH}>
        <Skeleton>shared</Skeleton>
      </span>
      <span className={FILES}>
        <Skeleton>CLAUDE.md AGENTS.md</Skeleton>
      </span>
    </li>
  )
}

/** A file: the button that opens it, or its name where none can be opened. */
function File({
  repository,
  file,
  onOpen,
}: {
  repository: string
  file: string
  onOpen?: ((repository: string, file: string) => void) | undefined
}): ReactNode {
  const said = (
    <>
      <IconFileText size="sm" aria-hidden="true" />
      <span className="font-mono text-xs">{file}</span>
    </>
  )
  if (onOpen === undefined) return <span className={FILE_NAME}>{said}</span>
  return (
    <Button
      size="sm"
      variant="ghost"
      aria-label={`Open ${file} of ${repository}`}
      onClick={() => onOpen(repository, file)}
    >
      {said}
    </Button>
  )
}

export interface InstructionsSectionProps {
  repositories: readonly RepositoryInstructions[]
  agents: readonly AgentInstructions[]
  loading?: boolean | undefined
  /** Opens a file of a repository; left out, each file is said by its name only. */
  onOpen?: ((repository: string, file: string) => void) | undefined
}

export function InstructionsSection({
  repositories,
  agents,
  loading = false,
  onOpen,
}: InstructionsSectionProps): ReactNode {
  const empty = !loading && repositories.every((one) => one.files.length === 0)
  return (
    <Section label="Instructions">
      <SectionHead title="Instructions" />
      <Frame>
        {empty ? (
          <Empty icon={<IconFileText size="md" />} title="No instruction file" />
        ) : (
          <>
            <ul aria-label="Instructions" aria-busy={loading} className="flex flex-col">
              {loading ? (
                <>
                  <SkeletonRow />
                  <SkeletonRow />
                  <SkeletonRow />
                </>
              ) : (
                repositories.map((repository) => (
                  <li
                    key={repository.repository}
                    className={ROW}
                    data-repository={repository.repository}
                  >
                    <span className={PATH}>{repository.repository}</span>
                    <span className={FILES}>
                      {repository.files.length === 0 ? (
                        <span className={NONE}>None</span>
                      ) : (
                        repository.files.map((file) => (
                          <span key={file} className={FILE}>
                            <File repository={repository.repository} file={file} onOpen={onOpen} />
                            <Readers repository={repository} file={file} agents={agents} />
                          </span>
                        ))
                      )}
                    </span>
                  </li>
                ))
              )}
            </ul>
            <p className={NOTE}>
              Hemera sends one of its files to the agents that read none of a repository's files by
              themselves.
            </p>
          </>
        )}
      </Frame>
    </Section>
  )
}
