/**
 * The port a `run` step of the preparation recipe goes through.
 *
 * Declared here, implemented by the command catalogue: its runs, its process supervisor, and its
 * "ask before running" rule, under which a step whose catalogue command is marked so waits for the
 * user's permission instead of running. The runner never goes through the agents' permission gate:
 * a recipe step is Hemera's own action, by a rule the user recorded.
 */

import { Context, Effect, Layer, Schema } from 'effect'

/** One `run` step, as it is handed over: what it runs, where, and with which variables. */
export interface RecipeRun {
  readonly projectId: string
  readonly workspaceId: string
  /** The catalogue command it starts, or null for a line of its own. */
  readonly commandId: string | null
  /** The line it runs, its template names filled, or null for a catalogue command. */
  readonly line: string | null
  /** The folder it runs in, absolute. */
  readonly folder: string
  /**
   * The Project's variables with the Workspace's over them, their template names filled: what the
   * runner sets over the process's own environment.
   */
  readonly variables: Readonly<Record<string, string>>
}

/** How a run ended: its exit code (null when it had none) and what it printed. */
export interface RecipeRunOutcome {
  readonly exitCode: number | null
  readonly output: string
}

/** The runner would not run the step: a command unknown, a permission the user denied. */
export class RecipeRunRefused extends Schema.TaggedError<RecipeRunRefused>()('RecipeRunRefused', {
  reason: Schema.String,
}) {}

export class RecipeRunner extends Context.Service<
  RecipeRunner,
  {
    /** Runs the step until it ends, and answers how it ended. */
    readonly run: (run: RecipeRun) => Effect.Effect<RecipeRunOutcome, RecipeRunRefused>
  }
>()('RecipeRunner') {}

/** The runner until the command catalogue brings the real one: every run step is refused. */
export const noRecipeRunner = Layer.succeed(RecipeRunner, {
  run: () =>
    Effect.fail(new RecipeRunRefused({ reason: 'this version of Hemera runs no command yet' })),
})
