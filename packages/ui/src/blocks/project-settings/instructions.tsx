import { cn } from 'cn'
import type { ReactNode } from 'react'

import { Button } from '../../components/button/button.tsx'
import { Empty } from '../../components/empty/empty.tsx'
import { Frame } from '../../components/frame/frame.tsx'
import { Skeleton } from '../../components/loading/loading.tsx'
import { SectionHead } from '../../components/section-head/section-head.tsx'
import { Legend } from '../../components/tooltip/legend.tsx'
import { IconBook2, IconFileText, IconSend } from '../../icons.ts'
import { Section } from './parts.tsx'

/**
 * The Project's layer of instructions: what each repository tells the agents that work in it.
 *
 * A table, one row per repository: its path, the instruction files it holds — `CLAUDE.md`,
 * `AGENTS.md` — each a button that opens the file, and one column per agent saying how that agent
 * gets them: it reads one by itself (a book), or Hemera sends it the file (a paper plane), each
 * glyph with its legend. A repository with no file leaves the agents' columns empty: there is
 * nothing to read. Nothing here is written: the files are the repository's.
 */
export interface RepositoryInstructions {
  /** Its path in the main checkout. */
  repository: string
  /** The instruction files found at its root. */
  files: readonly string[]
}

export interface AgentInstructions {
  agent: string
  /** The instruction files the agent reads by itself, in its order of preference. */
  reads: readonly string[]
}

/** How an agent gets a repository's instructions: the file and who brings it, or nothing. */
export type Reading =
  | { readonly by: 'agent'; readonly file: string }
  | { readonly by: 'hemera'; readonly file: string }
  | null

/** Whether an agent reads a file of the repository by itself, else what Hemera sends it. */
export function readingOf(repository: RepositoryInstructions, agent: AgentInstructions): Reading {
  const own = agent.reads.find((file) => repository.files.includes(file))
  if (own !== undefined) return { by: 'agent', file: own }
  const sent = repository.files[0]
  return sent === undefined ? null : { by: 'hemera', file: sent }
}

/** A file said by its name: the room a small button would take, so the rows keep their height. */
const FILE_NAME = 'inline-flex h-control-sm items-center gap-1.5 px-2 text-muted-foreground'

const TABLE = 'w-full table-fixed border-collapse text-sm'

const HEAD =
  'h-control-sm border-b border-border px-4 text-left text-xs font-normal text-muted-foreground'

const AGENT_HEAD =
  'h-control-sm w-24 border-b border-border px-2 text-center text-xs font-normal text-muted-foreground'

const ROW = 'border-b border-border last:border-b-0'

const PATH_CELL = 'h-control-lg px-4 font-mono text-sm font-medium'

const FILES_CELL = 'h-control-lg px-4'

const AGENT_CELL = 'h-control-lg px-2 text-center'

const FILES = 'flex min-w-0 flex-wrap items-center gap-1'

const NONE = 'text-xs text-muted-foreground'

function ReadingMark({
  reading,
  repository,
  agent,
}: {
  reading: Reading
  repository: string
  agent: string
}): ReactNode {
  if (reading === null) return null
  const label =
    reading.by === 'agent'
      ? `${agent} reads ${reading.file} of ${repository} by itself`
      : `Hemera sends ${reading.file} of ${repository} to ${agent}`
  return (
    <Legend label={label}>
      <span
        className="inline-flex text-muted-foreground"
        aria-hidden="true"
        data-reading={reading.by}
      >
        {reading.by === 'agent' ? <IconBook2 size="sm" /> : <IconSend size="sm" />}
      </span>
    </Legend>
  )
}

function SkeletonRow({ agents }: { agents: number }): ReactNode {
  return (
    <tr aria-hidden="true" className={ROW} data-row-skeleton="">
      <td className={PATH_CELL}>
        <Skeleton>shared</Skeleton>
      </td>
      <td className={FILES_CELL}>
        <Skeleton>CLAUDE.md AGENTS.md</Skeleton>
      </td>
      {Array.from({ length: agents }, (_, at) => (
        <td key={at} className={AGENT_CELL}>
          <Skeleton shape="block">
            <IconBook2 size="sm" />
          </Skeleton>
        </td>
      ))}
    </tr>
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
          <table aria-label="Instructions" aria-busy={loading} className={TABLE}>
            <thead>
              <tr>
                <th scope="col" className={cn(HEAD, 'w-settings-name')}>
                  Repository
                </th>
                <th scope="col" className={HEAD}>
                  Files
                </th>
                {agents.map((agent) => (
                  <th key={agent.agent} scope="col" className={AGENT_HEAD}>
                    {agent.agent}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <>
                  <SkeletonRow agents={agents.length} />
                  <SkeletonRow agents={agents.length} />
                  <SkeletonRow agents={agents.length} />
                </>
              ) : (
                repositories.map((repository) => (
                  <tr key={repository.repository} className={ROW}>
                    <th scope="row" className={PATH_CELL}>
                      <span className="block truncate text-left">{repository.repository}</span>
                    </th>
                    <td className={FILES_CELL}>
                      {repository.files.length === 0 ? (
                        <span className={NONE}>None</span>
                      ) : (
                        <span className={FILES}>
                          {repository.files.map((file) =>
                            onOpen === undefined ? (
                              <span key={file} className={FILE_NAME}>
                                <IconFileText size="sm" aria-hidden="true" />
                                <span className="font-mono text-xs">{file}</span>
                              </span>
                            ) : (
                              <Button
                                key={file}
                                size="sm"
                                variant="ghost"
                                aria-label={`Open ${file} of ${repository.repository}`}
                                onClick={() => onOpen(repository.repository, file)}
                              >
                                <IconFileText size="sm" aria-hidden="true" />
                                <span className="font-mono text-xs">{file}</span>
                              </Button>
                            ),
                          )}
                        </span>
                      )}
                    </td>
                    {agents.map((agent) => (
                      <td key={agent.agent} className={AGENT_CELL}>
                        <ReadingMark
                          reading={readingOf(repository, agent)}
                          repository={repository.repository}
                          agent={agent.agent}
                        />
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </Frame>
    </Section>
  )
}
