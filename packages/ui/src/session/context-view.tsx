import { cn } from 'cn'
import type { ReactNode } from 'react'

import { Disclosure } from '../activity/disclosure.tsx'
import { IconCommand, IconFileText, IconFolder } from '../icons.ts'

/**
 * What the agent is working from (design D6-10), in the two parts a reader takes in at a glance
 * (trial of 23 September 2026).
 *
 * Since the agent runs bare, its context is no longer something to guess at: Hemera puts it in
 * the prompt itself, so it can show what it put there.
 *
 * First, the Workspace the agent works in, by its name and its path: every path below is read
 * from its root.
 *
 * Instructions: how the Workspace's `AGENTS.md` reached the agent — given at the start of the
 * Session, or read by the agent itself — the last change delivered since, and the base, on one
 * line each. Every line carries the time it reached the agent, and the file its path and the time
 * it last changed under the Session (recette 5 of 24 September 2026): a context that arrived at a
 * moment is a fact about the Session and not a permanent truth, and a tab of lines with no time on
 * them read as one written once and never again.
 *
 * Tools: the tools Hemera lends, folded on one line that says how many and when they were lent,
 * each with the bound it is held to once the line is opened, and the catalogue `commands_run` runs
 * from. A tool offered with a limit is a different promise from a tool offered, so the limit is on
 * its line.
 *
 * What the agent keeps to itself is not this tab's to say: it is said of the agent, in Settings.
 * Every row reads whole at the column's width: a sentence wraps, and nothing is cut mid-word.
 */

/** One line of the instructions: what it is, how it reached the agent, and when. */
export interface ContextEntry {
  /** What it is: `AGENTS.md`, its last change, the base — or the sentence that stands for it. */
  label: string
  /** Whether the label is a file's path, relative to the Workspace root: drawn as a path is. */
  file?: boolean | undefined
  /** How it reached the agent, in words. */
  detail?: string | undefined
  /** When it reached the agent, as the Session records it. */
  at?: string | undefined
  /** When the file last changed under the Session, once a change of it was delivered. */
  changed?: string | undefined
}

/** The Workspace the agent works in: what every path of the view is read from. */
export interface ContextWorkspace {
  /** What the Project calls it: `main`. */
  name: string
  /** Its root, as the machine writes it. */
  path: string
}

/** A tool Hemera lends, with the bound it is held to. */
export interface ContextTool {
  /** The name the catalogue gives it. */
  name: string
  /** The limit it works within: a size, a number, a scope. */
  bound: string
}

/** A command the catalogue holds, which the agent may run. */
export interface ContextCommand {
  /** The name the Project gave it. */
  name: string
  /** The line it runs. */
  command: string
}

export interface ContextViewProps {
  /** The Workspace the agent works in, drawn first; left out, the view starts on its instructions. */
  workspace?: ContextWorkspace | undefined
  /**
   * The lines of the instructions, in the order they are read: the file, its last change, the
   * base. Empty while nothing has gone to the agent yet.
   */
  instructions: readonly ContextEntry[]
  /** The tools it lends it. */
  tools: readonly ContextTool[]
  /** When they were lent: the moment the agent's session was opened with them. */
  lentAt?: string | undefined
  /** The commands of the catalogue it may run. */
  commands: readonly ContextCommand[]
  /** Where the view sits; never how it looks. */
  className?: string | undefined
}

const VIEW = 'flex w-full min-w-0 flex-col gap-3'

const GROUP = 'flex flex-col gap-1'

/** The head of a part, laid like the line of a fold so the two parts start on one edge. */
const HEAD = 'flex items-center gap-2 px-1 py-0.5'

const MARK = 'flex shrink-0 text-muted-foreground'

const TITLE = 'text-sm text-foreground'

/** The rows under a head, indented like the body of a fold. */
const LIST = 'flex flex-col gap-1 pl-8'

/** A row, which wraps where the column ends and breaks a word only when it is wider than it. */
const ROW = 'text-sm break-words'

const LABEL = 'text-foreground'

/** A label that is a file's path, in the face a path is read in. */
const FILE = 'font-mono text-foreground'

const DETAIL = 'text-muted-foreground'

/** The root of the Workspace: a path, which breaks anywhere rather than off the column. */
const ROOT = 'min-w-0 font-mono text-xs break-all text-muted-foreground'

const NAME = 'font-mono text-foreground'

/** The catalogue under the tools: a heading of its own, quieter than the parts. */
const CATALOGUE = 'pt-2 text-xs text-muted-foreground'

/** What the instructions say while nothing has gone to the agent. */
const NOTHING = 'pl-8 text-sm text-muted-foreground'

export function ContextView({
  workspace,
  instructions,
  tools,
  lentAt,
  commands,
  className,
}: ContextViewProps): ReactNode {
  return (
    <div className={cn(VIEW, className)}>
      {workspace !== undefined && (
        <section className={HEAD} aria-label="Workspace">
          <span aria-hidden="true" className={MARK}>
            <IconFolder size="sm" />
          </span>
          <span className={TITLE}>{workspace.name}</span>
          <span className={ROOT}>{workspace.path}</span>
        </section>
      )}
      <section className={GROUP} aria-label="Instructions">
        <div className={HEAD}>
          <span aria-hidden="true" className={MARK}>
            <IconFileText size="sm" />
          </span>
          <span className={TITLE}>Instructions</span>
        </div>
        {instructions.length === 0 ? (
          <p className={NOTHING}>Nothing has gone to the agent yet.</p>
        ) : (
          <ul className={LIST}>
            {instructions.map((entry) => (
              <li key={entry.label} className={ROW}>
                <span className={entry.file === true ? FILE : LABEL}>{entry.label}</span>
                {entry.detail !== undefined && (
                  <span className={DETAIL}>{`, ${entry.detail}`}</span>
                )}
                {entry.at !== undefined && <span className={DETAIL}>{` · ${entry.at}`}</span>}
                {entry.changed !== undefined && (
                  <span className={DETAIL}>{` · changed ${entry.changed}`}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      {/* Folded by default: the count is what a reader checks, and the list is there when
          asked. */}
      <Disclosure
        summary={
          <span className="flex min-w-0 items-center gap-2">
            <span aria-hidden="true" className={MARK}>
              <IconCommand size="sm" />
            </span>
            <span className={TITLE}>
              {lentAt === undefined
                ? `Tools · ${tools.length}`
                : `Tools · ${tools.length} · lent at ${lentAt}`}
            </span>
          </span>
        }
      >
        {tools.length + commands.length === 0 ? undefined : (
          <>
            <ul className={GROUP}>
              {tools.map((tool) => (
                <li key={tool.name} className={ROW}>
                  <span className={NAME}>{tool.name}</span>
                  <span className={DETAIL}>{` ${tool.bound}`}</span>
                </li>
              ))}
            </ul>
            {commands.length > 0 && (
              <>
                <p className={CATALOGUE}>The catalogue commands_run runs from</p>
                <ul className={GROUP}>
                  {commands.map((command) => (
                    <li key={command.name} className={ROW}>
                      <span className={NAME}>{command.name}</span>
                      <span className={DETAIL}>{` ${command.command}`}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </Disclosure>
    </div>
  )
}
