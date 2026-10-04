/**
 * What the settings of a Project hold while the page shows them, and how they keep up: the
 * Project and each section read once, then kept up by the engine's changes — a Project edited
 * elsewhere, a repository Git can no longer read, a run that starts, gets its address or ends —
 * and by what each save answers. Plain functions over the link, no React; `use-settings.ts` holds
 * the state for the page.
 *
 * A save is a promise that rejects with the engine's own refusal, so the page can say it next to
 * the field it concerns. A variable's value is read only when the user asks to see it.
 */

import { NotFetchedSince } from '@hemera/ipc'
import type {
  Command,
  CommandDraft,
  MaskedVariable,
  Project,
  RecipeStep,
  RecipeStepDraft,
  Remote,
  RepositoryStatus,
  Run,
} from '@hemera/ipc'

import type { Link } from './link.ts'
import { followProject, type ProjectState } from './projects.ts'
import { linesOf, recipeDraftOfStep, runOfLine, type RepositoryRead } from './settings-model.ts'

/** A section's records: on their way, read, or why they could not be. */
export type Loadable<A> =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly value: A }
  | { readonly kind: 'failed'; readonly sentence: string }

export interface SettingsData {
  readonly project: ProjectState
  /** What Git read of each repository, and its last fetch, by its identifier. */
  readonly reads: ReadonlyMap<string, RepositoryRead>
  readonly catalogue: Loadable<ReadonlyArray<Command>>
  readonly recipe: Loadable<ReadonlyArray<RecipeStep>>
  /** What is wrong with each step of the recipe, by its position. */
  readonly problems: ReadonlyMap<number, string>
  readonly variables: Loadable<ReadonlyArray<MaskedVariable>>
  /** The values the user asked to see, by name. */
  readonly revealed: ReadonlyMap<string, string>
  /** The values being read to be shown. */
  readonly revealing: ReadonlySet<string>
  /** The runs of the main checkout, the newest first. */
  readonly runs: Loadable<ReadonlyArray<Run>>
  /** The last lines each run printed, by run. */
  readonly outputs: ReadonlyMap<string, ReadonlyArray<string>>
}

export const LOADING_SETTINGS: SettingsData = {
  project: { kind: 'loading' },
  reads: new Map(),
  catalogue: { kind: 'loading' },
  recipe: { kind: 'loading' },
  problems: new Map(),
  variables: { kind: 'loading' },
  revealed: new Map(),
  revealing: new Set(),
  runs: { kind: 'loading' },
  outputs: new Map(),
}

/** What the page asks of the settings it shows. */
export interface Settings {
  /** Reads everything again, after a failure. */
  readonly retry: () => void
  readonly stop: () => void
  readonly setWorkspacesRoot: (path: string | null) => Promise<void>
  readonly setBranchPrefix: (prefix: string | null) => Promise<void>
  /** Whether new Workspaces take a repository. */
  readonly include: (repositoryId: string, included: boolean) => Promise<void>
  /** Adds a repository by its path; answers its identifier. */
  readonly addRepository: (path: string) => Promise<string>
  readonly updateRepository: (
    repositoryId: string,
    change: { readonly path?: string; readonly includedByDefault?: boolean },
  ) => Promise<void>
  readonly setRemote: (repositoryId: string, remote: string | null) => Promise<void>
  /** Sets the base branch, then fetches it, so its freshness is the one just read. */
  readonly setBaseBranch: (repositoryId: string, branch: string) => Promise<void>
  /** Fetches a repository's base now; a failure is its freshness, never a refusal. */
  readonly fetchBase: (repositoryId: string) => Promise<void>
  readonly removeRepository: (repositoryId: string) => Promise<void>
  readonly remotes: (repositoryId: string) => Promise<ReadonlyArray<Remote>>
  /** Adds a command (`id` null) or rewrites one. */
  readonly saveCommand: (id: string | null, command: CommandDraft) => Promise<void>
  readonly removeCommand: (id: string) => Promise<void>
  /** Writes the whole recipe, and checks it again. */
  readonly saveRecipe: (steps: ReadonlyArray<RecipeStepDraft>) => Promise<void>
  /** Shows one value, read now; it is answered as well, for a form that edits it. */
  readonly reveal: (key: string) => Promise<string>
  readonly hide: (key: string) => void
  /** Sets a variable; a renamed one is removed under its old name once the new one is set. */
  readonly setVariable: (key: string, value: string, before: string | null) => Promise<void>
  readonly removeVariable: (key: string) => Promise<void>
  /** Runs a command of the catalogue in the main checkout. */
  readonly run: (commandId: string) => Promise<void>
  /** Starts what a line shows: its command again, or the service never started. */
  readonly start: (lineId: string) => Promise<void>
  readonly stopLine: (lineId: string) => Promise<void>
  readonly restart: (lineId: string) => Promise<void>
  /** Reads again what the runs shown printed last. */
  readonly readOutputs: () => void
}

const sentenceOf = (failure: Error): string => failure.message

/** A run as a change left it, in its place in the list, or first when it is new. */
export function withRun(runs: ReadonlyArray<Run>, changed: Run): ReadonlyArray<Run> {
  return runs.some((one) => one.id === changed.id)
    ? runs.map((one) => (one.id === changed.id ? changed : one))
    : [changed, ...runs]
}

/** The runs whose output is shown: the last of each command, and the lines of their own going. */
function shownRuns(runs: ReadonlyArray<Run>): Run[] {
  const seen = new Set<string>()
  return runs.filter((run) => {
    if (run.commandId === null) return run.endedAt === null
    if (seen.has(run.commandId)) return false
    seen.add(run.commandId)
    return true
  })
}

/** Follows the settings of one Project for as long as the page shows them. */
export function followSettings(
  link: Link,
  projectId: string,
  onData: (data: SettingsData) => void,
): Settings {
  let data: SettingsData = LOADING_SETTINGS
  let stopped = false
  /** Which reading of the sections is the current one: an answer to an earlier one is dropped. */
  let reading = 0

  const set = (change: Partial<SettingsData>): void => {
    if (stopped) return
    data = { ...data, ...change }
    onData(data)
  }

  const project = (): Project => {
    if (data.project.kind !== 'ready') throw new Error('the Project is not read yet')
    return data.project.project
  }

  /** A Project an edit answered: kept unless a newer one was heard meanwhile. */
  const kept = (answered: Project): void => {
    if (data.project.kind === 'ready' && data.project.project.version > answered.version) return
    set({ project: { kind: 'ready', project: answered } })
    readStatuses(answered)
  }

  const read = (id: string, change: RepositoryRead): void => {
    const reads = new Map(data.reads)
    reads.set(id, { ...reads.get(id), ...change })
    set({ reads })
  }

  /** What Git says of every repository not read yet in this visit. */
  const readStatuses = (of: Project): void => {
    for (const repository of of.repositories) {
      if (data.reads.get(repository.id)?.status !== undefined) continue
      link.repositoryStatus(repository.id).then(
        (status: RepositoryStatus) => read(repository.id, { status }),
        () => undefined,
      )
    }
  }

  const loadable = <A>(
    asked: number,
    load: () => Promise<A>,
    put: (value: Loadable<A>) => void,
    then: (value: A) => void = () => undefined,
  ): void => {
    put({ kind: 'loading' })
    load().then(
      (value) => {
        if (asked !== reading) return
        put({ kind: 'ready', value })
        then(value)
      },
      (failure: Error) => {
        if (asked === reading) put({ kind: 'failed', sentence: sentenceOf(failure) })
      },
    )
  }

  const checkRecipe = (steps: ReadonlyArray<RecipeStep>): void => {
    const drafts = steps.map(recipeDraftOfStep)
    link.checkRecipe(projectId, drafts).then(
      (checks) => {
        const problems = new Map<number, string>()
        for (const check of checks) {
          if (check.problem !== null) problems.set(check.position, check.problem)
        }
        set({ problems })
      },
      () => undefined,
    )
  }

  const readOutputs = (): void => {
    if (data.runs.kind !== 'ready') return
    for (const run of shownRuns(data.runs.value)) {
      link.runOutput(run.id).then(
        ({ output }) => {
          const outputs = new Map(data.outputs)
          outputs.set(run.id, linesOf(output))
          set({ outputs })
        },
        () => undefined,
      )
    }
  }

  const readSections = (): void => {
    reading += 1
    const asked = reading
    loadable(
      asked,
      () => link.catalogue(projectId),
      (catalogue) => set({ catalogue }),
    )
    loadable(
      asked,
      () => link.recipe(projectId),
      (recipe) => set({ recipe }),
      checkRecipe,
    )
    loadable(
      asked,
      () => link.variables(projectId),
      (variables) => set({ variables }),
    )
    loadable(
      asked,
      () => link.runs(projectId),
      (runs) => set({ runs }),
      readOutputs,
    )
  }

  const following = followProject(link, projectId, (state) => {
    set({ project: state })
    if (state.kind === 'ready') readStatuses(state.project)
  })

  const unhearRepositories = link.onRepositoryChanges(
    (change) => {
      if (change.projectId === projectId) read(change.repositoryId, { status: change.status })
    },
    () => undefined,
  )

  const unhearRuns = link.onRunChanges(
    (run) => {
      if (run.projectId !== projectId || run.workspaceId !== null) return
      if (data.runs.kind !== 'ready') return
      set({ runs: { kind: 'ready', value: withRun(data.runs.value, run) } })
      link.runOutput(run.id).then(
        ({ output }) => {
          const outputs = new Map(data.outputs)
          outputs.set(run.id, linesOf(output))
          set({ outputs })
        },
        () => undefined,
      )
    },
    () => undefined,
  )

  readSections()

  const version = () => project().version

  const fetchBase = (repositoryId: string): Promise<void> =>
    link.upToDateBase(repositoryId).then(
      ({ freshness }) => read(repositoryId, { fetch: freshness }),
      (failure: Error) =>
        // The base cannot be read now: the engine's sentence is why, and it was never fetched.
        read(repositoryId, {
          fetch: NotFetchedSince.make({ since: null, reason: failure.message }),
        }),
    )

  const catalogueOf = (): ReadonlyArray<Command> =>
    data.catalogue.kind === 'ready' ? data.catalogue.value : []

  const runsOf = (): ReadonlyArray<Run> => (data.runs.kind === 'ready' ? data.runs.value : [])

  const heardRun = (run: Run): void => {
    set({ runs: { kind: 'ready', value: withRun(runsOf(), run) } })
  }

  const lineRun = (lineId: string): Run => {
    const run = runOfLine(runsOf(), lineId)
    if (run === undefined) throw new Error('This line has no run.')
    return run
  }

  return {
    retry: () => {
      following.retry()
      readSections()
    },
    stop: () => {
      stopped = true
      following.stop()
      unhearRepositories()
      unhearRuns()
    },
    setWorkspacesRoot: (path) =>
      link.setWorkspacesRoot({ id: projectId, version: version(), path }).then(kept),
    setBranchPrefix: (prefix) =>
      link.setBranchPrefix({ id: projectId, version: version(), prefix }).then(kept),
    include: (id, includedByDefault) =>
      link.updateRepository({ id, version: version(), includedByDefault }).then(kept),
    addRepository: async (path) => {
      const before = new Set(project().repositories.map((one) => one.id))
      const answered = await link.addRepository({ projectId, version: version(), path })
      kept(answered)
      return answered.repositories.find((one) => !before.has(one.id))?.id ?? ''
    },
    updateRepository: (id, change) =>
      link.updateRepository({ id, version: version(), ...change }).then(kept),
    setRemote: (id, remote) => link.setRemote({ id, version: version(), remote }).then(kept),
    setBaseBranch: async (id, branch) => {
      kept(await link.setBaseBranch({ id, version: version(), branch }))
      void fetchBase(id)
    },
    fetchBase,
    removeRepository: (id) => link.removeRepository({ id, version: version() }).then(kept),
    remotes: (id) => link.remotes(id),
    saveCommand: async (id, command) => {
      const saved = await link.saveCommand({ projectId, id, command })
      const catalogue = catalogueOf()
      set({
        catalogue: {
          kind: 'ready',
          value: catalogue.some((one) => one.id === saved.id)
            ? catalogue.map((one) => (one.id === saved.id ? saved : one))
            : [...catalogue, saved],
        },
      })
    },
    removeCommand: async (id) => {
      await link.removeCommand(projectId, id)
      set({ catalogue: { kind: 'ready', value: catalogueOf().filter((one) => one.id !== id) } })
    },
    saveRecipe: async (steps) => {
      const saved = await link.saveRecipe({ projectId, version: version(), steps })
      set({ recipe: { kind: 'ready', value: saved } })
      checkRecipe(saved)
      kept(await link.project(projectId))
    },
    reveal: async (key) => {
      set({ revealing: new Set([...data.revealing, key]) })
      try {
        const value = await link.revealVariable({ projectId, workspaceId: null, key })
        const revealed = new Map(data.revealed)
        revealed.set(key, value)
        set({ revealed })
        return value
      } finally {
        const revealing = new Set(data.revealing)
        revealing.delete(key)
        set({ revealing })
      }
    },
    hide: (key) => {
      const revealed = new Map(data.revealed)
      revealed.delete(key)
      set({ revealed })
    },
    setVariable: async (key, value, before) => {
      const saved = await link.setVariable({ projectId, workspaceId: null, key, value })
      if (before !== null && before !== saved.key) {
        await link.removeVariable({ projectId, workspaceId: null, key: before })
      }
      const variables = data.variables.kind === 'ready' ? data.variables.value : []
      const others = variables.filter((one) => one.key !== saved.key && one.key !== before)
      const at = variables.findIndex((one) => one.key === (before ?? saved.key))
      const next = at === -1 ? [...others, saved] : others.toSpliced(at, 0, saved)
      const revealed = new Map(data.revealed)
      if (before !== null) revealed.delete(before)
      if (data.revealed.has(before ?? saved.key)) revealed.set(saved.key, value)
      set({ variables: { kind: 'ready', value: next }, revealed })
    },
    removeVariable: async (key) => {
      await link.removeVariable({ projectId, workspaceId: null, key })
      const variables = data.variables.kind === 'ready' ? data.variables.value : []
      set({ variables: { kind: 'ready', value: variables.filter((one) => one.key !== key) } })
    },
    run: async (commandId) => {
      heardRun(
        await link.startRun({ projectId, workspaceId: null, commandId, line: null, folder: null }),
      )
    },
    start: async (lineId) => {
      const shown = runOfLine(runsOf(), lineId)
      const commandId = shown?.commandId ?? lineId.replace(/^command:/, '')
      heardRun(
        await link.startRun({ projectId, workspaceId: null, commandId, line: null, folder: null }),
      )
    },
    stopLine: async (lineId) => {
      heardRun(await link.stopRun(lineRun(lineId).id))
    },
    restart: async (lineId) => {
      heardRun(await link.restartRun(lineRun(lineId).id))
    },
    readOutputs,
  }
}
