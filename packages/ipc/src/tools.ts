/**
 * What Hemera lends an agent, as the window reads it (design D6-10, D6-12).
 *
 * Two things cross here and neither is a Session's thread: the commands of a Project and the runs
 * they became, which the Commands panel and the Project settings draw; and what a Session was
 * provided, which the Context view draws. The use cases that carry them are declared with every
 * other one, in `engine.ts`; what is here is what they answer with.
 */

import { z } from 'zod'

/** What a command is for (D8-07): `serve` stays up, and the six others end with a code. */
export const commandTypeSchema = z.enum([
  'serve',
  'test',
  'lint',
  'build',
  'configure',
  'debug',
  'script',
])

export type CommandType = z.infer<typeof commandTypeSchema>

/** Where a `serve` command runs: once per Workspace, or once for the Project (D8-07). */
export const commandScopeSchema = z.enum(['workspace', 'project'])

export type CommandScope = z.infer<typeof commandScopeSchema>

/**
 * A command of a Project's catalogue (design D6-12).
 *
 * `folder` is where it runs: null for the Workspace root, or one of the Project's repositories,
 * relative to the root as the Project declares it. `lineWindows` and `lineLinux` are the lines
 * those systems run instead of `line`, null when they run it (D8-07).
 */
export const commandSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string(),
  line: z.string(),
  lineWindows: z.string().nullable(),
  lineLinux: z.string().nullable(),
  type: commandTypeSchema,
  folder: z.string().nullable(),
  scope: commandScopeSchema,
  portless: z.boolean(),
  createdAt: z.number(),
})

export type Command = z.infer<typeof commandSchema>

/** How far a run got: running, ended on its own with a code, failed, or stopped under it. */
export const runStateSchema = z.enum(['running', 'exited', 'failed', 'stopped'])

export type RunState = z.infer<typeof runStateSchema>

/**
 * A port two runs published (D8-09): the other run, in which Workspace, under which name. On the
 * run that published second it names the holder; on the holder, read among its Workspace's
 * services, it names each run that published the port after it (Decided 12).
 */
export const portConflictSchema = z.object({
  port: z.number(),
  runId: z.string(),
  workspaceId: z.string().nullable(),
  workspaceName: z.string(),
  name: z.string(),
})

export type PortConflict = z.infer<typeof portConflictSchema>

/**
 * One run of a command, as the panel and the agent both read it (design D6-12).
 *
 * `commandId` is null for a one-off line. `output` is the end of what it printed, bounded, and
 * `dropped` how many characters of the beginning were let go of. `joined` says the run asked for
 * was a server already running, handed back rather than started a second time. `sessionId` is
 * null for a run no Session asked for, a preparation's step (Decided 11). `workspaceId` is
 * the Workspace it runs in, null for `main` (D8-08); `environment` the variables it was given
 * (D8-06); `readyAt` when its address first answered and `portConflict` the run holding the port
 * it published (D8-09); `heldAgainst` the runs that published the port this one holds, filled
 * when a Workspace's services are read and empty elsewhere (Decided 12).
 */
export const commandRunSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  sessionId: z.string().nullable(),
  commandId: z.string().nullable(),
  name: z.string(),
  line: z.string(),
  type: commandTypeSchema,
  cwd: z.string(),
  workspaceId: z.string().nullable(),
  environment: z.record(z.string(), z.string()),
  state: runStateSchema,
  pid: z.number().nullable(),
  url: z.string().nullable(),
  readyAt: z.string().nullable(),
  portConflict: portConflictSchema.nullable(),
  heldAgainst: z.array(portConflictSchema),
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
 * means, `AGENTS.md` read by the agent itself or given at the start of the Session, a change as a
 * delivery prompt between two turns.
 */
export const contextReachSchema = z.enum([
  'system_prompt',
  'embedded_resource',
  'read_natively',
  'session_start',
  'delivery_prompt',
])

/** One thing a Session was provided, oldest first, as the Context view lists it. */
export const providedSchema = z.object({
  kind: z.enum(['base', 'native', 'provided', 'instructions']),
  /** The file it came from, and `''` for the base, which is not one. */
  path: z.string(),
  fingerprint: z.string(),
  deliveredAt: z.string(),
  reached: contextReachSchema,
})

export type Provided = z.infer<typeof providedSchema>

/**
 * The Context view of a Session (design D6-10).
 *
 * Provided: what went to the agent and how. Consultable: the tools offered, each with the limit
 * it is held to, and the catalogue the agent may run. What the agent keeps to itself is not the
 * Session's to say: it is said of the agent, in its settings.
 */
export const contextViewSchema = z.object({
  provided: z.array(providedSchema),
  tools: z.array(z.object({ name: z.string(), bound: z.string() })),
  commands: z.array(z.object({ name: z.string(), line: z.string() })),
})

export type ContextView = z.infer<typeof contextViewSchema>
