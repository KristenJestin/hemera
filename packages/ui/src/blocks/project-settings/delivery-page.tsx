/**
 * A page of a Project's settings around its delivery rules, holding what the renderer will hold:
 * the stories of the section and the explorations of its open questions are drawn in it.
 */
import { type ReactNode, useState } from 'react'

import { IconBook2, IconChecklist, IconGitMerge } from '../../icons.ts'
import {
  ProjectSettings,
  type SettingsForm,
} from '../../surfaces/project-settings/project-settings.tsx'
import { SECTIONS } from '../../surfaces/project-settings/settings-sections.tsx'
import {
  CANDIDATES,
  DELIVERY_COMMANDS,
  HISTORIES,
  filled,
  presetSteps,
  templateRefusal,
  wavesOf,
} from './delivery-fixtures.ts'
import {
  CLEANUP_KINDS,
  CommitsForm,
  PushForm,
  type PushDraft,
  RECIPE_KINDS,
  type RepositoryDraft,
  RepositoryForm,
  ReviewersForm,
  type StepDraft,
  StepForm,
  TemplateForm,
  newStep,
} from './delivery-forms.tsx'
import {
  type DeliveryRefusals,
  type DeliveryRules,
  type Reviewer,
  STEP_WORDS,
  type WhoCommits,
} from './delivery-model.ts'
import { DeliveryRulesSection, type DeliveryTarget } from './delivery-rules.tsx'
import { FormFoot } from './parts.tsx'

type Template = 'commit' | 'title' | 'body'

const TEMPLATE_LABELS: Record<Template, string> = {
  commit: 'Commit message',
  title: 'Pull request title',
  body: 'Pull request body',
}

export interface DeliveryPageProps {
  /** The Project's name: Acme unless said otherwise. */
  name?: string | undefined
  mainCheckout?: string | undefined
  /** Null: the rules are on their way. */
  rules: DeliveryRules | null
  refusals?: DeliveryRefusals | undefined
  error?: string | undefined
  /** The repositories unfolded at first. */
  open?: readonly string[] | undefined
  /** The dialog open at first. */
  form?: DeliveryTarget | undefined
  /** Why every save is refused, in words, as one meeting a newer version is. */
  refused?: string | undefined
  /** Who commits: the dialog's history, per value. */
  histories?: Readonly<Record<WhoCommits, readonly string[]>> | undefined
  onSave: (what: string) => void
  onCopy: (line: string) => void
  onCheckAgain: (repository: string) => void
}

interface Drafts {
  template: string
  push: PushDraft
  reviewers: Reviewer[]
  commits: WhoCommits
  repository: RepositoryDraft
  step: StepDraft
}

/** What a dialog opens with: what the rules hold for its target. */
function seed(target: DeliveryTarget | null, rules: DeliveryRules | null): Drafts {
  const pr = rules?.pullRequests
  const drafts: Drafts = {
    template: '',
    push: { placement: pr?.placement ?? 'review', start: pr?.start ?? 'auto' },
    reviewers: [...(pr?.reviewers ?? [])],
    commits: pr?.commits ?? 'task',
    repository: { remote: 'origin', base: '', forced: null, host: '' },
    step: { start: 'auto', config: newStep('command') },
  }
  if (target === null || pr === undefined || rules === null) return drafts
  if (target.kind === 'commit' || target.kind === 'title' || target.kind === 'body')
    return { ...drafts, template: pr[target.kind] }
  if (target.kind === 'repository') {
    const found = rules.repositories.find((one) => one.path === target.repository)
    if (found === undefined) return drafts
    const { forge } = found
    return {
      ...drafts,
      repository: {
        remote: found.remote,
        base: found.base,
        forced: forge.forced && forge.kind !== 'none' ? forge.kind : null,
        host: forge.forced ? forge.host : '',
      },
    }
  }
  if (target.kind === 'step') {
    const found = rules.repositories
      .find((one) => one.path === target.repository)
      ?.steps.find((one) => one.step.id === target.id)
    if (found !== undefined)
      return { ...drafts, step: { start: found.step.start, config: found.step.config } }
  }
  if (target.kind === 'cleanup') {
    const found = rules.cleanup.find((one) => one.id === target.id)
    if (found?.config !== undefined)
      return { ...drafts, step: { start: 'auto', config: found.config } }
  }
  return drafts
}

/** A page of Acme's settings around the delivery rules, holding what the renderer will hold. */
export function DeliveryPage(props: DeliveryPageProps): ReactNode {
  const [rules, setRules] = useState(props.rules)
  const [given, setGiven] = useState(props.rules)
  if (given !== props.rules) {
    setGiven(props.rules)
    setRules(props.rules)
  }
  const [form, setForm] = useState<DeliveryTarget | null>(props.form ?? null)
  const [drafts, setDrafts] = useState<Drafts>(() => seed(props.form ?? null, props.rules))
  const { template, push, reviewers, commits, repository, step } = drafts
  const setTemplate = (next: string): void => setDrafts((before) => ({ ...before, template: next }))
  const setPush = (next: PushDraft): void => setDrafts((before) => ({ ...before, push: next }))
  const setReviewers = (next: Reviewer[]): void =>
    setDrafts((before) => ({ ...before, reviewers: next }))
  const setCommits = (next: WhoCommits): void =>
    setDrafts((before) => ({ ...before, commits: next }))
  const setRepository = (next: RepositoryDraft): void =>
    setDrafts((before) => ({ ...before, repository: next }))
  const setStep = (next: StepDraft): void => setDrafts((before) => ({ ...before, step: next }))
  const [checking, setChecking] = useState<string[]>([])
  const pr = rules?.pullRequests
  const open = (target: DeliveryTarget | null): void => {
    setDrafts(seed(target, rules))
    setForm(target)
  }
  const close = (): void => setForm(null)
  const setPullRequests = (part: Partial<NonNullable<typeof pr>>): void =>
    setRules((before) =>
      before === null ? before : { ...before, pullRequests: { ...before.pullRequests, ...part } },
    )
  const templateKind: Template | null =
    form?.kind === 'commit' || form?.kind === 'title' || form?.kind === 'body' ? form.kind : null
  const templateRefused = templateKind === null ? undefined : templateRefusal(template)
  const stepRefused =
    form?.kind === 'step'
      ? rules?.repositories
          .find((one) => one.path === form.repository)
          ?.steps.find((one) => one.step.id === form.id)?.refused
      : undefined
  const save = (what: string, apply: () => void, refusal?: string): void => {
    props.onSave(what)
    if (props.refused !== undefined || refusal !== undefined) return
    apply()
    close()
  }
  const foot = (
    what: string,
    apply: () => void,
    refusal?: string,
    extra?: Partial<Parameters<typeof FormFoot>[0]>,
  ) => (
    <FormFoot
      refused={props.refused}
      onSave={() => save(what, apply, refusal)}
      onCancel={close}
      {...extra}
    />
  )
  const repositoryOf = (path: string) => rules?.repositories.find((one) => one.path === path)
  let dialog: SettingsForm | null = null
  if (form !== null && rules !== null && pr !== undefined) {
    if (templateKind !== null) {
      dialog = {
        title: TEMPLATE_LABELS[templateKind],
        icon: <IconGitMerge size="sm" />,
        body: (
          <TemplateForm
            label={TEMPLATE_LABELS[templateKind]}
            value={template}
            multiline={templateKind === 'body'}
            refused={templateRefused}
            example={filled(template)}
            onChange={setTemplate}
          />
        ),
        footer: foot(
          templateKind,
          () => setPullRequests({ [templateKind]: template }),
          templateRefused,
        ),
      }
    } else if (form.kind === 'push') {
      dialog = {
        title: 'Push and open the pull requests',
        icon: <IconGitMerge size="sm" />,
        body: <PushForm draft={push} onChange={setPush} />,
        footer: foot('push', () => setPullRequests(push)),
      }
    } else if (form.kind === 'reviewers') {
      dialog = {
        title: 'Reviewers',
        icon: <IconGitMerge size="sm" />,
        body: <ReviewersForm chosen={reviewers} candidates={CANDIDATES} onChange={setReviewers} />,
        footer: foot('reviewers', () => setPullRequests({ reviewers })),
      }
    } else if (form.kind === 'commits') {
      dialog = {
        title: 'Who commits',
        icon: <IconGitMerge size="sm" />,
        body: (
          <CommitsForm
            value={commits}
            histories={props.histories ?? HISTORIES}
            onChange={setCommits}
          />
        ),
        footer: foot('commits', () => setPullRequests({ commits })),
      }
    } else if (form.kind === 'repository') {
      const found = repositoryOf(form.repository)
      dialog = {
        title: form.repository,
        icon: <IconGitMerge size="sm" />,
        body: (
          <RepositoryForm
            draft={repository}
            remotes={found?.remotes ?? ['origin']}
            detected={found?.forge.forced === true ? 'github' : (found?.forge.kind ?? 'github')}
            refusals={{
              base: repository.base.includes('..')
                ? `“${repository.base}” is not a branch name Git accepts: it holds “..”.`
                : undefined,
            }}
            onChange={setRepository}
          />
        ),
        footer: foot('repository', () => {}),
      }
    } else if (form.kind === 'step' || form.kind === 'add-step') {
      const found = repositoryOf(form.repository)
      const existing =
        form.kind === 'step' ? found?.steps.find((one) => one.step.id === form.id) : undefined
      const name = existing === undefined ? 'New step' : STEP_WORDS[existing.step.config.kind]
      dialog = {
        title: `${name} · ${form.repository}`,
        icon: <IconGitMerge size="sm" />,
        body: (
          <StepForm
            draft={step}
            onChange={setStep}
            commands={DELIVERY_COMMANDS}
            refused={stepRefused}
            adding={
              form.kind === 'add-step'
                ? {
                    kinds: RECIPE_KINDS,
                    after: (found?.steps ?? []).map((one) => ({
                      id: one.step.id,
                      label: STEP_WORDS[one.step.config.kind],
                    })),
                  }
                : undefined
            }
          />
        ),
        footer: foot('step', () => {}, undefined, {
          save: existing === undefined ? 'Add' : 'Save',
          remove:
            existing === undefined
              ? undefined
              : existing.origin === 'added'
                ? `Remove ${name}`
                : `Leave out ${name} in ${form.repository}`,
          onRemove: close,
        }),
      }
    } else if (form.kind === 'add-cleanup' || form.kind === 'cleanup') {
      const existing =
        form.kind === 'cleanup' ? rules.cleanup.find((one) => one.id === form.id) : undefined
      dialog = {
        title: existing?.label ?? 'New cleanup step',
        icon: <IconGitMerge size="sm" />,
        body: (
          <StepForm
            draft={step}
            onChange={setStep}
            commands={DELIVERY_COMMANDS}
            adding={existing === undefined ? { kinds: CLEANUP_KINDS, after: [] } : undefined}
          />
        ),
        footer: foot(
          'cleanup',
          () =>
            setRules((before) =>
              before === null || existing !== undefined
                ? before
                : {
                    ...before,
                    cleanup: [
                      ...before.cleanup,
                      {
                        id: `added-${String(before.cleanup.length + 1)}`,
                        label: STEP_WORDS[step.config.kind],
                        config: step.config,
                      },
                    ],
                  },
            ),
          undefined,
          { save: existing === undefined ? 'Add' : 'Save' },
        ),
      }
    }
  }
  return (
    <main className="flex h-screen flex-col bg-surface-content">
      <ProjectSettings
        name={props.name ?? 'Acme'}
        mainCheckout={props.mainCheckout ?? '~/work/acme'}
        sections={[
          ...SECTIONS,
          { id: 'checks', label: 'Checks', icon: <IconChecklist size="sm" /> },
          { id: 'documentation', label: 'Documentation', icon: <IconBook2 size="sm" /> },
          {
            id: 'delivery',
            label: 'Delivery rules',
            icon: <IconGitMerge size="sm" />,
            problem:
              props.refusals !== undefined ||
              rules?.repositories.some((one) => one.steps.some((s) => s.refused !== undefined))
                ? 'rules refused'
                : undefined,
          },
        ]}
        current="delivery"
        onSection={() => {}}
        onRetry={() => {}}
        form={dialog}
        onCloseForm={close}
      >
        <DeliveryRulesSection
          rules={rules}
          refusals={props.refusals}
          error={props.error}
          initiallyOpen={props.open}
          checking={checking}
          onOpen={open}
          onToggle={(rule, on) => setPullRequests({ [rule]: on })}
          onPreset={(path, preset) =>
            setRules((before) =>
              before === null
                ? before
                : {
                    ...before,
                    repositories: before.repositories.map((one) =>
                      one.path === path
                        ? {
                            ...one,
                            preset,
                            steps: presetSteps(preset, `@acme/${path}`).map((s) => ({
                              step: s,
                              origin: 'preset',
                            })),
                          }
                        : one,
                    ),
                  },
            )
          }
          onPutBack={(path, id) =>
            setRules((before) =>
              before === null
                ? before
                : {
                    ...before,
                    repositories: before.repositories.map((one) =>
                      one.path === path
                        ? {
                            ...one,
                            steps: one.steps.map((s) =>
                              s.step.id === id ? { step: s.step, origin: 'preset' } : s,
                            ),
                          }
                        : one,
                    ),
                  },
            )
          }
          onReset={() => {}}
          onAcceptDependency={(dependency) =>
            setRules((before) => {
              if (before === null) return before
              const dependencies = before.dependencies.map((one) =>
                one === dependency ? { ...one, proposed: false } : one,
              )
              return {
                ...before,
                dependencies,
                waves:
                  wavesOf(
                    before.repositories.map((one) => one.path),
                    dependencies,
                  ) ?? [],
              }
            })
          }
          onRemoveCleanup={(id) =>
            setRules((before) =>
              before === null
                ? before
                : { ...before, cleanup: before.cleanup.filter((one) => one.id !== id) },
            )
          }
          onCheckAgain={(path) => {
            props.onCheckAgain(path)
            setChecking((before) => [...before, path])
          }}
          onCopy={props.onCopy}
        />
      </ProjectSettings>
    </main>
  )
}
