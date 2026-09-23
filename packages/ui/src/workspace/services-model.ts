/**
 * What the variables, the services and the runs of a Workspace are handed (D8-06, D8-08).
 *
 * The design system's own shapes, not the domain's: plain data the application maps the engine's
 * rows onto, and nothing here decides anything.
 */

/**
 * One environment variable, as the Project or a Workspace sets it (D8-06).
 *
 * A Workspace shows its own lines and the Project's lines that still apply to it, because what a
 * run receives is both: the Project's values, overridden by the Workspace's.
 */
export interface VariableLine {
  readonly key: string
  readonly value: string
  /** On a Workspace: the Project's value this one overrides, when it does. */
  readonly overrides?: string | undefined
  /** On a Workspace: true for a Project variable shown here because it applies, not set on the Workspace. */
  readonly inherited?: boolean | undefined
}
