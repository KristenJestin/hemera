import {
  ProjectSettings,
  type RemoteChoice,
  type SetUpAction,
  type SettingsForm,
  type SettingsRepository,
  type SettingsRun,
  type SettingsSection,
} from '@hemera/ui'
import {
  IconAdjustments,
  IconBook2,
  IconChecklist,
  IconDatabase,
  IconGitMerge,
  IconFileText,
  IconGauge,
  IconGitBranch,
  IconListNumbers,
  IconPlayerPlay,
  IconPlug,
  IconStack2,
  IconTerminal,
  IconTestPipe,
  IconVariable,
} from '@hemera/ui/icons'
import type { Command, RecipeStep, Repository } from '@hemera/ipc'
import { type ReactNode, useEffect, useRef, useState } from 'react'

import type { AgentSectionId } from './agent-sections.tsx'
import type { Settings, SettingsData } from './settings-data.ts'
import { formOf } from './settings-forms.tsx'
import { TYPING_SETTLES_MS, useLineChecks } from './settings-hooks.ts'
import { recipeDraftOfStep, repositoryRowOf, runRowsOf, stepRowsOf } from './settings-model.ts'
import { sentenceOf } from './settings-refusals.ts'
import { sectionBody } from './settings-sections.tsx'
import type { Refusals, SectionId, SettingsTools, Writing } from './settings-types.ts'
import type { TicketSectionId } from './ticket-sections.tsx'

export type { SettingsTools }

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
  /** The setup agent's launch, at the header's end. */
  setUp?: SetUpAction | undefined
  /** The ticket and resource sections, drawn by their own hooks, like the agent sections. */
  ticketSection?: (id: TicketSectionId, show: (form: SettingsForm | null) => void) => ReactNode
  /** The section shown first, from the route; the first of the list when it names none. */
  section?: string | undefined
  /** What the window knows is wrong in a section, by section, said by its glyph in the list. */
  problems?: ReadonlyMap<string, string> | undefined
}

const SECTIONS: ReadonlyArray<SettingsSection & { readonly id: SectionId }> = [
  { id: 'repositories', label: 'Repositories', icon: <IconGitBranch size="sm" /> },
  { id: 'tests', label: 'Tests', icon: <IconTestPipe size="sm" /> },
  { id: 'workspaces', label: 'Workspaces', icon: <IconStack2 size="sm" /> },
  { id: 'commands', label: 'Commands', icon: <IconTerminal size="sm" /> },
  { id: 'preparation', label: 'Preparation', icon: <IconListNumbers size="sm" /> },
  { id: 'variables', label: 'Variables', icon: <IconVariable size="sm" /> },
  { id: 'services', label: 'Services', icon: <IconPlayerPlay size="sm" /> },
  { id: 'models', label: 'Models by role', icon: <IconAdjustments size="sm" /> },
  { id: 'budget', label: 'Cap and budget', icon: <IconGauge size="sm" /> },
  { id: 'instructions', label: 'Instructions', icon: <IconFileText size="sm" /> },
  { id: 'tickets', label: 'Tickets and Specs', icon: <IconPlug size="sm" /> },
  { id: 'resources', label: 'Exclusive resources', icon: <IconDatabase size="sm" /> },
  { id: 'checks', label: 'Checks', icon: <IconChecklist size="sm" /> },
  { id: 'documentation', label: 'Documentation', icon: <IconBook2 size="sm" /> },
  { id: 'delivery', label: 'Delivery rules', icon: <IconGitMerge size="sm" /> },
]

/** The section an entry of the list names, or null when the page has none of that name. */
export function sectionChosen(id: string): SectionId | null {
  return SECTIONS.find((one) => one.id === id)?.id ?? null
}

/** How often what runs is read again while the Services are shown. */
const OUTPUT_EVERY_MS = 2000

/** The command lines a dialog holds, which the engine is asked about as they are typed. */
function linesOf(writing: Writing | null): ReadonlyArray<string> {
  if (writing?.kind === 'command') {
    return [writing.draft.line, writing.draft.lineLinux ?? '', writing.draft.lineWindows ?? '']
  }
  if (writing?.kind === 'step' && writing.draft.kind === 'run' && writing.draft.command === null) {
    return [writing.draft.line ?? '']
  }
  return []
}

/** What is wrong in each section, said by its glyph in the list: the page's own and the window's. */
function problemsOf(
  data: SettingsData,
  rows: ReadonlyArray<SettingsRepository>,
  runs: ReadonlyArray<SettingsRun>,
  known: ReadonlyMap<string, string> | undefined,
  refusedIn: ReadonlyMap<SectionId, string>,
): ReadonlyMap<SectionId, string> {
  const problems = new Map<SectionId, string>()
  const unreadable = rows.filter((row) => row.unreadable !== undefined)
  if (unreadable.length > 0) {
    problems.set('repositories', `${unreadable.map((row) => row.path).join(', ')} cannot be read`)
  }
  if (data.problems.size > 0) problems.set('preparation', 'a step cannot be done')
  if (runs.some((run) => run.kind === 'live' && run.state === 'failed')) {
    problems.set('services', 'a service failed')
  }
  for (const [id, sentence] of known ?? []) {
    const chosen = sectionChosen(id)
    if (chosen !== null) problems.set(chosen, sentence)
  }
  for (const [id, sentence] of refusedIn) problems.set(id, sentence)
  return problems
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
  setUp,
  ticketSection,
  section: first,
  problems: known,
}: SettingsPageProps): ReactNode {
  const [current, setCurrent] = useState<SectionId>(() => {
    return (first === undefined ? null : sectionChosen(first)) ?? 'repositories'
  })
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

  const refusalOf = useLineChecks(tools.checkLine, linesOf(writing))

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

  const now = new Date()
  const rows = repositories.map((repository) =>
    repositoryRowOf(repository, data.reads.get(repository.id) ?? {}, now),
  )
  const stepRows = stepRowsOf(recipe, repositories, catalogue, data.problems)
  const steps =
    order === null ? stepRows : order.flatMap((id) => stepRows.filter((step) => step.id === id))
  const runs = runRowsOf(
    data.runs.kind === 'ready' ? data.runs.value : [],
    catalogue,
    repositories,
    data.outputs,
  )
  const places = repositories.map((one) => one.path).filter((path) => path !== '.')

  const problems = problemsOf(data, rows, runs, known, refusedIn)
  const sections = SECTIONS.map(({ id, label, icon }) => ({
    id,
    label,
    icon,
    problem: problems.get(id),
  }))

  const unread = [data.project, data.catalogue, data.recipe, data.variables, data.runs].find(
    (one) => one.kind === 'failed',
  )

  const form = formOf(
    {
      data,
      settings,
      tools,
      project,
      repositories,
      catalogue,
      recipe,
      rows,
      places,
      remotes,
      refusals,
      saving,
      refusalOf,
      setWriting,
      saveWith,
      close,
    },
    writing,
  )

  const body = sectionBody(current, {
    data,
    settings,
    tools,
    project,
    repositories,
    catalogue,
    recipe,
    rows,
    steps,
    runs,
    agentSection,
    ticketSection,
    showForm: setAgentForm,
    act,
    open,
    openRepository,
    reorder,
  })

  return (
    <ProjectSettings
      name={project?.name ?? ''}
      mainCheckout={project?.mainCheckout ?? ''}
      sections={sections}
      current={current}
      onSection={(id) => {
        const chosen = sectionChosen(id)
        if (chosen !== null) setCurrent(chosen)
      }}
      error={unread?.kind === 'failed' ? unread.sentence : undefined}
      onRetry={() => settings?.retry()}
      setUp={setUp}
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
