import { MAIN_WORKSPACE } from '@hemera/core'
import type { CommandRun, ContextView, Provided } from '@hemera/ipc'
import type {
  CommandPanelRun,
  ContextCommand,
  ContextEntry,
  ContextTool,
  ContextWorkspace,
  SessionDetailsTab,
} from '@hemera/ui'

import { runFactsOf } from './agent-tool-payloads.ts'

/**
 * What the details of a Session draw from the tools store (design D6-10, D6-12).
 *
 * The Commands tab is the runs of the Session, the same runs the thread's blocks read; the
 * Context tab is its instructions and its tools, as the engine answered them. Both are read as
 * they came: nothing here decides what a run is or what was provided, it only says it in the
 * words the blocks take.
 *
 * Kept apart from the page, which imports the design system's components, so a test can read it
 * without a theme or a DOM.
 */

/** Where a run ran, relative to the Workspace root when it is inside it and the root is known. */
function folderOf(cwd: string, root: string | null): string {
  if (root === null) return cwd
  const inside = cwd.replaceAll('\\', '/')
  const base = root.replaceAll('\\', '/').replace(/\/$/, '')
  if (inside === base) return '.'
  if (inside.startsWith(`${base}/`)) return inside.slice(base.length + 1)
  return cwd
}

/** The runs of a Session as the Commands panel lists them, oldest first. */
export function panelRunsOf(runs: readonly CommandRun[], root: string | null): CommandPanelRun[] {
  return runs.map((run) => ({
    id: run.id,
    name: run.name,
    command: run.line,
    type: run.type,
    state: run.state === 'exited' ? 'finished' : run.state,
    folder: folderOf(run.cwd, root),
    output: run.output,
    url: run.url ?? undefined,
    exitCode: run.exitCode ?? undefined,
    oneOff: run.commandId === null,
    // Its address as it stands, its variables and its conflict, as the thread's block shows them.
    ...runFactsOf(run),
  }))
}

/**
 * Which of the three tabs has something to show (D6-10, D6-12), which is what the details open on.
 *
 * Activity has a plan or a file the turn touched; Commands has a run of this Session or a
 * catalogue to run from; Context has a delivery — a change of `AGENTS.md` handed to the agent
 * between two turns. The base, the file given at the start and the tools are there in every
 * Session its agent has been asked anything, so they make no tab one to open on by themselves.
 *
 * Nothing here opens the details: they are a dialog only the reader opens, from the Session's head
 * (second review of #18). What arrives while they are open changes what a tab holds.
 */
export interface DetailsTabs {
  activity: boolean
  commands: boolean
  context: boolean
}

export function detailsTabsOf(
  plan: number,
  files: number,
  runs: readonly CommandRun[],
  view: ContextView | null,
): DetailsTabs {
  return {
    activity: plan > 0 || files > 0,
    commands: runs.length > 0 || (view?.commands.length ?? 0) > 0,
    context: view?.provided.some((one) => one.kind === 'instructions') ?? false,
  }
}

/**
 * The tab the details open on, which follows what is happening in the Session (D6-12): a command
 * running opens on its commands, then what the agent has been doing, then whichever tab has
 * something. With nothing in any tab they open on the Context, which is what the agent works from.
 */
export function openingTabOf(runs: readonly CommandRun[], tabs: DetailsTabs): SessionDetailsTab {
  if (runs.some((run) => run.state === 'running')) return 'commands'
  if (tabs.activity) return 'activity'
  if (tabs.commands) return 'commands'
  return 'context'
}

/** How a source reached the agent, in the words the Context view says it with. */
const REACHED: Record<ContextView['provided'][number]['reached'], string> = {
  system_prompt: 'through its system prompt',
  embedded_resource: 'as a resource of the first prompt',
  read_natively: 'read by the agent',
  session_start: 'given at the start of the Session',
  delivery_prompt: 'delivered between two turns',
}

/** When a source was provided, `DD Mon HH:MM`, in the one reading the whole window uses. */
function atOf(iso: string): string {
  const at = new Date(iso)
  const day = at.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
  const time = at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  return `${day} ${time}`
}

/**
 * What the Context view draws: the Workspace, the lines of the instructions, the tools with the
 * moment they were lent, and the catalogue.
 */
export interface ContextLists {
  workspace: ContextWorkspace
  instructions: ContextEntry[]
  tools: ContextTool[]
  lentAt: string | undefined
  commands: ContextCommand[]
}

/**
 * The instructions of a Session in three lines (trial of 23 September 2026): how `AGENTS.md`
 * reached the agent, the last change delivered since, and the base — each with the time it
 * reached the agent (recette 5 of 24 September 2026).
 *
 * Nothing is listed before anything has gone to the agent, which is a Session before its first
 * message. A Workspace without the file says so in a sentence; one whose file appeared during the
 * Session had none at its start, and its delivery is the last change. The file is named by its
 * path from the Workspace root, as the engine recorded it, and says when it last changed once a
 * change was delivered. Fingerprints are left out: the time of the change is what tells a reader
 * the file moved under the Session.
 */
function instructionsOf(provided: ContextView['provided']): ContextEntry[] {
  if (provided.length === 0) return []
  const file = provided.find((one) => one.kind === 'native' || one.kind === 'provided')
  const change = provided.findLast((one) => one.kind === 'instructions')
  const base = provided.find((one) => one.kind === 'base')
  const lines = [fileLineOf(file, change)]
  if (change !== undefined) {
    lines.push({
      label: 'Last change',
      detail: REACHED[change.reached],
      at: atOf(change.deliveredAt),
    })
  }
  if (base !== undefined) {
    lines.push({ label: 'The base', detail: REACHED[base.reached], at: atOf(base.deliveredAt) })
  }
  return lines
}

/** The line of `AGENTS.md` itself: its path, how and when it reached the agent, or that there was none. */
function fileLineOf(file: Provided | undefined, change: Provided | undefined): ContextEntry {
  const changed = change === undefined ? undefined : atOf(change.deliveredAt)
  if (file !== undefined) {
    return {
      label: file.path,
      file: true,
      detail: REACHED[file.reached],
      at: atOf(file.deliveredAt),
      changed,
    }
  }
  if (change !== undefined) {
    return { label: change.path, file: true, detail: 'none at the start of the Session', changed }
  }
  return { label: 'This Workspace has no AGENTS.md' }
}

/**
 * The Context view of a Session, in the words the view draws it with (D6-10).
 *
 * The Workspace is the Project's `main` one, the only one a Session runs in until lot 7, at the
 * root the page already reads its runs from. The tools were lent when the agent's session was
 * opened, which is the moment the base was recorded: the engine provides a session the instant it
 * opens it, with the tools already in its hands. Before that there is no time to give.
 */
export function contextListsOf(view: ContextView, root: string): ContextLists {
  const base = view.provided.find((one) => one.kind === 'base')
  return {
    workspace: { name: MAIN_WORKSPACE, path: root },
    instructions: instructionsOf(view.provided),
    tools: view.tools.map((tool) => ({ name: tool.name, bound: tool.bound })),
    lentAt: base === undefined ? undefined : atOf(base.deliveredAt),
    commands: view.commands.map((command) => ({ name: command.name, command: command.line })),
  }
}
