/**
 * The launch of a Spec's build as the window reads it, and the use cases that carry it (D8-12,
 * D8-13).
 *
 * States and names come from `packages/core/src/domain/workspace.ts`, repeated here because `ipc`
 * depends on `zod` alone: the domain does not depend on `ipc` and `ipc` does not depend on the
 * domain. The use cases are declared with every other one, in `engine.ts`; what is here is what
 * they answer with.
 */

import { z } from 'zod'

/** Where a launch of a Spec stands (D8-13). */
export const launchStateSchema = z.enum(['waiting', 'starting', 'started', 'failed', 'cancelled'])

export type LaunchState = z.infer<typeof launchStateSchema>

/**
 * A Workspace named by what it is called: the one a Spec is set on, the ones a build of it may be
 * started in. Nothing else of it crosses — a launch is not a Workspace.
 */
export const launchWorkspaceSchema = z.object({ id: z.string(), name: z.string() })

export type LaunchWorkspace = z.infer<typeof launchWorkspaceSchema>

/**
 * The launch of a Spec as the panel reads it (D8-13), or null while none has been asked for.
 *
 * A launch is kept after the Workspace it named is cleaned up, and the column remembers none
 * then; what refused it, or took it back, is `detail`.
 */
export const launchSchema = z.object({
  id: z.string(),
  specId: z.string(),
  revisionId: z.string(),
  /** The Workspace the build runs in; null once that Workspace is gone. */
  workspaceId: z.string().nullable(),
  state: launchStateSchema,
  /** The build Session, once one was started. */
  sessionId: z.string().nullable(),
  /** What refused it or took it back, as it was said; null while nothing did (D8-13). */
  detail: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type Launch = z.infer<typeof launchSchema>

/**
 * What the Spec's panel is drawn from, read whole (D8-12): the launch asked for last, the
 * Workspace the Spec is set on, the ones a build of it may be started in, and — while a launch
 * waits — the preparation step its Workspace is running. One read, so the four cannot be drawn
 * apart; with `launch` null, nothing has been asked for yet.
 */
export const specLaunchesSchema = z.object({
  launch: launchSchema.nullable(),
  /** The Workspace the Spec is set on (D8-12); null while it has none. */
  workspace: launchWorkspaceSchema.nullable(),
  /** `main`, which every Project has, first, then the Workspaces made by hand. */
  workspaces: z.array(launchWorkspaceSchema),
  /** The step running while it waits, as the Workspace names it (D8-05). */
  step: z.string().nullable(),
})

export type SpecLaunches = z.infer<typeof specLaunchesSchema>

/**
 * The launch use cases of the process that holds the database, spread into `ENGINE_REQUESTS`.
 *
 * `request` names the Workspace it is asked in; `start` asks for a build in the Workspace the Spec
 * is already set on (D8-12) and refuses while it has none; `retry` starts a refused one again.
 * Every one of them answers the launch as it stands.
 */
export const LAUNCH_REQUESTS = {
  'launches.forSpec': {
    arguments: z.object({ specId: z.string() }),
    response: specLaunchesSchema,
  },
  'launches.request': {
    arguments: z.object({ specId: z.string(), workspaceId: z.string() }),
    response: launchSchema,
  },
  'launches.start': {
    arguments: z.object({ specId: z.string() }),
    response: launchSchema,
  },
  'launches.retry': {
    arguments: z.object({ launchId: z.string() }),
    response: launchSchema,
  },
} as const
