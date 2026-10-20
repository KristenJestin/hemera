import {
  CommandForm,
  FormFoot,
  RepositoryForm,
  StepForm,
  VariableForm,
  typeIcon,
  type RemoteChoice,
  type RepositoryDraft,
  type SettingsForm,
  type SettingsRepository,
  type StepDraft,
} from '@hemera/ui'
import { IconGitBranch, IconListNumbers, IconVariable } from '@hemera/ui/icons'
import type { Command, Project, RecipeStep, Repository } from '@hemera/ipc'
import type { Dispatch, ReactNode, SetStateAction } from 'react'

import type { Settings, SettingsData } from './settings-data.ts'
import { commandDraftOf, recipeDraftOf, recipeDraftOfStep, stepDraftOf } from './settings-model.ts'
import { inMainCheckout } from './settings-paths.ts'
import {
  commandRefusal,
  repositoryRefusal,
  sentenceOf,
  stepRefusal,
  variableRefusal,
} from './settings-refusals.ts'
import type { Refusals, SettingsTools, Writing } from './settings-types.ts'

/** What the dialogs of the page need of the page: the settings it reads and the dialog it holds. */
export interface FormContext {
  readonly data: SettingsData
  readonly settings: Settings | null
  readonly tools: SettingsTools
  readonly project: Project | null
  readonly repositories: ReadonlyArray<Repository>
  readonly catalogue: ReadonlyArray<Command>
  readonly recipe: ReadonlyArray<RecipeStep>
  readonly rows: ReadonlyArray<SettingsRepository>
  /** The places a command or a step may run in: the repositories' folders, but the main one. */
  readonly places: ReadonlyArray<string>
  readonly remotes: ReadonlyMap<string, ReadonlyArray<RemoteChoice>>
  readonly refusals: Refusals
  readonly saving: boolean
  readonly refusalOf: (line: string) => string | undefined
  readonly setWriting: Dispatch<SetStateAction<Writing | null>>
  /** Runs a save: the dialog closes when it is written, and says why when it is refused. */
  readonly saveWith: (write: () => Promise<void>, refusal: (failure: Error) => Refusals) => void
  readonly close: () => void
}

type Of<Kind extends Writing['kind']> = Extract<Writing, { readonly kind: Kind }>

function foot(
  context: FormContext,
  what: string | null,
  onSave: () => void,
  onRemove: () => void,
): ReactNode {
  return (
    <FormFoot
      refused={context.refusals.foot}
      remove={what === null ? undefined : `Remove ${what}`}
      onRemove={onRemove}
      save={what === null ? 'Add' : 'Save'}
      saving={context.saving}
      onSave={onSave}
      onCancel={context.close}
    />
  )
}

function saveRepository(context: FormContext, id: string | null, draft: RepositoryDraft): void {
  const { settings, repositories, saveWith } = context
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

function writeSteps(
  context: FormContext,
  steps: ReadonlyArray<ReturnType<typeof recipeDraftOfStep>>,
  position: number,
  draft: StepDraft,
): void {
  const { settings, saveWith } = context
  if (settings === null) return
  saveWith(
    () => settings.saveRecipe(steps),
    (failure) => stepRefusal(failure, draft, position),
  )
}

function repositoryForm(context: FormContext, writing: Of<'repository'>): SettingsForm {
  const { rows, remotes, refusals, tools, project, settings, saveWith, setWriting } = context
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
              shown?.kind === 'repository' ? { ...shown, draft: { ...shown.draft, path } } : shown,
            )
          })
        }}
      />
    ),
    footer: foot(
      context,
      writing.id === null ? null : (row?.path ?? null),
      () => saveRepository(context, writing.id, writing.draft),
      () => {
        if (writing.id === null || settings === null) return
        const id = writing.id
        saveWith(() => settings.removeRepository(id), repositoryRefusal)
      },
    ),
  }
}

function commandForm(context: FormContext, writing: Of<'command'>): SettingsForm {
  const { catalogue, repositories, places, refusalOf, refusals, settings, saveWith, setWriting } =
    context
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
      context,
      writing.id === null ? null : (previous?.name ?? writing.draft.name),
      () => {
        if (settings === null) return
        saveWith(
          () =>
            settings.saveCommand(writing.id, commandDraftOf(writing.draft, previous, repositories)),
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

function stepForm(context: FormContext, writing: Of<'step'>): SettingsForm {
  const { recipe, repositories, catalogue, places, refusalOf, refusals, data, setWriting } = context
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
      context,
      writing.id === null ? null : `step ${String(position)}`,
      () =>
        writeSteps(
          context,
          at === -1 ? [...drafts, saved] : drafts.toSpliced(at, 1, saved),
          position,
          writing.draft,
        ),
      () => writeSteps(context, drafts.toSpliced(at, 1), position, writing.draft),
    ),
  }
}

function variableForm(context: FormContext, writing: Of<'variable'>): SettingsForm {
  const { refusals, settings, saveWith, setWriting } = context
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
      context,
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

/** The dialog a page's `writing` is: its title, its fields and its foot. */
export function formOf(context: FormContext, writing: Writing | null): SettingsForm | null {
  if (writing === null) return null
  switch (writing.kind) {
    case 'repository':
      return repositoryForm(context, writing)
    case 'command':
      return commandForm(context, writing)
    case 'step':
      return stepForm(context, writing)
    case 'variable':
      return variableForm(context, writing)
  }
}
