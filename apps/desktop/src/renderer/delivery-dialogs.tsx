/**
 * The dialogs of the delivery rules (#465), as #250 drew them: a template, Push and open, the
 * reviewers, a repository's remote, base and forge, a step of a recipe or of the cleanup. Each
 * holds its draft in a store, so its body and its foot read it in the same render; its save
 * writes the rules (or the Project, or the forge) and closes it, or says why it cannot.
 */

import type { DeliveryAction, DeliveryMoment } from '@hemera/core/domain'
import type { Command, ForcedForge, ForgeName, Project } from '@hemera/ipc'
import {
  CATALOGUE,
  DeliveryRepositoryForm,
  DeliveryStepForm,
  FormFoot,
  MOMENT_WORDS,
  PushForm,
  ReviewersForm,
  STEP_WORDS,
  TemplateForm,
  filled,
  newStep,
  templateRefusal,
  type DeliveryRepositoryDraft,
  type DeliveryRulesShown,
  type DeliveryStepDraft,
  type DeliveryTarget,
  type ForgeKind,
  type Moment,
  type PushDraft,
  type Reviewer,
  type SettingsForm,
} from '@hemera/ui'
import { IconGitMerge } from '@hemera/ui/icons'
import { type ReactNode, useSyncExternalStore } from 'react'

import { type ProviderStore, providerStore } from './ticket-providers-model.ts'

/** What a dialog holds: its draft, whether it is being written, and why it was refused. */
interface Dialog<Draft> {
  readonly draft: Draft
  readonly saving: boolean
  readonly refused: string | undefined
}

type Store<Draft> = ProviderStore<Dialog<Draft>>

function useStored<T extends object>(store: ProviderStore<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get)
}

const MOMENTS: Readonly<Record<Moment, DeliveryMoment>> = {
  tasks: 'tasks',
  review: 'preparation',
  waves: 'waves',
}

const FORCED: Readonly<Record<Exclude<ForgeKind, 'none'>, ForcedForge>> = {
  github: 'github',
  'bitbucket-cloud': 'bitbucket-cloud',
  'bitbucket-dc': 'bitbucket-datacenter',
}

/** What the dialogs ask of the section that opens them. */
export interface DialogContext {
  readonly rules: DeliveryRulesShown
  readonly project: Project
  readonly catalogue: ReadonlyArray<Command>
  /** Each repository's forge, by id, as the engine reads it. */
  readonly forgeOf: (repositoryId: string) => ForgeName
  /** The engine's action of a repository's step, or of the cleanup when the repository is null. */
  readonly actionOf: (repositoryId: string | null, stepId: string) => DeliveryAction | undefined
  /** A step of a form, as the engine keeps it. */
  readonly toAction: (
    draft: DeliveryStepDraft,
    id: string,
    forge: ForgeName,
    before: DeliveryAction | undefined,
  ) => DeliveryAction
  readonly edit: {
    readonly template: (kind: 'commit' | 'title' | 'body', value: string) => Promise<void>
    readonly push: (draft: PushDraft) => Promise<void>
    readonly reviewers: (reviewers: ReadonlyArray<Reviewer>) => Promise<void>
    readonly repository: (repositoryId: string, draft: DeliveryRepositoryDraft) => Promise<void>
    readonly stepSaved: (repositoryId: string, step: DeliveryAction) => Promise<void>
    readonly stepRemoved: (repositoryId: string, stepId: string) => Promise<void>
    readonly stepAdded: (
      repositoryId: string,
      moment: DeliveryMoment,
      after: string | null | undefined,
      step: DeliveryAction,
    ) => Promise<void>
    readonly cleanupSaved: (step: DeliveryAction) => Promise<void>
    readonly cleanupAdded: (step: DeliveryAction) => Promise<void>
  }
  /** The remotes of a repository, read when its dialog opens. */
  readonly remotesOf: (repositoryId: string) => Promise<ReadonlyArray<string>>
  readonly close: () => void
}

/** The foot of a dialog: the save runs the write, closes once it is done, or says why not. */
function Foot<Draft>({
  store,
  write,
  save,
  remove,
  onRemove,
  close,
}: {
  store: Store<Draft>
  /** Answers false when the dialog stays open, its form saying why. */
  write: (draft: Draft) => Promise<boolean>
  save?: string | undefined
  remove?: string | undefined
  onRemove?: (() => Promise<void>) | undefined
  close: () => void
}): ReactNode {
  const mine = useStored(store)
  const run = (written: () => Promise<boolean>): void => {
    store.set({ saving: true, refused: undefined })
    written().then(
      (done) => {
        store.set({ saving: false })
        if (done) close()
      },
      (failure: Error) => store.set({ saving: false, refused: failure.message }),
    )
  }
  return (
    <FormFoot
      refused={mine.refused}
      save={save}
      saving={mine.saving}
      remove={remove}
      onRemove={onRemove === undefined ? undefined : () => run(() => onRemove().then(() => true))}
      onSave={() => run(() => write(mine.draft))}
      onCancel={close}
    />
  )
}

const dialog = <Draft,>(draft: Draft): Store<Draft> =>
  providerStore<Dialog<Draft>>({ draft, saving: false, refused: undefined })

type Template = 'commit' | 'title' | 'body'

const TEMPLATE_LABELS: Readonly<Record<Template, string>> = {
  commit: 'Commit message',
  title: 'Pull request title',
  body: 'Pull request body',
}

function TemplateBody({ kind, store }: { kind: Template; store: Store<string> }): ReactNode {
  const { draft } = useStored(store)
  return (
    <TemplateForm
      label={TEMPLATE_LABELS[kind]}
      value={draft}
      multiline={kind === 'body'}
      refused={templateRefusal(draft)}
      example={filled(draft)}
      onChange={(next) => store.set({ draft: next, refused: undefined })}
    />
  )
}

function PushBody({ store }: { store: Store<PushDraft> }): ReactNode {
  const { draft } = useStored(store)
  return <PushForm draft={draft} onChange={(next) => store.set({ draft: next })} />
}

function ReviewersBody({ store }: { store: Store<Reviewer[]> }): ReactNode {
  const { draft } = useStored(store)
  // No forge call lists the reviewers a forge offers yet: only those chosen can be removed.
  return (
    <ReviewersForm chosen={draft} candidates={[]} onChange={(next) => store.set({ draft: next })} />
  )
}

interface RepositoryDialog {
  readonly form: DeliveryRepositoryDraft
  readonly remotes: ReadonlyArray<string>
}

function RepositoryBody({
  store,
  detected,
}: {
  store: Store<RepositoryDialog>
  detected: ForgeKind
}): ReactNode {
  const { draft } = useStored(store)
  return (
    <DeliveryRepositoryForm
      draft={draft.form}
      remotes={draft.remotes}
      detected={detected}
      refusals={{}}
      onChange={(form) => store.set({ draft: { ...draft, form }, refused: undefined })}
    />
  )
}

function StepBody({
  store,
  commands,
  refused,
  adding,
}: {
  store: Store<DeliveryStepDraft>
  commands: ReadonlyArray<string>
  refused: string | undefined
  adding: Parameters<typeof DeliveryStepForm>[0]['adding']
}): ReactNode {
  const { draft } = useStored(store)
  return (
    <DeliveryStepForm
      draft={draft}
      onChange={(next) => store.set({ draft: next })}
      commands={commands}
      refused={refused}
      adding={adding}
    />
  )
}

const icon = <IconGitMerge size="sm" />

function templateDialog(kind: Template, context: DialogContext): SettingsForm {
  const { rules, edit, close } = context
  const store = dialog(rules.pullRequests[kind])
  return {
    title: TEMPLATE_LABELS[kind],
    icon,
    body: <TemplateBody kind={kind} store={store} />,
    footer: (
      <Foot
        store={store}
        close={close}
        write={(value) =>
          // A name Hemera does not fill is said under the field, and the dialog stays.
          templateRefusal(value) === undefined
            ? edit.template(kind, value).then(() => true)
            : Promise.resolve(false)
        }
      />
    ),
  }
}

function repositoryDialog(path: string, context: DialogContext): SettingsForm | null {
  const { rules, project, edit, close } = context
  const shown = rules.repositories.find((one) => one.path === path)
  const repository = project.repositories.find((one) => one.path === path)
  if (shown === undefined || repository === undefined) return null
  const { forge } = shown
  const store = dialog<RepositoryDialog>({
    form: {
      remote: shown.remote,
      base: shown.base,
      forced: forge.forced && forge.kind !== 'none' ? forge.kind : null,
      host: forge.forced ? forge.host : '',
    },
    remotes: shown.remotes,
  })
  void context.remotesOf(repository.id).then(
    (remotes) => store.set({ draft: { ...store.get().draft, remotes } }),
    () => undefined,
  )
  return {
    title: path,
    icon,
    body: (
      <RepositoryBody
        store={store}
        detected={forge.forced || forge.kind === 'none' ? 'github' : forge.kind}
      />
    ),
    footer: (
      <Foot
        store={store}
        close={close}
        write={(draft) => edit.repository(repository.id, draft.form).then(() => true)}
      />
    ),
  }
}

/** The steps a new one may come after, each in its moment. */
const anchorsOf = (rules: DeliveryRulesShown, path: string) =>
  (rules.repositories.find((one) => one.path === path)?.steps ?? [])
    .filter((one) => one.origin !== 'omitted')
    .map((one) => ({
      id: one.step.id,
      label: STEP_WORDS[one.step.config.kind],
      moment: one.moment,
    }))

function stepDialog(
  form: Extract<DeliveryTarget, { kind: 'step' | 'add-step' }>,
  context: DialogContext,
): SettingsForm | null {
  const { rules, project, catalogue, edit, close } = context
  const repository = project.repositories.find((one) => one.path === form.repository)
  const shown = rules.repositories.find((one) => one.path === form.repository)
  if (repository === undefined || shown === undefined) return null
  const forge = context.forgeOf(repository.id)
  const commands = catalogue.map((one) => one.name)
  if (form.kind === 'add-step') {
    const store = dialog<DeliveryStepDraft>({ start: 'auto', config: newStep('command') })
    return {
      title: `New step · ${form.repository}`,
      icon,
      body: (
        <StepBody
          store={store}
          commands={commands}
          refused={undefined}
          adding={{ kinds: CATALOGUE, moments: true, after: anchorsOf(rules, form.repository) }}
        />
      ),
      footer: (
        <Foot
          store={store}
          close={close}
          save="Add"
          write={(draft) =>
            edit
              .stepAdded(
                repository.id,
                MOMENTS[draft.moment ?? 'waves'],
                draft.after,
                context.toAction(draft, '', forge, undefined),
              )
              .then(() => true)
          }
        />
      ),
    }
  }
  const existing = shown.steps.find((one) => one.step.id === form.id)
  const before = context.actionOf(repository.id, form.id)
  if (existing === undefined || before === undefined) return null
  const name = STEP_WORDS[existing.step.config.kind]
  const store = dialog<DeliveryStepDraft>({
    start: existing.step.start,
    config: existing.step.config,
  })
  return {
    title: `${name} · ${form.repository} · ${MOMENT_WORDS[existing.moment]}`,
    icon,
    body: (
      <StepBody store={store} commands={commands} refused={existing.refused} adding={undefined} />
    ),
    footer: (
      <Foot
        store={store}
        close={close}
        remove={
          existing.origin === 'added' ? `Remove ${name}` : `Leave out ${name} in ${form.repository}`
        }
        onRemove={() => edit.stepRemoved(repository.id, form.id)}
        write={(draft) =>
          edit
            .stepSaved(repository.id, context.toAction(draft, form.id, forge, before))
            .then(() => true)
        }
      />
    ),
  }
}

function cleanupDialog(
  form: Extract<DeliveryTarget, { kind: 'cleanup' | 'add-cleanup' }>,
  context: DialogContext,
): SettingsForm | null {
  const { rules, catalogue, edit, close } = context
  const commands = catalogue.map((one) => one.name)
  if (form.kind === 'add-cleanup') {
    const store = dialog<DeliveryStepDraft>({ start: 'auto', config: newStep('command') })
    return {
      title: 'New cleanup step',
      icon,
      body: (
        <StepBody
          store={store}
          commands={commands}
          refused={undefined}
          adding={{ kinds: CATALOGUE, after: [] }}
        />
      ),
      footer: (
        <Foot
          store={store}
          close={close}
          save="Add"
          write={(draft) =>
            edit.cleanupAdded(context.toAction(draft, '', 'unknown', undefined)).then(() => true)
          }
        />
      ),
    }
  }
  const existing = rules.cleanup.find((one) => one.id === form.id)
  const before = context.actionOf(null, form.id)
  if (existing?.config === undefined || before === undefined) return null
  const store = dialog<DeliveryStepDraft>({ start: before.mode, config: existing.config })
  return {
    title: existing.label,
    icon,
    body: <StepBody store={store} commands={commands} refused={undefined} adding={undefined} />,
    footer: (
      <Foot
        store={store}
        close={close}
        write={(draft) =>
          edit.cleanupSaved(context.toAction(draft, form.id, 'unknown', before)).then(() => true)
        }
      />
    ),
  }
}

/** The dialog a line of the section opens, or null when what it names is gone. */
export function deliveryDialogOf(
  target: DeliveryTarget,
  context: DialogContext,
): SettingsForm | null {
  const { rules, edit, close } = context
  switch (target.kind) {
    case 'commit':
    case 'title':
    case 'body':
      return templateDialog(target.kind, context)
    case 'push': {
      const { placement, start } = rules.pullRequests
      const store = dialog<PushDraft>({ placement, start })
      return {
        title: 'Push and open the pull requests',
        icon,
        body: <PushBody store={store} />,
        footer: (
          <Foot store={store} close={close} write={(draft) => edit.push(draft).then(() => true)} />
        ),
      }
    }
    case 'reviewers': {
      const store = dialog<Reviewer[]>([...rules.pullRequests.reviewers])
      return {
        title: 'Reviewers',
        icon,
        body: <ReviewersBody store={store} />,
        footer: (
          <Foot
            store={store}
            close={close}
            write={(draft) => edit.reviewers(draft).then(() => true)}
          />
        ),
      }
    }
    case 'repository':
      return repositoryDialog(target.repository, context)
    case 'step':
    case 'add-step':
      return stepDialog(target, context)
    case 'cleanup':
    case 'add-cleanup':
      return cleanupDialog(target, context)
  }
}

/** The forge a repository's dialog forces, as the engine names it; null to read it again. */
export const forcedOf = (draft: DeliveryRepositoryDraft): ForcedForge | null =>
  draft.forced === null ? null : FORCED[draft.forced]
