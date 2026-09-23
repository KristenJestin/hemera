import type { CommandRun, ContextView } from '@hemera/ipc'
import type {
  CommandPanelRun,
  ContextAgent,
  ContextCommand,
  ContextEntry,
  ContextTool,
  SideColumnTab,
} from '@hemera/ui'

/**
 * What the side column of a Session draws from the tools store (design D6-10, D6-12).
 *
 * The Commands tab is the runs of the Session, the same runs the thread's blocks read; the
 * Context tab is the three lists the engine answered. Both are read as they came: nothing here
 * decides what a run is or what was provided, it only says it in the words the blocks take.
 *
 * Kept apart from the page, which imports the design system's components, so a test can read it
 * without a theme or a DOM.
 */

/** How many characters of a fingerprint are shown, enough to tell two apart at a glance. */
const FINGERPRINT_CHARACTERS = 12

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
 * Which of the three tabs has something to show (review of #40, defect 3; D6-10, D6-12).
 *
 * Activity has a plan or a file the turn touched; Commands has a run of this Session or a
 * catalogue to run from; Context has whatever its three lists hold once the engine has said it —
 * a source beyond the base, and in every case the tools the Session is offered and what the agent
 * keeps private (D6-10). A Workspace without `AGENTS.md` still has those to read, and the tab is
 * where they are read: a Session whose context is not known yet has no column for it.
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
    context:
      view !== null &&
      (view.provided.some((one) => one.kind !== 'base') ||
        view.tools.length > 0 ||
        view.private.length > 0),
  }
}

/** Whether the column is drawn at all: a column whose three tabs are empty is not (#40). */
export function hasSideColumn(tabs: SideTabs): boolean {
  return tabs.activity || tabs.commands || tabs.context
}

/**
 * The tab a Session opens on, which follows what is happening in it (D6-12): a command running
 * opens on its commands, then what the agent has been doing, then whichever tab has something.
 */
export function openingTabOf(runs: readonly CommandRun[], tabs: SideTabs): SideColumnTab {
  if (runs.some((run) => run.state === 'running')) return 'commands'
  if (tabs.activity) return 'activity'
  if (tabs.commands) return 'commands'
  if (tabs.context) return 'context'
  return 'activity'
}

/** How a source reached the agent, in the words the Context view says it with. */
const REACHED: Record<ContextView['provided'][number]['reached'], string> = {
  system_prompt: 'through its system prompt',
  embedded_resource: 'as a resource of the first prompt',
  read_natively: 'read by the agent itself',
  delivery_prompt: 'delivered between two turns',
}

/** Which of the view's three kinds a source is listed under: the base, the file, a delivery. */
const LISTED_AS: Record<ContextView['provided'][number]['kind'], ContextEntry['kind']> = {
  base: 'base',
  native: 'file',
  instructions: 'delivery',
}

/** When a source was provided, `DD Mon HH:MM`, in the one reading the whole window uses. */
function atOf(iso: string): string {
  const at = new Date(iso)
  const day = at.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
  const time = at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  return `${day} ${time}`
}

/** The three lists of the Context view, as the block takes them. */
export interface ContextLists {
  provided: ContextEntry[]
  tools: ContextTool[]
  commands: ContextCommand[]
  agents: ContextAgent[]
}

/** The three lists of the Context view, in the words the view draws them with (D6-10). */
export function contextListsOf(view: ContextView): ContextLists {
  return {
    // In the order it went in: the base, the file as read at the start, then every delivery.
    provided: view.provided.map((one) => ({
      kind: LISTED_AS[one.kind],
      label: one.kind === 'base' ? 'The base' : one.path,
      detail: `${REACHED[one.reached]} · ${one.fingerprint.slice(0, FINGERPRINT_CHARACTERS)}`,
      at: atOf(one.deliveredAt),
    })),
    tools: view.tools.map((tool) => ({ name: tool.name, bound: tool.bound })),
    commands: view.commands.map((command) => ({ name: command.name, command: command.line })),
    agents: view.private.map((one) => ({ name: one.agent, sentence: one.sentence })),
  }
}
