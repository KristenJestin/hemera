/**
 * The Project's layer of instructions: what each repository tells the agents that work in it.
 *
 * A line per repository: its path, then the instruction files it holds — `CLAUDE.md`,
 * `AGENTS.md` — each a button that opens the file, and on each file the marks of the agents that
 * read it by themselves, each with its legend. One sentence under the list says the rest: Hemera
 * sends one of a repository's files to the agents that read none of them. The width never follows
 * how many agents there are, so it stays readable whatever their number. A repository with no file
 * says so. Nothing
 * here is written: the files are the repository's.
 */
export interface RepositoryInstructions {
  /** Its path in the main checkout. */
  repository: string
  /** The instruction files found at its root. */
  files: readonly string[]
}

export interface AgentInstructions {
  /** The id its mark is looked up by. */
  id: string
  agent: string
  /** The instruction files the agent reads by itself, in its order of preference. */
  reads: readonly string[]
}

/** Whether an agent reads a file of the repository by itself, else what Hemera sends it. */
export type Reading =
  | { readonly by: 'agent'; readonly file: string }
  | { readonly by: 'hemera'; readonly file: string }
  | null

export function readingOf(repository: RepositoryInstructions, agent: AgentInstructions): Reading {
  const files = new Set(repository.files)
  const own = agent.reads.find((file) => files.has(file))
  if (own !== undefined) return { by: 'agent', file: own }
  const sent = repository.files[0]
  return sent === undefined ? null : { by: 'hemera', file: sent }
}
