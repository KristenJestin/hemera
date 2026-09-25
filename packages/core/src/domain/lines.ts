/**
 * The line a run starts, and which of the lines it carries this system runs (D8-07, as amended by
 * recette 1 and by recette 2).
 *
 * A line is one line for every system, or one line per system: Windows' own, and the one Linux and
 * macOS run together. A command of the catalogue carries a line, and so does a step of a Project's
 * recipe — read exactly the same way, because a step's own line is the line of a command without
 * the command. It lives here rather than beside the catalogue so that both can read it without
 * either depending on the other.
 */

/** What a line is carried as, by a command of the catalogue and by a step of a recipe alike. */
export interface CarriedLine {
  /** The line every system runs, and the one a system with no variant of its own runs. */
  readonly line: string
  /** The line Windows runs instead; null when there is one line for all of them. */
  readonly lineWindows: string | null
  /** The line Linux runs instead; null when there is one line for all of them, macOS among them. */
  readonly lineLinux: string | null
}

/**
 * The line this system runs (D8-07): its own variant when there is one, the line every system runs
 * otherwise — which is the one a system with no variant of its own runs, macOS among them
 * (recette 2). `platform` is Node's own word for the system — `win32`, `linux`, `darwin`.
 */
export function lineFor(carried: CarriedLine, platform: string): string {
  if (platform === 'win32') return carried.lineWindows ?? carried.line
  if (platform === 'linux') return carried.lineLinux ?? carried.line
  return carried.line
}
