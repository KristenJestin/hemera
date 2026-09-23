/**
 * What Hemera lends an agent, as the window reads it (design D6-10, D6-12).
 *
 * Two things cross here and neither is a Session's thread: the commands of a Project and the runs
 * they became, which the Commands panel and the Project settings draw; and what a Session was
 * provided, which the Context view draws. The use cases that carry them are declared with every
 * other one, in `engine.ts`; what is here is what they answer with.
 */

import { z } from 'zod'

/** What a command is for: an app stays up, a check ends with a code, a utility is the rest. */
export const commandKindSchema = z.enum(['app', 'check', 'utility'])

export type CommandKind = z.infer<typeof commandKindSchema>

/**
 * A command of a Project's catalogue (design D6-12).
 *
 * `folder` is where it runs: null for the Workspace root, or one of the Project's repositories,
 * relative to the root as the Project declares it.
 */
export const commandSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string(),
  line: z.string(),
  kind: commandKindSchema,
  folder: z.string().nullable(),
  createdAt: z.number(),
})

export type Command = z.infer<typeof commandSchema>

/** How far a run got: running, ended on its own with a code, failed, or stopped under it. */
export const runStateSchema = z.enum(['running', 'exited', 'failed', 'stopped'])

export type RunState = z.infer<typeof runStateSchema>

/**
 * One run of a command, as the panel and the agent both read it (design D6-12).
 *
 * `commandId` is null for a one-off line. `output` is the end of what it printed, bounded, and
 * `dropped` how many characters of the beginning were let go of. `joined` says the run asked for
 * was an app already running, handed back rather than started a second time.
 */
export const commandRunSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  sessionId: z.string(),
  commandId: z.string().nullable(),
  name: z.string(),
  line: z.string(),
  kind: commandKindSchema,
  cwd: z.string(),
  state: runStateSchema,
  pid: z.number().nullable(),
  url: z.string().nullable(),
  exitCode: z.number().nullable(),
  output: z.string(),
  dropped: z.number(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  joined: z.boolean(),
})

export type CommandRun = z.infer<typeof commandRunSchema>

/**
 * How something provided reached the agent (design D6-07, D6-10): the base by the agent's own
 * means, `AGENTS.md` read by the agent itself, a change as a delivery prompt between two turns.
 */
export const contextReachSchema = z.enum([
  'system_prompt',
  'embedded_resource',
  'read_natively',
  'delivery_prompt',
])

/** One thing a Session was provided, oldest first, as the Context view lists it. */
export const providedSchema = z.object({
  kind: z.enum(['base', 'native', 'instructions']),
  /** The file it came from, and `''` for the base, which is not one. */
  path: z.string(),
  fingerprint: z.string(),
  deliveredAt: z.string(),
  reached: contextReachSchema,
})

export type Provided = z.infer<typeof providedSchema>

/**
 * The three lists of the Context view (design D6-10).
 *
 * Provided: what went to the agent and how. Consultable: the tools offered, each with the limit
 * it is held to, and the catalogue the agent may run. Private: one sentence about what the
 * Session's agent keeps that Hemera does not see — nothing about what the model retained.
 */
export const contextViewSchema = z.object({
  provided: z.array(providedSchema),
  tools: z.array(z.object({ name: z.string(), bound: z.string() })),
  commands: z.array(z.object({ name: z.string(), line: z.string() })),
  private: z.array(z.object({ agent: z.string(), sentence: z.string() })),
})

export type ContextView = z.infer<typeof contextViewSchema>
