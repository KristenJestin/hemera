import type { CommandRun, ContextView, Provided } from '@hemera/ipc'
import type {
  CommandPanelRun,
  ContextCommand,
  ContextEntry,
  ContextTool,
  SideColumnTab,
} from '@hemera/ui'

/**
 * What the side column of a Session draws from the tools store (design D6-10, D6-12).
 *
 * The Commands tab is the runs of the Session, the same runs the thread's blocks read; the
 * Context tab is its instructions and its tools, as the engine answered them. Both are read as
 * they came: nothing here decides what a run is or what was provided, it only says it in the
 * words the blocks take.
 *
 * Kept apart from the page, which imports the design system's components, so a test can read it
 * without a theme or a DOM.
 */

/** Where a run ran, relative to the Workspace root when it is inside it. */
function folderOf(cwd: string, root: string): string {
  const inside = cwd.replaceAll('\\', '/')
  const base = root.replaceAll('\\', '/').replace(/\/$/, '')
  if (inside === base) return '.'
  if (inside.startsWith(`${base}/`)) return inside.slice(base.length + 1)
  return cwd
}

/** The runs of a Session as the Commands panel lists them, oldest first. */
export function panelRunsOf(runs: readonly CommandRun[], root: string): CommandPanelRun[] {
  return runs.map((run) => ({
    id: run.id,
    name: run.name,
    command: run.line,
    kind: run.kind,
    state: run.state === 'exited' ? 'finished' : run.state,
    folder: folderOf(run.cwd, root),
    output: run.output,
    url: run.url ?? undefined,
    exitCode: run.exitCode ?? undefined,
    oneOff: run.commandId === null,
  }))
}

/**
 * Which of the three tabs has something to show: #40's rule, back after the trial of 23 September
 * 2026 (D6-10, D6-12).
 *
 * Activity has a plan or a file the turn touched; Commands has a run of this Session or a
 * catalogue to run from; Context has a delivery — a change of `AGENTS.md` handed to the agent
 * between two turns. The base, the file given at the start and the tools are there in every
 * Session its agent has been asked anything, so they open nothing by themselves: a column drawn
 * for them was a column drawn for every Session, on an Activity tab with nothing in it. The
 * Context view is reached from the Session's head instead, and the column opened there stays.
 */
export interface SideTabs {
  activity: boolean
  commands: boolean
  context: boolean
}

export function sideTabsOf(
  plan: number,
  files: number,
  runs: readonly CommandRun[],
  view: ContextView | null,
): SideTabs {
  return {
    activity: plan > 0 || files > 0,
    commands: runs.length > 0 || (view?.commands.length ?? 0) > 0,
    context: view?.provided.some((one) => one.kind === 'instructions') ?? false,
  }
}

/** Whether the column is drawn at all: a column whose three tabs are empty is not (#40). */
export function hasSideColumn(tabs: SideTabs): boolean {
  return tabs.activity || tabs.commands || tabs.context
}

/**
 * The tab a Session opens on, which follows what is happening in it (D6-12): a command running
 * opens on its commands, then what the agent has been doing, then whichever tab has something.
 * A column none of whose tabs has anything is one the reader opened from the head, for its
 * Context.
 */
export function openingTabOf(runs: readonly CommandRun[], tabs: SideTabs): SideColumnTab {
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

/** What the Context view draws: the lines of the instructions, the tools and the catalogue. */
export interface ContextLists {
  instructions: ContextEntry[]
  tools: ContextTool[]
  commands: ContextCommand[]
}

/**
 * The instructions of a Session in three lines (trial of 23 September 2026): how `AGENTS.md`
 * reached the agent, the last change delivered since with its time, and the base.
 *
 * Nothing is listed before anything has gone to the agent, which is a Session before its first
 * message. A Workspace without the file says so in a sentence; one whose file appeared during the
 * Session had none at its start, and its delivery is the last change. Fingerprints are left out:
 * the time of the change is what tells a reader the file moved under the Session.
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
  if (base !== undefined) lines.push({ label: 'The base', detail: REACHED[base.reached] })
  return lines
}

/** The line of `AGENTS.md` itself: how it reached the agent, or that there was none. */
function fileLineOf(file: Provided | undefined, change: Provided | undefined): ContextEntry {
  if (file !== undefined) return { label: 'AGENTS.md', detail: REACHED[file.reached] }
  if (change !== undefined) {
    return { label: 'AGENTS.md', detail: 'none at the start of the Session' }
  }
  return { label: 'This Workspace has no AGENTS.md' }
}

/** The Context view of a Session, in the words the view draws it with (D6-10). */
export function contextListsOf(view: ContextView): ContextLists {
  return {
    instructions: instructionsOf(view.provided),
    tools: view.tools.map((tool) => ({ name: tool.name, bound: tool.bound })),
    commands: view.commands.map((command) => ({ name: command.name, command: command.line })),
  }
}
