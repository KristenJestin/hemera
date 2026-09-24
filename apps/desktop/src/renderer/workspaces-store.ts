import type {
  ChannelArguments,
  CommandRun,
  EngineEvent,
  RecipeStep,
  RepositoryState,
  Variable,
  Workspace,
  WorkspaceStep,
} from '@hemera/ipc'

/**
 * The Workspaces of the Project whose settings are open, and the one of them shown (D8-02, D8-05,
 * D8-06, D8-08, D8-14, D8-15).
 *
 * Per Project: its Workspaces, its recipe and its own variables. Per Workspace shown — one at a
 * time, under the list — what Git says of each repository, its steps, its variables and its
 * services. Git's answer is read when the Workspace is shown and again when asked, and is never
 * held as the truth of anything: the next reading replaces it (D8-15).
 *
 * The engine pushes what changes. A `workspace` event is a Workspace or its steps that moved: the
 * list of its Project is read again, and when it is the one shown, its steps and its Git state
 * too. A `run` event is a run that moved: when it is one of the shown Workspace's services, or
 * changes what they are — a new one, one ended, a conflict it names — they are read again; a run
 * no Session asked for is a preparation's step, and its end moves the steps (Decided 11).
 *
 * Nothing is decided here: a list is what the engine answered, and a refusal is its sentence.
 */
export interface ShownWorkspace {
  readonly projectId: string
  readonly workspaceId: string
  /** Whether it is `main`, whose services are asked for as `main`'s (D8-08). */
  readonly main: boolean
  /** What Git answered when last asked, and null while it is being asked (D8-15). */
  readonly status: readonly RepositoryState[] | null
  readonly steps: readonly WorkspaceStep[]
  /** Its own variables, over the Project's (D8-06). */
  readonly variables: readonly Variable[]
  /** Its running `serve` runs, whoever started them, with their holders' sides (D8-08). */
  readonly services: readonly CommandRun[]
  /**
   * The run whose details are shown — one of its services, or the run a step of its preparation
   * started — as last answered or pushed; null when none is.
   */
  readonly run: CommandRun | null
}

export interface WorkspacesState {
  /** The Workspaces of each Project read, as the engine listed them. */
  workspaces: ReadonlyMap<string, readonly Workspace[]>
  /** The recipe of each Project read, in its order (D8-05). */
  recipes: ReadonlyMap<string, readonly RecipeStep[]>
  /** The variables of each Project read, its own scope (D8-06). */
  variables: ReadonlyMap<string, readonly Variable[]>
  shown: ShownWorkspace | null
  /** What the last act was refused with, in the engine's own words, or null. */
  refusal: string | null
}

const EMPTY: WorkspacesState = {
  workspaces: new Map(),
  recipes: new Map(),
  variables: new Map(),
  shown: null,
  refusal: null,
}

const listeners = new Set<() => void>()

let state: WorkspacesState = EMPTY

/** Whether the engine is being listened to, so two pages never subscribe twice. */
let listening = false

export function subscribeToWorkspaces(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function workspacesSnapshot(): WorkspacesState {
  return state
}

function replace(next: WorkspacesState): void {
  state = next
  for (const listener of listeners) listener()
}

/** What a refusal says, without the shape of whatever carried it. */
function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

/**
 * Keeps what the engine refused, for the page to say (`role="alert"`) until the next act: a read
 * that failed, or an act whose card has no place of its own for a refusal.
 */
function refused(cause: unknown): string {
  const said = message(cause)
  replace({ ...state, refusal: said })
  return said
}

/** A map with one key set, which is how every list here is replaced. */
function withKey<V>(map: ReadonlyMap<string, V>, key: string, value: V): ReadonlyMap<string, V> {
  const next = new Map(map)
  next.set(key, value)
  return next
}

/** How many questions were asked of the engine about a Workspace shown, all kinds together. */
let questions = 0

/** Per question — its Git state, its steps, its services — the newest answer written. */
const answered = new Map<string, number>()

/** Numbers a question as it is asked: a later question is a larger number. */
function asking(): number {
  questions += 1
  return questions
}

/**
 * Whether the answer to question number `asked` about `what` is newer than the one on screen.
 *
 * Every `workspace` event asks again, and answers do not come back in the order they were asked:
 * a slow answer to an older question, landing last, would draw what was true before. So an
 * answer is written only when it answers a later question than the one already written.
 */
function newest(what: string, asked: number): boolean {
  if (asked <= (answered.get(what) ?? 0)) return false
  answered.set(what, asked)
  return true
}

/** How much a run has printed altogether, which only grows while it runs. */
function printed(run: CommandRun): number {
  return run.dropped + run.output.length
}

/**
 * A service as the list reads it again, against the one a push already put there (D8-08).
 *
 * The list was asked before the push arrived, so what it answers of a run can be older than what
 * was pushed of it since: the push is kept when it has printed more, or answered where the list
 * says it has not yet. The holder's side is the list's, which a push never carries (Decided 12).
 */
function fresherOf(read: CommandRun, held: CommandRun | undefined): CommandRun {
  if (held === undefined) return read
  const newer = printed(held) > printed(read) || (held.readyAt !== null && read.readyAt === null)
  return newer ? { ...held, heldAgainst: read.heldAgainst } : read
}

/**
 * Changes the Workspace shown, when it is still `workspaceId`: an answer about one the reader has
 * moved off since is dropped rather than drawn over the one on screen.
 */
function onShown(workspaceId: string, change: (shown: ShownWorkspace) => ShownWorkspace): void {
  if (state.shown?.workspaceId !== workspaceId) return
  replace({ ...state, shown: change(state.shown) })
}

/** The Workspaces of a Project, `main` first; none until they were read. */
export function workspacesOf(projectId: string | null): readonly Workspace[] {
  if (projectId === null) return []
  return state.workspaces.get(projectId) ?? []
}

export async function readWorkspaces(projectId: string): Promise<void> {
  try {
    const listed = await window.hemera.invoke('workspaces.list', { projectId })
    replace({ ...state, workspaces: withKey(state.workspaces, projectId, listed) })
  } catch (cause) {
    refused(cause)
  }
}

/** The recipe of a Project, in its order; empty until it was read. */
export function recipeOf(projectId: string | null): readonly RecipeStep[] {
  if (projectId === null) return []
  return state.recipes.get(projectId) ?? []
}

export async function readRecipe(projectId: string): Promise<void> {
  try {
    const read = await window.hemera.invoke('recipe.list', { projectId })
    replace({ ...state, recipes: withKey(state.recipes, projectId, read) })
  } catch (cause) {
    refused(cause)
  }
}

/** The Project's own variables; empty until they were read. */
export function projectVariablesOf(projectId: string | null): readonly Variable[] {
  if (projectId === null) return []
  return state.variables.get(projectId) ?? []
}

/**
 * Reads the Project's own variables. Like every reading here, an answer lands only over an older
 * one: the settings opening and an edit both read them, and the opening's answer arriving last
 * would put back the value the edit had just replaced (recette 1, item 10).
 */
export async function readProjectVariables(projectId: string): Promise<void> {
  const asked = asking()
  try {
    const read = await window.hemera.invoke('variables.list', { projectId, workspaceId: null })
    if (!newest(`variables:${projectId}`, asked)) return
    replace({ ...state, variables: withKey(state.variables, projectId, read) })
  } catch (cause) {
    refused(cause)
  }
}

/**
 * Creates a Workspace on a folder the user picked, `ready` at once (D8-02), named after the
 * folder unless it is given a name.
 *
 * Answers the engine's sentence when it refuses — a name taken, a folder that is not one — and
 * null once the list was read again.
 */
export async function createOnFolder(
  projectId: string,
  path: string,
  name?: string,
): Promise<string | null> {
  forgetWorkspacesRefusal()
  try {
    await window.hemera.invoke(
      'workspaces.createOnFolder',
      name === undefined ? { projectId, path } : { projectId, path, name },
    )
    await readWorkspaces(projectId)
    return null
  } catch (cause) {
    return message(cause)
  }
}

/**
 * Cleans a dedicated Workspace up (D8-14): answers the refusal as the engine said it — a service
 * still running, Git refusing — and null once the list was read again.
 */
export async function cleanUp(projectId: string, workspaceId: string): Promise<string | null> {
  forgetWorkspacesRefusal()
  try {
    await window.hemera.invoke('workspaces.cleanup', { id: workspaceId })
    await readWorkspaces(projectId)
    return null
  } catch (cause) {
    return message(cause)
  }
}

/**
 * Shows one Workspace under the list, or none: what was read of the previous one goes, and what
 * this one is — Git, steps, variables, services — is read now.
 */
export async function showWorkspace(workspace: Workspace | null): Promise<void> {
  forgetWorkspacesRefusal()
  if (workspace === null) {
    replace({ ...state, shown: null })
    return
  }
  replace({
    ...state,
    shown: {
      projectId: workspace.projectId,
      workspaceId: workspace.id,
      main: workspace.main,
      status: null,
      steps: [],
      variables: [],
      services: [],
      run: null,
    },
  })
  await Promise.all([
    // A cleaned-up Workspace has no folder left for Git to be asked about (D8-14).
    workspace.state === 'cleaned' ? Promise.resolve() : readStatus(workspace.id),
    readSteps(workspace.id),
    readWorkspaceVariables(workspace.id),
    readServices(workspace.id),
  ])
}

/** Asks Git about each repository of the Workspace shown, now (D8-15). */
export async function readStatus(workspaceId: string): Promise<void> {
  const asked = asking()
  try {
    const status = await window.hemera.invoke('workspaces.status', { id: workspaceId })
    if (!newest(`status:${workspaceId}`, asked)) return
    onShown(workspaceId, (shown) => ({ ...shown, status }))
  } catch (cause) {
    refused(cause)
  }
}

async function readSteps(workspaceId: string): Promise<void> {
  const asked = asking()
  try {
    const steps = await window.hemera.invoke('preparation.steps', { workspaceId })
    if (!newest(`steps:${workspaceId}`, asked)) return
    onShown(workspaceId, (shown) => ({ ...shown, steps }))
  } catch (cause) {
    refused(cause)
  }
}

/**
 * Reads the variables of the Workspace shown. The showing reads them and so does every edit: an
 * older answer never lands over a newer one, or the showing's reading, arriving after an edit's,
 * would put the old value back on screen (recette 1, item 10).
 */
async function readWorkspaceVariables(workspaceId: string): Promise<void> {
  const projectId = state.shown?.projectId
  if (projectId === undefined) return
  const asked = asking()
  try {
    const variables = await window.hemera.invoke('variables.list', { projectId, workspaceId })
    if (!newest(`variables:${workspaceId}`, asked)) return
    onShown(workspaceId, (shown) => ({ ...shown, variables }))
  } catch (cause) {
    refused(cause)
  }
}

async function readServices(workspaceId: string): Promise<void> {
  const shown = state.shown
  if (shown === null) return
  const asked = asking()
  try {
    const services = await window.hemera.invoke('commands.services', {
      projectId: shown.projectId,
      // `main`'s services are asked for as `main`'s, whichever row its runs were written with.
      workspaceId: shown.main ? null : workspaceId,
    })
    if (!newest(`services:${workspaceId}`, asked)) return
    onShown(workspaceId, (now) => ({
      ...now,
      services: services.map((one) =>
        fresherOf(
          one,
          now.services.find((held) => held.id === one.id),
        ),
      ),
    }))
  } catch (cause) {
    refused(cause)
  }
}

/**
 * Resumes the preparation of a Workspace (D8-05): the engine answers the steps as they stand at
 * once, and the rest arrives as the `workspace` event says it moved. The answer is one more
 * reading of the steps, and is written only when no later reading was asked for meanwhile: the
 * events of the resumed preparation can have brought newer steps before it arrives.
 */
export async function resumePreparation(workspaceId: string): Promise<void> {
  forgetWorkspacesRefusal()
  const asked = asking()
  try {
    const steps = await window.hemera.invoke('preparation.resume', { workspaceId })
    if (!newest(`steps:${workspaceId}`, asked)) return
    onShown(workspaceId, (shown) => ({ ...shown, steps }))
  } catch (cause) {
    refused(cause)
  }
}

/** Shows the details of one service of the Workspace shown, or none. */
export function selectRun(runId: string | null): void {
  forgetWorkspacesRefusal()
  const shown = state.shown
  if (shown === null) return
  replace({
    ...state,
    shown: { ...shown, run: shown.services.find((one) => one.id === runId) ?? null },
  })
}

/**
 * Shows the run a step of the Workspace's preparation started, or none (D8-05, Decided 11): read
 * by its id among the Project's runs, since no Session asked for it, and followed from then on as
 * any run is, by what the engine pushes of it.
 */
export async function showStepRun(runId: string | null): Promise<void> {
  forgetWorkspacesRefusal()
  const shown = state.shown
  if (shown === null) return
  if (runId === null) {
    replace({ ...state, shown: { ...shown, run: null } })
    return
  }
  try {
    const run = await window.hemera.invoke('commands.runOf', { projectId: shown.projectId, runId })
    onShown(shown.workspaceId, (now) => ({ ...now, run }))
  } catch (cause) {
    refused(cause)
  }
}

/** Stops one service of the Workspace shown, that instance and no other (D8-08). */
export async function stopService(runId: string): Promise<void> {
  forgetWorkspacesRefusal()
  const shown = state.shown
  if (shown === null) return
  try {
    const stopped = await window.hemera.invoke('commands.stopService', {
      projectId: shown.projectId,
      runId,
    })
    onShown(shown.workspaceId, (now) => ({
      ...now,
      run: now.run?.id === runId ? stopped : now.run,
    }))
    await readServices(shown.workspaceId)
  } catch (cause) {
    refused(cause)
  }
}

/** Adds a step at the end of the recipe; answers the engine's sentence, or null (D8-05). */
export async function addRecipeStep(
  projectId: string,
  step: Omit<ChannelArguments<'recipe.add'>, 'projectId'>,
): Promise<string | null> {
  forgetWorkspacesRefusal()
  try {
    const recipe = await window.hemera.invoke('recipe.add', { projectId, ...step })
    replace({ ...state, recipes: withKey(state.recipes, projectId, recipe) })
    return null
  } catch (cause) {
    return message(cause)
  }
}

export async function removeRecipeStep(projectId: string, id: string): Promise<void> {
  forgetWorkspacesRefusal()
  try {
    const recipe = await window.hemera.invoke('recipe.remove', { projectId, id })
    replace({ ...state, recipes: withKey(state.recipes, projectId, recipe) })
  } catch (cause) {
    refused(cause)
  }
}

export async function moveRecipeStep(
  projectId: string,
  id: string,
  direction: 'up' | 'down',
): Promise<void> {
  forgetWorkspacesRefusal()
  try {
    const recipe = await window.hemera.invoke('recipe.move', { projectId, id, direction })
    replace({ ...state, recipes: withKey(state.recipes, projectId, recipe) })
  } catch (cause) {
    refused(cause)
  }
}

/** Reads again the variables of a scope: the Project's own, or the Workspace shown's. */
async function readScope(projectId: string, workspaceId: string | null): Promise<void> {
  if (workspaceId === null) await readProjectVariables(projectId)
  else await readWorkspaceVariables(workspaceId)
}

/**
 * Sets a variable of the Project, or of a Workspace over it (D8-06); answers the engine's
 * sentence, or null once the scope was read again.
 */
export async function setVariable(
  projectId: string,
  workspaceId: string | null,
  key: string,
  value: string,
): Promise<string | null> {
  forgetWorkspacesRefusal()
  try {
    await window.hemera.invoke('variables.set', { projectId, workspaceId, key, value })
    await readScope(projectId, workspaceId)
    return null
  } catch (cause) {
    return message(cause)
  }
}

export async function removeVariable(
  projectId: string,
  workspaceId: string | null,
  key: string,
): Promise<void> {
  forgetWorkspacesRefusal()
  try {
    await window.hemera.invoke('variables.remove', { projectId, workspaceId, key })
    await readScope(projectId, workspaceId)
  } catch (cause) {
    refused(cause)
  }
}

/** Whether a run is in the Workspace shown, `main` reading its runs as the engine does. */
function inShown(run: CommandRun, shown: ShownWorkspace): boolean {
  if (run.workspaceId === shown.workspaceId) return true
  return shown.main && (run.workspaceId === null || run.workspaceName === 'main')
}

/**
 * What a pushed run does to the services of the Workspace shown (D8-08, D8-09, Decided 12).
 *
 * `replace`: one of them printed or published something, and takes its place — its holder's side
 * kept, since a push carries none. `read`: the list itself changed, and is read again — one ended
 * or its conflict changed, a new one started here, or a run elsewhere named one of them as its
 * holder, or ended after naming it. `none`: nothing of the list moved, which is every line a
 * server prints elsewhere.
 */
export function serviceChange(
  services: readonly CommandRun[],
  run: CommandRun,
  shown: ShownWorkspace,
): 'replace' | 'read' | 'none' {
  const held = services.find((one) => one.id === run.id)
  if (held !== undefined) {
    const moved = run.state !== 'running' || run.portConflict?.runId !== held.portConflict?.runId
    return moved ? 'read' : 'replace'
  }
  const counted = services.some((one) => one.heldAgainst.some((other) => other.runId === run.id))
  if (run.type !== 'serve' || run.state !== 'running') return counted ? 'read' : 'none'
  if (inShown(run, shown)) return 'read'
  const holder = run.portConflict?.runId
  const holds = holder !== undefined && services.some((one) => one.id === holder)
  return holds && !counted ? 'read' : 'none'
}

/** What a pushed run changes of the Workspace shown. */
function heard(run: CommandRun, sessionId: string | null): void {
  const shown = state.shown
  if (shown === null || run.projectId !== shown.projectId) return
  // The details follow their run wherever it is pushed from.
  if (shown.run?.id === run.id) onShown(shown.workspaceId, (now) => ({ ...now, run }))
  // A run no Session asked for is a preparation's step (Decided 11): its end moves the steps.
  if (sessionId === null && run.workspaceId === shown.workspaceId && run.state !== 'running') {
    void readSteps(shown.workspaceId)
  }
  const change = serviceChange(shown.services, run, shown)
  if (change === 'read') void readServices(shown.workspaceId)
  if (change === 'replace') {
    onShown(shown.workspaceId, (now) => ({
      ...now,
      services: now.services.map((one) =>
        one.id === run.id ? { ...run, heldAgainst: one.heldAgainst } : one,
      ),
    }))
  }
}

/**
 * Listens to the engine for as long as the window is open, beside the other stores: a
 * Workspace's preparation moves on whatever page is on screen.
 */
export function listenToWorkspaces(): () => void {
  if (listening) return () => undefined
  listening = true
  const stop = window.hemera.on((event: EngineEvent) => {
    if (event.event === 'run') {
      heard(event.run, event.sessionId)
      return
    }
    if (event.event !== 'workspace') return
    if (state.workspaces.has(event.projectId)) void readWorkspaces(event.projectId)
    if (state.shown?.workspaceId === event.workspaceId) {
      void readSteps(event.workspaceId)
      void readStatus(event.workspaceId)
    }
  })
  return () => {
    listening = false
    stop()
  }
}

/**
 * Clears the last refusal: every act begins with it, since what the act before was refused with
 * has been said by then.
 */
export function forgetWorkspacesRefusal(): void {
  if (state.refusal === null) return
  replace({ ...state, refusal: null })
}
