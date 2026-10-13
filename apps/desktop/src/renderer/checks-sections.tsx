/**
 * The Checks and Documentation sections of a Project's settings (#152), as #150 drew them: each a
 * list the engine keeps in order, the defaults it proposes while the list is empty (nothing kept
 * before it is accepted), and the dialog that writes, mends or removes one, every refusal said in
 * the engine's words under the field it concerns. A check's free line is also asked about as it is
 * typed. A dialog's draft is held outside React's state, so its body and its foot read it in the
 * same render. How long a proof may run (#321) stands under the checks, written once the typing
 * settles, as the Cap and budget fields are. No Effect here.
 */

import { DEFAULT_PROOF_MINUTES } from '@hemera/core/domain'
import type {
  CheckDraft as EngineCheckDraft,
  Command,
  DocRecipe,
  DocRecipeDraft as EngineDocRecipeDraft,
  Project,
  ProjectCheck,
} from '@hemera/ipc'
import {
  CheckForm,
  ChecksSection,
  DocRecipeForm,
  DocRecipesSection,
  FormFoot,
  NEW_CHECK,
  NEW_DOC_RECIPE,
  recipeName,
  type CheckDraft,
  type CheckRefusals,
  type DocRecipeDraft,
  type DocRecipeRefusals,
  type ProofLimitField,
  type SettingsForm,
} from '@hemera/ui'
import { IconBook2, IconChecklist } from '@hemera/ui/icons'
import { type ReactNode, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'

import {
  type Said,
  checkChoicesOf,
  checkDraftOf,
  checkFormOf,
  checkRefusalsOf,
  docRecipeDraftOf,
  docRecipeFormOf,
  docRecipeRefusalsOf,
  proofLimitRefusalOf,
  proofLimitWordsOf,
  proposedChecksOf,
  proposedDocRecipesOf,
  settingsCheckOf,
  settingsDocRecipeOf,
} from './checks-model.ts'
import type { Link } from './link.ts'
import { latestWrites } from './project-agents.ts'
import {
  type ListOps,
  type ListState,
  acceptProposals,
  readKept,
  readList,
  writeOrder,
} from './settings-list.ts'
import { type ProviderStore, providerStore } from './ticket-providers-model.ts'

export interface ChecksPartProps {
  link: Link
  engineReady: boolean
  projectId: string
  project: Project | null
  catalogue: ReadonlyArray<Command>
  /** Shows a dialog over the page, or closes it with null. */
  show: (form: SettingsForm | null) => void
}

/** How long a reorder waits for the moving to settle before it is written. */
const MOVING_SETTLES_MS = 600

/** How long the time limit's field waits for the typing to settle before it is written. */
const TYPING_SETTLES_MS = 600

/** `{files}` is Hemera's to fill: the line is asked about without it. */
const FILES = '{files}'

function useStored<T extends object>(store: ProviderStore<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get)
}

interface SettingsList<Kept, Draft> {
  readonly store: ProviderStore<ListState<Kept, Draft>>
  readonly state: ListState<Kept, Draft>
  readonly reorder: (ids: string[]) => void
}

/**
 * A list of the settings, read while its section is there: its state, and the reorder that shows
 * an order at once and writes it once the moving settles.
 */
function useSettingsList<Kept extends { readonly id: string }, Draft>(
  ops: ListOps<Kept, Draft>,
  engineReady: boolean,
): SettingsList<Kept, Draft> {
  const [store] = useState(() =>
    providerStore<ListState<Kept, Draft>>({
      kept: null,
      proposals: [],
      order: null,
      error: undefined,
    }),
  )
  const moving = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (engineReady) readList(ops, store)
  }, [ops, engineReady, store])
  useEffect(
    () => () => {
      if (moving.current !== null) clearTimeout(moving.current)
    },
    [],
  )
  const reorder = (ids: string[]): void => {
    store.set({ order: ids })
    if (moving.current !== null) clearTimeout(moving.current)
    moving.current = setTimeout(() => void writeOrder(ops, store, ids), MOVING_SETTLES_MS)
  }
  return { store, state: useStored(store), reorder }
}

/** The kept lines in the order shown: the one being written while a reorder settles. */
function inOrder<Kept extends { readonly id: string }>(
  kept: ReadonlyArray<Kept> | null,
  order: ReadonlyArray<string> | null,
): ReadonlyArray<Kept> | null {
  if (kept === null || order === null) return kept
  return order.flatMap((id) => kept.filter((one) => one.id === id))
}

/** What a dialog holds: the draft, whether it is being written, and what the engine refused. */
interface Edit<Draft, Refusals> {
  readonly draft: Draft
  readonly saving: boolean
  readonly said: Said<Refusals>
}

const NOTHING_SAID = { fields: {}, foot: undefined }

/** The foot of a dialog: save, cancel, and remove for one already kept. */
function Foot<Draft, Refusals>({
  edit,
  remove,
  onSave,
  onRemove,
  refusalOf,
  close,
}: {
  edit: ProviderStore<Edit<Draft, Refusals>>
  /** The words of the remove button, for one already kept. */
  remove: string | undefined
  onSave: (draft: Draft) => Promise<void>
  onRemove: () => Promise<void>
  /** Where the engine's refusal is said: under a field, or at the foot. */
  refusalOf: (failure: Error) => Said<Refusals>
  close: () => void
}): ReactNode {
  const mine = useStored(edit)
  /** The dialog closes once written, and says why when the engine refuses. */
  const run = (write: () => Promise<void>): void => {
    edit.set({ saving: true })
    write().then(close, (failure: Error) => edit.set({ saving: false, said: refusalOf(failure) }))
  }
  return (
    <FormFoot
      refused={mine.said.foot}
      remove={remove}
      onRemove={() => run(onRemove)}
      save={remove === undefined ? 'Add' : 'Save'}
      saving={mine.saving}
      onSave={() => run(() => onSave(mine.draft))}
      onCancel={close}
    />
  )
}

/** A check's form: the engine's refusals, and what it refuses in a free line as it is typed. */
function CheckBody({
  link,
  edit,
  commands,
  places,
}: {
  link: Link
  edit: ProviderStore<Edit<CheckDraft, CheckRefusals>>
  commands: ReturnType<typeof checkChoicesOf>
  places: ReadonlyArray<string>
}): ReactNode {
  const mine = useStored(edit)
  const line = mine.draft.command === null ? (mine.draft.line ?? '').trim() : ''
  const [typed, setTyped] = useState<{ line: string; problem: string | null } | null>(null)
  useEffect(() => {
    if (line === '') return undefined
    let current = true
    link.checkLine(line.replaceAll(FILES, 'files')).then(
      ({ problem }) => {
        if (current) setTyped({ line, problem })
      },
      () => undefined,
    )
    return () => {
      current = false
    }
  }, [link, line])
  const asTyped = typed?.line === line ? (typed.problem ?? undefined) : undefined
  return (
    <CheckForm
      draft={mine.draft}
      // What was refused is said until the draft changes.
      onChange={(draft) => edit.set({ draft, said: NOTHING_SAID })}
      commands={commands}
      places={places}
      refusals={{ ...mine.said.fields, line: mine.said.fields.line ?? asTyped }}
    />
  )
}

/**
 * How long a proof of the Project may run: read with the section, what is typed shown at once and
 * written once the typing settles, if it can be; leaving the section writes it rather than drop it.
 */
function useProofLimit(link: Link, engineReady: boolean, projectId: string): ProofLimitField {
  /** What the engine keeps: undefined while on its way, null for the default. */
  const [kept, setKept] = useState<number | null | undefined>(undefined)
  /** What the field holds while it is typed in, before it is written. */
  const [typed, setTyped] = useState<{ value: string | null } | null>(null)
  /** Why it could not be read or kept, in words. */
  const [refused, setRefused] = useState<string | undefined>(undefined)
  const [written] = useState(latestWrites)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pending = useRef<(() => void) | null>(null)
  useEffect(() => {
    if (!engineReady) return undefined
    let live = true
    link.proofLimit(projectId).then(
      (minutes) => {
        if (live) setKept(minutes)
      },
      (failure: Error) => {
        if (live) setRefused(`The time limit could not be read: ${failure.message}`)
      },
    )
    return () => {
      live = false
    }
  }, [link, engineReady, projectId])
  const flush = (): void => {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
    const write = pending.current
    pending.current = null
    write?.()
  }
  useEffect(() => () => flush(), [])
  const value =
    typed === null ? (kept === null || kept === undefined ? null : String(kept)) : typed.value
  return {
    value,
    fallback: DEFAULT_PROOF_MINUTES,
    error: proofLimitRefusalOf(value) ?? refused,
    loading: kept === undefined && refused === undefined,
    onChange: (next) => {
      setTyped({ value: next })
      setRefused(undefined)
      pending.current =
        proofLimitRefusalOf(next) !== undefined
          ? null
          : () =>
              written(
                () => link.setProofLimit(projectId, next === null ? null : Number(next.trim())),
                (answer) => {
                  setKept(answer)
                  setTyped(null)
                },
                (failure) => {
                  // The field goes back to what the engine keeps, and says why.
                  setTyped(null)
                  setRefused(proofLimitWordsOf(failure))
                },
              )
      if (timer.current !== null) clearTimeout(timer.current)
      timer.current = setTimeout(flush, TYPING_SETTLES_MS)
    },
  }
}

/** The checks of a Project: what Hemera runs to judge the work, and when. */
export function ChecksPart({
  link,
  engineReady,
  projectId,
  project,
  catalogue,
  show,
}: ChecksPartProps): ReactNode {
  const ops = useMemo<ListOps<ProjectCheck, EngineCheckDraft>>(
    () => ({
      list: () => link.checks(projectId),
      propose: () => link.proposeChecks(projectId),
      accept: (drafts) => link.acceptChecks(projectId, drafts),
      move: (id, rank) => link.moveCheck(projectId, id, rank),
      unread: 'The checks could not be read',
    }),
    [link, projectId],
  )
  const { store, state, reorder } = useSettingsList(ops, engineReady)
  const proofLimit = useProofLimit(link, engineReady, projectId)
  // A dialog left open over a section that is no longer shown closes with it.
  useEffect(() => () => show(null), [show])
  const places = (project?.repositories ?? []).map((one) => one.path).filter((one) => one !== '.')
  const checks = inOrder(state.kept, state.order)?.map((one) => settingsCheckOf(one, catalogue))

  const close = (): void => show(null)
  const open = (id: string | null): void => {
    const kept = state.kept?.find((one) => one.id === id)
    if (id !== null && kept === undefined) return
    const edit = providerStore<Edit<CheckDraft, CheckRefusals>>({
      draft: kept === undefined ? NEW_CHECK : checkFormOf(settingsCheckOf(kept, catalogue)),
      saving: false,
      said: NOTHING_SAID,
    })
    show({
      title: kept?.name ?? 'Add a check',
      icon: <IconChecklist size="sm" />,
      body: (
        <CheckBody link={link} edit={edit} commands={checkChoicesOf(catalogue)} places={places} />
      ),
      footer: (
        <Foot
          edit={edit}
          remove={kept === undefined ? undefined : `Remove ${kept.name}`}
          onSave={(draft) =>
            link.saveCheck(projectId, id, checkDraftOf(draft)).then(() => readKept(ops, store))
          }
          onRemove={() => link.removeCheck(projectId, id ?? '').then(() => readKept(ops, store))}
          refusalOf={checkRefusalsOf}
          close={close}
        />
      ),
    })
  }
  return (
    <ChecksSection
      checks={checks ?? null}
      proposals={proposedChecksOf(state.proposals, catalogue)}
      error={state.error}
      proofLimit={proofLimit}
      onOpen={open}
      onAdd={() => open(null)}
      onReorder={reorder}
      onAccept={(id) => void acceptProposals(ops, store, [id])}
      onAcceptAll={() =>
        void acceptProposals(
          ops,
          store,
          state.proposals.map((one) => one.id),
        )
      }
    />
  )
}

export type DocRecipesPartProps = Omit<ChecksPartProps, 'catalogue'>

/** The doc recipes of a Project: the files the documenter keeps in line with the code. */
export function DocRecipesPart({
  link,
  engineReady,
  projectId,
  project,
  show,
}: DocRecipesPartProps): ReactNode {
  const ops = useMemo<ListOps<DocRecipe, EngineDocRecipeDraft>>(
    () => ({
      list: () => link.docRecipes(projectId),
      propose: () => link.proposeDocRecipes(projectId),
      accept: (drafts) => link.acceptDocRecipes(projectId, drafts),
      move: (id, rank) => link.moveDocRecipe(projectId, id, rank),
      unread: 'The recipes could not be read',
    }),
    [link, projectId],
  )
  const { store, state, reorder } = useSettingsList(ops, engineReady)
  useEffect(() => () => show(null), [show])
  const places = (project?.repositories ?? []).map((one) => one.path).filter((one) => one !== '.')
  const recipes = inOrder(state.kept, state.order)?.map(settingsDocRecipeOf)

  const close = (): void => show(null)
  const open = (id: string | null): void => {
    const kept = state.kept?.find((one) => one.id === id)
    if (id !== null && kept === undefined) return
    const shown = kept === undefined ? undefined : settingsDocRecipeOf(kept)
    const edit = providerStore<Edit<DocRecipeDraft, DocRecipeRefusals>>({
      draft: shown === undefined ? NEW_DOC_RECIPE : docRecipeFormOf(shown),
      saving: false,
      said: NOTHING_SAID,
    })
    show({
      title: shown === undefined ? 'Add a recipe' : recipeName(shown),
      icon: <IconBook2 size="sm" />,
      body: <DocRecipeBody edit={edit} places={places} />,
      footer: (
        <Foot
          edit={edit}
          remove={shown === undefined ? undefined : `Remove ${recipeName(shown)}`}
          onSave={(draft) =>
            link
              .saveDocRecipe(projectId, id, docRecipeDraftOf(draft))
              .then(() => readKept(ops, store))
          }
          onRemove={() =>
            link.removeDocRecipe(projectId, id ?? '').then(() => readKept(ops, store))
          }
          refusalOf={docRecipeRefusalsOf}
          close={close}
        />
      ),
    })
  }
  return (
    <DocRecipesSection
      recipes={recipes ?? null}
      proposals={proposedDocRecipesOf(state.proposals)}
      error={state.error}
      onOpen={open}
      onAdd={() => open(null)}
      onReorder={reorder}
      onAccept={(id) => void acceptProposals(ops, store, [id])}
      onAcceptAll={() =>
        void acceptProposals(
          ops,
          store,
          state.proposals.map((one) => one.id),
        )
      }
    />
  )
}

function DocRecipeBody({
  edit,
  places,
}: {
  edit: ProviderStore<Edit<DocRecipeDraft, DocRecipeRefusals>>
  places: ReadonlyArray<string>
}): ReactNode {
  const mine = useStored(edit)
  return (
    <DocRecipeForm
      draft={mine.draft}
      onChange={(draft) => edit.set({ draft, said: NOTHING_SAID })}
      places={places}
      refusals={mine.said.fields}
    />
  )
}
