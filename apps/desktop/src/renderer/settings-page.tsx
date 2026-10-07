import {
  CommandForm,
  CommandsSection,
  FormFoot,
  NEW_COMMAND,
  NEW_STEP,
  ProjectSettings,
  RecipeSection,
  RepositoriesSection,
  RepositoryForm,
  ServicesSection,
  StepForm,
  VariableForm,
  VariablesSection,
  WorkspacesSection,
  typeIcon,
  type CommandDraft,
  type RemoteChoice,
  type RepositoryDraft,
  type SettingsForm,
  type SettingsSection,
  type StepDraft,
  type VariableDraft,
} from '@hemera/ui'
import {
  IconAdjustments,
  IconBan,
  IconFileText,
  IconGauge,
  IconGitBranch,
  IconListNumbers,
  IconPlayerPlay,
  IconStack2,
  IconTerminal,
  IconVariable,
} from '@hemera/ui/icons'
import { defaultBranchPrefix } from '@hemera/core/domain'
import {
  InvalidBranchName,
  InvalidCommand,
  InvalidRecipeStep,
  InvalidRepositoryPath,
  InvalidTemplate,
  InvalidVariableKey,
  ShellSyntax,
  type Command,
  type Project,
  type RecipeStep,
  type Repository,
} from '@hemera/ipc'
import { type ReactNode, useEffect, useRef, useState } from 'react'

import { type AgentSectionId, isAgentSection } from './agent-sections.tsx'
import type { Settings, SettingsData } from './settings-data.ts'
import {
  commandDraftOf,
  commandFormOf,
  commandRowOf,
  recipeDraftOf,
  recipeDraftOfStep,
  repositoryRowOf,
  runRowsOf,
  stepDraftOf,
  stepRowsOf,
} from './settings-model.ts'

/** What the page needs of the window besides the settings: main's picker, the clipboard, a browser. */
export interface SettingsTools {
  /** The system's own folder picker: the folder chosen, or null. */
  readonly chooseFolder: () => Promise<string | null>
  /** What the engine refuses in a line as it is typed, in its words; null for nothing. */
  readonly checkLine: (line: string) => Promise<string | null>
  readonly copy: (text: string) => void
  /** Opens an address in the user's own browser. */
  readonly open: (url: string) => void
  /** Hemera's data folder, where a Project's Workspaces go by default. */
  readonly dataFolder: string
}

export interface SettingsPageProps {
  data: SettingsData
  /** Null while the engine has not answered. */
  settings: Settings | null
  tools: SettingsTools
  /**
   * The agent and permission sections (#53), drawn by their own hooks: the section, and how it
   * shows its dialog over the page.
   */
  agentSection?: (id: AgentSectionId, show: (form: SettingsForm | null) => void) => ReactNode
  /** Asks the setup agent again, or opens what it proposed. */
  onSetUp?: (() => void) | undefined
  /** What waits above the section: a setup left for later. */
  banner?: ReactNode
}

type SectionId =
  | 'repositories'
  | 'workspaces'
  | 'commands'
  | 'preparation'
  | 'variables'
  | 'services'
  | AgentSectionId

const SECTIONS: ReadonlyArray<SettingsSection & { readonly id: SectionId }> = [
  { id: 'repositories', label: 'Repositories', icon: <IconGitBranch size="sm" /> },
  { id: 'workspaces', label: 'Workspaces', icon: <IconStack2 size="sm" /> },
  { id: 'commands', label: 'Commands', icon: <IconTerminal size="sm" /> },
  { id: 'preparation', label: 'Preparation', icon: <IconListNumbers size="sm" /> },
  { id: 'variables', label: 'Variables', icon: <IconVariable size="sm" /> },
  { id: 'services', label: 'Services', icon: <IconPlayerPlay size="sm" /> },
  { id: 'never', label: 'Never run', icon: <IconBan size="sm" /> },
  { id: 'models', label: 'Models by role', icon: <IconAdjustments size="sm" /> },
  { id: 'budget', label: 'Cap and budget', icon: <IconGauge size="sm" /> },
  { id: 'instructions', label: 'Instructions', icon: <IconFileText size="sm" /> },
]

/** What a dialog writes, and the draft it holds. */
type Writing =
  | { readonly kind: 'repository'; readonly id: string | null; readonly draft: RepositoryDraft }
  | { readonly kind: 'command'; readonly id: string | null; readonly draft: CommandDraft }
  | { readonly kind: 'step'; readonly id: string | null; readonly draft: StepDraft }
  | { readonly kind: 'variable'; readonly key: string | null; readonly draft: VariableDraft }

/** The engine's refusals of the last save, next to the fields they concern; the rest at the foot. */
interface Refusals {
  readonly path?: string | undefined
  readonly branch?: string | undefined
  readonly name?: string | undefined
  readonly globs?: string | undefined
  readonly key?: string | undefined
  readonly value?: string | undefined
  readonly foot?: string | undefined
}

/** How long typing in a field of the Workspaces waits before it is written. */
const TYPING_SETTLES_MS = 600

/** How often what runs is read again while the Services are shown. */
const OUTPUT_EVERY_MS = 2000

const NEW_REPOSITORY: RepositoryDraft = {
  path: '',
  includedByDefault: true,
  remote: null,
  baseBranch: 'main',
}

const sentenceOf = (failure: Error): string => failure.message

/** Where a refusal of a repository's form is said. */
function repositoryRefusal(failure: Error): Refusals {
  if (failure instanceof InvalidRepositoryPath) return { path: failure.message }
  if (failure instanceof InvalidBranchName) return { branch: failure.message }
  return { foot: sentenceOf(failure) }
}

/** Where a refusal of a command's form is said: its name, its files, or the foot. */
function commandRefusal(failure: Error, lineRefused: boolean): Refusals {
  if (failure instanceof InvalidCommand) {
    if (failure.reason.startsWith('the write glob')) return { globs: failure.message }
    if (failure.reason.startsWith('its name') || failure.reason.startsWith('a command named')) {
      return { name: failure.message }
    }
  }
  // Shell syntax and an unknown name are already said under the line they are in.
  if ((failure instanceof ShellSyntax || failure instanceof InvalidTemplate) && lineRefused) {
    return {}
  }
  return { foot: sentenceOf(failure) }
}

/** Where a refusal of a step's form is said: its source for a copy or a link, or the foot. */
function stepRefusal(failure: Error, draft: StepDraft, position: number): Refusals {
  const aboutSource =
    draft.kind !== 'run' &&
    ((failure instanceof InvalidRecipeStep && failure.position === position) ||
      failure instanceof InvalidRepositoryPath ||
      failure instanceof InvalidTemplate)
  return aboutSource ? { path: failure.message } : { foot: sentenceOf(failure) }
}

function variableRefusal(failure: Error): Refusals {
  if (failure instanceof InvalidVariableKey) return { key: failure.message }
  if (failure instanceof InvalidTemplate) return { value: failure.message }
  return { foot: sentenceOf(failure) }
}

/** A folder chosen with the picker, as a path in the main checkout when it is in it. */
function inMainCheckout(mainCheckout: string, folder: string): string {
  const slash = (path: string) => path.replaceAll('\\', '/').replace(/\/+$/, '')
  const root = slash(mainCheckout)
  const chosen = slash(folder)
  if (chosen === root) return '.'
  return chosen.startsWith(`${root}/`) ? chosen.slice(root.length + 1) : folder
}

/** Hemera's own folder for a Project's Workspaces, written the way the data folder is. */
function defaultWorkspacesFolder(dataFolder: string, projectId: string): string {
  const separator = dataFolder.includes('\\') ? '\\' : '/'
  return [dataFolder.replace(/[\\/]+$/, ''), 'workspaces', projectId].join(separator)
}

/** A prefix as the engine keeps it: without the slash the branch puts after it. */
function keptPrefix(prefix: string | null): string | null {
  const kept = prefix?.trim().replace(/\/+$/, '') ?? ''
  return kept === '' ? null : kept
}

/**
 * The lines the engine was asked about, and what it refused in each: what a line field shows as
 * it is typed, the token named.
 */
function useLineChecks(
  check: (line: string) => Promise<string | null>,
  lines: ReadonlyArray<string>,
): (line: string) => string | undefined {
  const [checked, setChecked] = useState<ReadonlyMap<string, string | null>>(new Map())
  const asked = useRef(new Set<string>())
  const wanted = lines.filter((line) => line.trim() !== '').join('\n')
  useEffect(() => {
    for (const line of wanted.split('\n')) {
      if (line === '' || asked.current.has(line)) continue
      asked.current.add(line)
      check(line).then(
        (problem) => setChecked((before) => new Map(before).set(line, problem)),
        () => asked.current.delete(line),
      )
    }
  }, [check, wanted])
  return (line) => checked.get(line) ?? undefined
}

/** The Workspaces fields: what is typed, written once the typing settles. */
function useSettled(
  saved: string | null,
  write: (value: string | null) => Promise<void>,
): [string | null, (value: string | null) => void, string | undefined] {
  const [value, setValue] = useState(saved)
  const [error, setError] = useState<string | undefined>(undefined)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const typing = useRef(false)
  const writeNow = (next: string | null): void => {
    typing.current = false
    write(next).then(
      () => setError(undefined),
      (failure: Error) => setError(sentenceOf(failure)),
    )
  }
  // A value changed elsewhere is taken, unless the user is typing in the field.
  useEffect(() => {
    if (!typing.current) setValue(saved)
  }, [saved])
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current)
    },
    [],
  )
  const change = (next: string | null): void => {
    setValue(next)
    typing.current = true
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = setTimeout(() => writeNow(next), TYPING_SETTLES_MS)
  }
  return [value, change, error]
}

interface WorkspacesProps {
  project: Project
  settings: Settings | null
  tools: SettingsTools
}

function Workspaces({ project, settings, tools }: WorkspacesProps): ReactNode {
  const slug = defaultBranchPrefix(project.name)
  const [folder, setFolder, folderError] = useSettled(project.workspacesRoot, async (value) =>
    settings?.setWorkspacesRoot(value),
  )
  const [prefix, setPrefix, prefixError] = useSettled(project.branchPrefix, async (value) =>
    settings?.setBranchPrefix(keptPrefix(value)),
  )
  return (
    <WorkspacesSection
      folder={folder}
      defaultFolder={defaultWorkspacesFolder(tools.dataFolder, project.id)}
      onFolder={setFolder}
      onChooseFolder={() => {
        void tools.chooseFolder().then((chosen) => {
          if (chosen !== null) setFolder(chosen)
        })
      }}
      prefix={prefix}
      defaultPrefix={`${slug}/`}
      onPrefix={setPrefix}
      example={`${slug.toUpperCase()}-12`}
      folderError={folderError}
      prefixError={prefixError}
    />
  )
}

/**
 * A Project's settings in the window: the page of the design, its sections drawn from what the
 * engine answers, and every dialog's save sent to it, its refusal said next to the field it
 * concerns.
 */
export function SettingsPage({
  data,
  settings,
  tools,
  agentSection,
  onSetUp,
  banner,
}: SettingsPageProps): ReactNode {
  const [current, setCurrent] = useState<SectionId>('repositories')
  /** The dialog an agent section shows over the page. */
  const [agentForm, setAgentForm] = useState<SettingsForm | null>(null)
  const [writing, setWriting] = useState<Writing | null>(null)
  const [refusals, setRefusals] = useState<Refusals>({})
  const [saving, setSaving] = useState(false)
  const [remotes, setRemotes] = useState<ReadonlyMap<string, ReadonlyArray<RemoteChoice>>>(
    new Map(),
  )
  /** The order of the steps while they are being moved, before it is written. */
  const [order, setOrder] = useState<ReadonlyArray<string> | null>(null)
  const ordering = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Why the last change made on a line of a section, without a dialog, was refused. */
  const [refusedIn, setRefusedIn] = useState<ReadonlyMap<SectionId, string>>(new Map())

  const project = data.project.kind === 'ready' ? data.project.project : null
  const repositories: ReadonlyArray<Repository> = project?.repositories ?? []
  const catalogue: ReadonlyArray<Command> =
    data.catalogue.kind === 'ready' ? data.catalogue.value : []
  const recipe: ReadonlyArray<RecipeStep> = data.recipe.kind === 'ready' ? data.recipe.value : []

  const lines =
    writing?.kind === 'command'
      ? [writing.draft.line, writing.draft.lineLinux ?? '', writing.draft.lineWindows ?? '']
      : writing?.kind === 'step' && writing.draft.kind === 'run' && writing.draft.command === null
        ? [writing.draft.line ?? '']
        : []
  const refusalOf = useLineChecks(tools.checkLine, lines)

  const services = current === 'services'
  const runningNow =
    data.runs.kind === 'ready' && data.runs.value.some((run) => run.endedAt === null)
  useEffect(() => {
    if (!services || !runningNow || settings === null) return undefined
    const every = setInterval(() => settings.readOutputs(), OUTPUT_EVERY_MS)
    return () => clearInterval(every)
  }, [services, runningNow, settings])

  useEffect(
    () => () => {
      if (ordering.current !== null) clearTimeout(ordering.current)
    },
    [],
  )

  const open = (next: Writing): void => {
    setRefusals({})
    setSaving(false)
    setWriting(next)
  }
  const close = (): void => {
    setRefusals({})
    setSaving(false)
    setWriting(null)
  }

  /** Runs a save: the dialog closes when it is written, and says why when it is refused. */
  const saveWith = (write: () => Promise<void>, refusal: (failure: Error) => Refusals): void => {
    setSaving(true)
    setRefusals({})
    write().then(close, (failure: Error) => {
      setSaving(false)
      setRefusals(refusal(failure))
    })
  }

  const openRepository = (id: string): void => {
    const repository = repositories.find((one) => one.id === id)
    if (repository === undefined || settings === null) return
    open({
      kind: 'repository',
      id,
      draft: {
        path: repository.path,
        includedByDefault: repository.includedByDefault,
        remote: repository.remote,
        baseBranch: repository.baseBranch,
      },
    })
    settings.remotes(id).then(
      (found) =>
        setRemotes((before) =>
          new Map(before).set(
            id,
            found.map((remote) => ({ name: remote.name, url: remote.fetchUrl })),
          ),
        ),
      () => setRemotes((before) => new Map(before).set(id, [])),
    )
  }

  const saveRepository = (id: string | null, draft: RepositoryDraft): void => {
    if (settings === null) return
    saveWith(async () => {
      if (id === null) {
        const added = await settings.addRepository(draft.path)
        if (!draft.includedByDefault) {
          await settings.updateRepository(added, { includedByDefault: false })
        }
        return
      }
      const before = repositories.find((one) => one.id === id)
      if (before === undefined) return
      if (draft.path !== before.path || draft.includedByDefault !== before.includedByDefault) {
        await settings.updateRepository(id, {
          path: draft.path,
          includedByDefault: draft.includedByDefault,
        })
      }
      if (draft.remote !== before.remote) await settings.setRemote(id, draft.remote)
      if (draft.baseBranch !== before.baseBranch || draft.remote !== before.remote) {
        await settings.setBaseBranch(id, draft.baseBranch)
      }
    }, repositoryRefusal)
  }

  const writeSteps = (
    steps: ReadonlyArray<ReturnType<typeof recipeDraftOfStep>>,
    position: number,
    draft: StepDraft,
  ): void => {
    if (settings === null) return
    saveWith(
      () => settings.saveRecipe(steps),
      (failure) => stepRefusal(failure, draft, position),
    )
  }

  /** Steps moved are written once the moving settles, not at each place they pass. */
  const reorder = (ids: string[]): void => {
    setOrder(ids)
    if (ordering.current !== null) clearTimeout(ordering.current)
    ordering.current = setTimeout(() => {
      const steps = ids.flatMap((id) => recipe.filter((step) => step.id === id))
      act(
        'preparation',
        settings &&
          (() => settings.saveRecipe(steps.map(recipeDraftOfStep)).finally(() => setOrder(null))),
      )
    }, TYPING_SETTLES_MS)
  }

  /** A change made on a line: what refuses it is said by the section's glyph in the list. */
  const act = <A,>(section: SectionId, change: (() => Promise<A>) | null): void => {
    if (change === null) return
    setRefusedIn((before) => {
      const next = new Map(before)
      next.delete(section)
      return next
    })
    change().then(
      () => undefined,
      (failure: Error) =>
        setRefusedIn((before) => new Map(before).set(section, sentenceOf(failure))),
    )
  }

  const now = new Date()
  const rows = repositories.map((repository) =>
    repositoryRowOf(repository, data.reads.get(repository.id) ?? {}, now),
  )
  const stepRows = stepRowsOf(recipe, repositories, catalogue, data.problems)
  const shownSteps =
    order === null ? stepRows : order.flatMap((id) => stepRows.filter((step) => step.id === id))
  const runs = runRowsOf(
    data.runs.kind === 'ready' ? data.runs.value : [],
    catalogue,
    repositories,
    data.outputs,
  )
  const places = repositories.map((one) => one.path).filter((path) => path !== '.')

  const unreadable = rows.filter((row) => row.unreadable !== undefined)
  const problems = new Map<SectionId, string>()
  if (unreadable.length > 0) {
    problems.set('repositories', `${unreadable.map((row) => row.path).join(', ')} cannot be read`)
  }
  if (data.problems.size > 0) problems.set('preparation', 'a step cannot be done')
  if (runs.some((run) => run.kind === 'live' && run.state === 'failed')) {
    problems.set('services', 'a service failed')
  }
  for (const [section, sentence] of refusedIn) problems.set(section, sentence)
  const sections = SECTIONS.map((one) => ({ ...one, problem: problems.get(one.id) }))

  const unread = [data.project, data.catalogue, data.recipe, data.variables, data.runs].find(
    (one) => one.kind === 'failed',
  )

  const form = ((): SettingsForm | null => {
    if (writing === null) return null
    const foot = (what: string | null, onSave: () => void, onRemove: () => void): ReactNode => (
      <FormFoot
        refused={refusals.foot}
        remove={what === null ? undefined : `Remove ${what}`}
        onRemove={onRemove}
        save={what === null ? 'Add' : 'Save'}
        saving={saving}
        onSave={onSave}
        onCancel={close}
      />
    )
    switch (writing.kind) {
      case 'repository': {
        const row = rows.find((one) => one.id === writing.id)
        const found = writing.id === null ? undefined : remotes.get(writing.id)
        const choices =
          found === undefined ||
          writing.draft.remote === null ||
          found.some((one) => one.name === writing.draft.remote)
            ? found
            : [...found, { name: writing.draft.remote, url: '' }]
        return {
          title: writing.id === null ? 'New repository' : (row?.path ?? writing.draft.path),
          icon: <IconGitBranch size="sm" />,
          body: (
            <RepositoryForm
              draft={writing.draft}
              onChange={(draft) => setWriting({ ...writing, draft })}
              remotes={choices}
              freshness={row?.freshness}
              unreadable={row?.unreadable}
              pathError={refusals.path}
              branchError={refusals.branch}
              icons={false}
              onChooseFolder={() => {
                void tools.chooseFolder().then((chosen) => {
                  if (chosen === null || project === null) return
                  const path = inMainCheckout(project.mainCheckout, chosen)
                  // The picker answers later: the draft is the one written meanwhile.
                  setWriting((shown) =>
                    shown?.kind === 'repository'
                      ? { ...shown, draft: { ...shown.draft, path } }
                      : shown,
                  )
                })
              }}
            />
          ),
          footer: foot(
            writing.id === null ? null : (row?.path ?? null),
            () => saveRepository(writing.id, writing.draft),
            () => {
              if (writing.id === null || settings === null) return
              const id = writing.id
              saveWith(() => settings.removeRepository(id), repositoryRefusal)
            },
          ),
        }
      }
      case 'command': {
        const previous = catalogue.find((one) => one.id === writing.id) ?? null
        return {
          title: writing.id === null ? 'New command' : writing.draft.name,
          icon: typeIcon(writing.draft.type),
          body: (
            <CommandForm
              draft={writing.draft}
              onChange={(draft) => setWriting({ ...writing, draft })}
              places={places}
              refusalOf={refusalOf}
              nameError={refusals.name}
              globsError={refusals.globs}
            />
          ),
          footer: foot(
            writing.id === null ? null : (previous?.name ?? writing.draft.name),
            () => {
              if (settings === null) return
              saveWith(
                () =>
                  settings.saveCommand(
                    writing.id,
                    commandDraftOf(writing.draft, previous, repositories),
                  ),
                (failure) =>
                  commandRefusal(
                    failure,
                    [writing.draft.line, writing.draft.lineLinux, writing.draft.lineWindows].some(
                      (line) => line !== null && refusalOf(line) !== undefined,
                    ),
                  ),
              )
            },
            () => {
              if (writing.id === null || settings === null) return
              const id = writing.id
              saveWith(
                () => settings.removeCommand(id),
                (failure) => ({ foot: sentenceOf(failure) }),
              )
            },
          ),
        }
      }
      case 'step': {
        const at = recipe.findIndex((one) => one.id === writing.id)
        const position = at === -1 ? recipe.length + 1 : at + 1
        const previous = recipe[at] ?? null
        const problem = previous === null ? undefined : data.problems.get(previous.position)
        const unchanged =
          previous !== null &&
          writing.draft.path === stepDraftOf(previous, repositories).path &&
          writing.draft.place === stepDraftOf(previous, repositories).place
        const saved = recipeDraftOf(writing.draft, repositories, previous)
        const drafts = recipe.map(recipeDraftOfStep)
        return {
          title: writing.id === null ? 'New step' : `Step ${String(position)}`,
          icon: <IconListNumbers size="sm" />,
          body: (
            <StepForm
              draft={writing.draft}
              onChange={(draft) => setWriting({ ...writing, draft })}
              places={places}
              commands={catalogue.map((one) => ({
                id: one.id,
                name: one.name,
                type: one.type,
                line: one.line,
              }))}
              pathError={refusals.path ?? (unchanged ? problem : undefined)}
              refusalOf={refusalOf}
              systems={false}
            />
          ),
          footer: foot(
            writing.id === null ? null : `step ${String(position)}`,
            () =>
              writeSteps(
                at === -1 ? [...drafts, saved] : drafts.toSpliced(at, 1, saved),
                position,
                writing.draft,
              ),
            () => writeSteps(drafts.toSpliced(at, 1), position, writing.draft),
          ),
        }
      }
      case 'variable':
        return {
          title: writing.key ?? 'New variable',
          icon: <IconVariable size="sm" />,
          body: (
            <VariableForm
              draft={writing.draft}
              onChange={(draft) => setWriting({ ...writing, draft })}
              keyError={refusals.key}
              valueError={refusals.value}
            />
          ),
          footer: foot(
            writing.key,
            () => {
              if (settings === null) return
              saveWith(
                () => settings.setVariable(writing.draft.key, writing.draft.value, writing.key),
                variableRefusal,
              )
            },
            () => {
              if (writing.key === null || settings === null) return
              const key = writing.key
              saveWith(() => settings.removeVariable(key), variableRefusal)
            },
          ),
        }
    }
  })()

  const body = ((): ReactNode => {
    if (isAgentSection(current)) return agentSection?.(current, setAgentForm) ?? null
    switch (current) {
      case 'repositories':
        return (
          <RepositoriesSection
            repositories={rows}
            loading={project === null}
            onInclude={(id, included) =>
              act('repositories', settings && (() => settings.include(id, included)))
            }
            onOpen={openRepository}
            onAdd={() => open({ kind: 'repository', id: null, draft: NEW_REPOSITORY })}
          />
        )
      case 'workspaces':
        return project === null ? (
          <WorkspacesSection
            loading
            folder={null}
            defaultFolder=""
            onFolder={() => undefined}
            onChooseFolder={() => undefined}
            prefix={null}
            defaultPrefix=""
            onPrefix={() => undefined}
            example=""
          />
        ) : (
          <Workspaces key={project.id} project={project} settings={settings} tools={tools} />
        )
      case 'commands':
        return (
          <CommandsSection
            commands={catalogue.map((one) => commandRowOf(one, repositories))}
            loading={data.catalogue.kind !== 'ready' || project === null}
            onOpen={(id) => {
              const found = catalogue.find((one) => one.id === id)
              if (found !== undefined) {
                open({ kind: 'command', id, draft: commandFormOf(found, repositories) })
              }
            }}
            onAdd={() => open({ kind: 'command', id: null, draft: NEW_COMMAND })}
          />
        )
      case 'preparation':
        return (
          <RecipeSection
            steps={shownSteps}
            loading={data.recipe.kind !== 'ready' || project === null}
            onOpen={(id) => {
              const found = recipe.find((one) => one.id === id)
              if (found !== undefined) {
                open({ kind: 'step', id, draft: stepDraftOf(found, repositories) })
              }
            }}
            onAdd={() => open({ kind: 'step', id: null, draft: NEW_STEP })}
            onReorder={reorder}
          />
        )
      case 'variables':
        return (
          <VariablesSection
            variables={(data.variables.kind === 'ready' ? data.variables.value : []).map((one) => ({
              key: one.key,
              value: data.revealed.get(one.key),
              revealing: data.revealing.has(one.key),
            }))}
            loading={data.variables.kind !== 'ready'}
            onReveal={(key) => act('variables', settings && (() => settings.reveal(key)))}
            onHide={(key) => settings?.hide(key)}
            onEdit={(key) => {
              // Editing a value is asking to see it: it is read now, for the form.
              act(
                'variables',
                settings &&
                  (() =>
                    settings
                      .reveal(key)
                      .then((value) => open({ kind: 'variable', key, draft: { key, value } }))),
              )
            }}
            onRemove={(key) => act('variables', settings && (() => settings.removeVariable(key)))}
            onAdd={() => open({ kind: 'variable', key: null, draft: { key: '', value: '' } })}
          />
        )
      case 'services':
        return (
          <ServicesSection
            runs={runs}
            commands={catalogue.map((one) => ({ id: one.id, name: one.name, type: one.type }))}
            loading={data.runs.kind !== 'ready' || data.catalogue.kind !== 'ready'}
            onRun={(commandId) => act('services', settings && (() => settings.run(commandId)))}
            onStart={(id) => act('services', settings && (() => settings.start(id)))}
            onDecline={(id) => act('services', settings && (() => settings.stopLine(id)))}
            onRestart={(id) => act('services', settings && (() => settings.restart(id)))}
            onStop={(id) => act('services', settings && (() => settings.stopLine(id)))}
            onCopyUrl={(id) => {
              const run = runs.find((one) => one.id === id)
              if (run?.kind === 'live' && run.url !== undefined) tools.copy(run.url)
            }}
            onOpenUrl={(id) => {
              const run = runs.find((one) => one.id === id)
              if (run?.kind === 'live' && run.url !== undefined) tools.open(run.url)
            }}
          />
        )
    }
  })()

  return (
    <ProjectSettings
      name={project?.name ?? ''}
      mainCheckout={project?.mainCheckout ?? ''}
      sections={sections}
      current={current}
      onSection={(id) => {
        const chosen = SECTIONS.find((one) => one.id === id)
        if (chosen !== undefined) setCurrent(chosen.id)
      }}
      error={unread?.kind === 'failed' ? unread.sentence : undefined}
      onRetry={() => settings?.retry()}
      onSetUp={onSetUp}
      banner={banner}
      form={form ?? agentForm}
      onCloseForm={() => {
        close()
        setAgentForm(null)
      }}
    >
      {body}
    </ProjectSettings>
  )
}
