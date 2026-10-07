/**
 * The agent and permission sections of a Project's settings (#53), over the link: Never run, the
 * model of each role, the cap and the budget, the instruction files. Each section reads when it is
 * shown and writes what the user changes; a write the engine answers after a later one is dropped,
 * so the last change made is the one shown. No Effect here: the link's calls are promises.
 */

import type { NeverEntry } from '@hemera/core/domain'
import type { AgentState, Command, ModelMark, ProjectLimits, RoleModels } from '@hemera/ipc'
import {
  BudgetSection,
  FormFoot,
  InstructionsSection,
  NeverForm,
  NeverSection,
  RoleModelsSection,
  type SettingsForm,
} from '@hemera/ui'
import { IconBan } from '@hemera/ui/icons'
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'

import { pickerAgentsOf } from './chat-items.ts'
import type { Link } from './link.ts'
import {
  instructionsOf,
  limitRefusal,
  limitRowsOf,
  limitsWith,
  neverLinesOf,
  neverRefusalOf,
  projectRoleModelsOf,
  withNever,
  withoutNever,
} from './project-agents.ts'
import { useRead } from './use-read.ts'

export const AGENT_SECTIONS = ['never', 'models', 'budget', 'instructions'] as const
export type AgentSectionId = (typeof AGENT_SECTIONS)[number]

export const isAgentSection = (id: string): id is AgentSectionId =>
  AGENT_SECTIONS.some((one) => one === id)

const nothing = (): void => undefined

const readAgents = (link: Link) => link.agents()
const readMarks = (link: Link) => link.modelMarks()

/** How long a limit's field waits for the typing to settle before it is written. */
const TYPING_SETTLES_MS = 600

/** Runs writes one after the other's answer is known: only the latest one's answer is kept. */
function useLatest(): <A>(write: () => Promise<A>, kept: (answer: A) => void) => void {
  const latest = useRef(0)
  return (write, kept) => {
    latest.current += 1
    const mine = latest.current
    write().then((answer) => {
      if (mine === latest.current) kept(answer)
    }, nothing)
  }
}

interface PartProps {
  link: Link
  engineReady: boolean
  projectId: string
}

interface NeverPartProps extends PartProps {
  catalogue: ReadonlyArray<Command>
  /** Shows the page's dialog with this form, or closes it with null. */
  show: (form: SettingsForm | null) => void
}

/** What the dialog that adds a line holds: the line, and what its last save was told. */
interface NeverDraft {
  readonly line: string
  /** Whether Add was pressed: the line's refusal shows from then on. */
  readonly tried: boolean
  /** Why the engine refused the last save. */
  readonly refused?: string | undefined
}

/**
 * The dialog's draft, held outside React's state so its field and its foot read it in the same
 * render as the keystroke: a draft passed to the page's dialog through an effect lags one render
 * behind, and the field then drops what is typed fast.
 */
interface DraftStore {
  readonly get: () => NeverDraft
  readonly set: (change: Partial<NeverDraft>) => void
  readonly subscribe: (listener: () => void) => () => void
}

function draftStore(): DraftStore {
  let draft: NeverDraft = { line: '', tried: false }
  const listeners = new Set<() => void>()
  return {
    get: () => draft,
    set: (change) => {
      draft = { ...draft, ...change }
      for (const listener of listeners) listener()
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

interface NeverDialogProps {
  store: DraftStore
  refusalOf: (line: string) => string | undefined
}

function NeverField({ store, refusalOf }: NeverDialogProps): ReactNode {
  const draft = useSyncExternalStore(store.subscribe, store.get)
  return (
    <NeverForm
      value={draft.line}
      onChange={(line) => store.set({ line })}
      error={draft.tried ? refusalOf(draft.line) : undefined}
    />
  )
}

function NeverFoot({
  store,
  refusalOf,
  onAdd,
  onCancel,
}: NeverDialogProps & { onAdd: (line: string) => void; onCancel: () => void }): ReactNode {
  const draft = useSyncExternalStore(store.subscribe, store.get)
  return (
    <FormFoot
      refused={draft.refused}
      save="Add"
      onSave={() => {
        store.set({ tried: true })
        if (refusalOf(draft.line) === undefined) onAdd(draft.line)
      }}
      onCancel={onCancel}
    />
  )
}

function NeverPart({ link, engineReady, projectId, catalogue, show }: NeverPartProps): ReactNode {
  const read = useCallback((ready: Link) => ready.neverList(projectId), [projectId])
  const [entries, setEntries] = useRead<ReadonlyArray<NeverEntry>>(link, engineReady, read)
  const written = useLatest()
  /** The list as last changed here, so two quick changes build on each other. */
  const current = useRef<ReadonlyArray<NeverEntry> | null>(null)
  const catalogueNow = useRef(catalogue)
  // Kept up after each render, for the dialog's handlers, which outlive the render they came from.
  useEffect(() => {
    current.current = entries
    catalogueNow.current = catalogue
  }, [entries, catalogue])

  const write = (
    next: ReadonlyArray<NeverEntry>,
    done: () => void,
    refused: (sentence: string) => void,
  ): void => {
    current.current = next
    setEntries(next)
    written(
      () =>
        link.setNeverList(projectId, next).catch((failure: Error) => {
          refused(failure.message)
          throw failure
        }),
      (answer) => {
        setEntries(answer)
        done()
      },
    )
  }

  const open = (): void => {
    const store = draftStore()
    // Read against the list as last changed here: a second Add of the line is refused.
    const refusalOf = (line: string) =>
      neverRefusalOf(line, current.current ?? [], catalogueNow.current)
    const close = (): void => show(null)
    show({
      title: 'Never run',
      icon: <IconBan size="sm" />,
      body: <NeverField store={store} refusalOf={refusalOf} />,
      footer: (
        <NeverFoot
          store={store}
          refusalOf={refusalOf}
          onAdd={(line) =>
            write(withNever(current.current ?? [], line), close, (refused) =>
              store.set({ refused }),
            )
          }
          onCancel={close}
        />
      ),
    })
  }
  // A dialog left open over a section that is no longer shown closes with it.
  useEffect(() => () => show(null), [show])

  return (
    <NeverSection
      lines={neverLinesOf(entries ?? [], catalogue)}
      loading={entries === null}
      onAdd={open}
      onRemove={(id) => write(withoutNever(current.current ?? [], id), nothing, nothing)}
    />
  )
}

function ModelsPart({ link, engineReady, projectId }: PartProps): ReactNode {
  const readRoles = useCallback((ready: Link) => ready.roleModels(projectId), [projectId])
  const [roles, , rereadRoles] = useRead<ReadonlyArray<RoleModels>>(link, engineReady, readRoles)
  const [agents] = useRead<ReadonlyArray<AgentState>>(link, engineReady, readAgents)
  const [marks, , rereadMarks] = useRead<ReadonlyArray<ModelMark>>(link, engineReady, readMarks)
  const written = useLatest()
  const mark = (agent: string, model: string, change: Partial<ModelMark>): void => {
    const known = agents?.find((one) => one.id === agent)
    if (known === undefined) return
    const before = marks?.find((one) => one.agent === known.id && one.model === model)
    link
      .markModel({
        agent: known.id,
        model,
        favourite: before?.favourite ?? false,
        hidden: before?.hidden ?? false,
        ...change,
      })
      .then(rereadMarks, nothing)
  }
  const roleOf = (displayName: string) => roles?.find((one) => one.displayName === displayName)
  return (
    <RoleModelsSection
      roles={projectRoleModelsOf(roles ?? [])}
      agents={pickerAgentsOf(agents ?? [], marks ?? [], {
        agent: 'claude',
        model: null,
        effort: null,
      })}
      loading={roles === null}
      onChange={(displayName, choice) => {
        const role = roleOf(displayName)
        if (role === undefined) return
        const agent = choice === null ? undefined : agents?.find((one) => one.id === choice.agent)
        const setting =
          choice === null || agent === undefined
            ? null
            : {
                agent: agent.id,
                model: choice.model === 'default' ? null : choice.model,
                effort: choice.effort ?? null,
              }
        if (choice !== null && setting === null) return
        written(() => link.setProjectRoleModel(projectId, role.role, setting), rereadRoles)
      }}
      onFavourite={(agent, model, favourite) => mark(agent, model, { favourite })}
      onHide={(agent, model, hidden) => mark(agent, model, { hidden })}
    />
  )
}

function BudgetPart({ link, engineReady, projectId }: PartProps): ReactNode {
  const read = useCallback((ready: Link) => ready.projectLimits(projectId), [projectId])
  const [limits, setLimits] = useRead<ProjectLimits>(link, engineReady, read)
  /** What each field holds while it is typed in, before it is written. */
  const [typed, setTyped] = useState<ReadonlyMap<string, string | null>>(new Map())
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** The write waiting for the typing to settle: done at once when the section is left. */
  const pending = useRef<(() => void) | null>(null)
  const written = useLatest()
  const flush = (): void => {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
    const write = pending.current
    pending.current = null
    write?.()
  }
  // Leaving the section writes what was typed rather than dropping it.
  useEffect(() => () => flush(), [])
  const rows = limits === null ? [] : limitRowsOf(limits)
  return (
    <BudgetSection
      limits={rows.map((row) =>
        typed.has(row.id) ? Object.assign(row, { value: typed.get(row.id) ?? null }) : row,
      )}
      loading={limits === null}
      onLimit={(id, value) => {
        const next = new Map(typed).set(id, value)
        setTyped(next)
        if (limits === null) return
        // Every field typed in since the last write goes in this one, each still to be valid.
        const valid = [...next].filter(([field, held]) => limitRefusal(field, held) === undefined)
        pending.current =
          valid.length === 0
            ? null
            : () =>
                written(
                  () =>
                    link.setProjectLimits(
                      projectId,
                      valid.reduce(
                        (built, [field, held]) => limitsWith(built, field, held),
                        limits,
                      ),
                    ),
                  (answer) => {
                    setLimits(answer)
                    setTyped((before) => {
                      const left = new Map(before)
                      for (const [field] of valid) left.delete(field)
                      return left
                    })
                  },
                )
        if (timer.current !== null) clearTimeout(timer.current)
        timer.current = setTimeout(flush, TYPING_SETTLES_MS)
      }}
      refusalOf={limitRefusal}
    />
  )
}

function InstructionsPart({ link, engineReady, projectId }: PartProps): ReactNode {
  const read = useCallback((ready: Link) => ready.instructionFiles(projectId), [projectId])
  const [rows] = useRead(link, engineReady, read)
  const [agents] = useRead<ReadonlyArray<AgentState>>(link, engineReady, readAgents)
  const shown = instructionsOf(rows ?? [], agents ?? [])
  return (
    <InstructionsSection
      repositories={shown.repositories}
      agents={shown.agents}
      loading={rows === null || agents === null}
      // No call of the engine opens a file yet.
      onOpen={nothing}
    />
  )
}

export interface AgentSectionProps extends NeverPartProps {
  section: AgentSectionId
}

/** The agent or permission section chosen in a Project's settings. */
export function AgentSection({ section, ...props }: AgentSectionProps): ReactNode {
  switch (section) {
    case 'never':
      return <NeverPart {...props} />
    case 'models':
      return <ModelsPart {...props} />
    case 'budget':
      return <BudgetPart {...props} />
    case 'instructions':
      return <InstructionsPart {...props} />
  }
}
