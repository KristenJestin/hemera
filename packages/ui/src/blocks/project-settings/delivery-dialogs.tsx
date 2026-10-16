import type { ReactNode } from 'react'

import { IconGitMerge } from '../../icons.ts'
import type { SettingsForm } from '../../surfaces/project-settings/project-settings.tsx'
import { CLEANUP_KINDS, RECIPE_KINDS } from './delivery-form-options.ts'
import type { Drafts } from './delivery-drafts.ts'
import { withCleanup, withPushIn } from './delivery-edits.ts'
import { CANDIDATES, DELIVERY_COMMANDS, filled, templateRefusal } from './delivery-fixtures.ts'
import {
  PushForm,
  type PushDraft,
  type RepositoryDraft,
  RepositoryForm,
  ReviewersForm,
  type StepDraft,
  StepForm,
  TemplateForm,
} from './delivery-forms.tsx'
import {
  type DeliveryRules,
  type PullRequestRules,
  type Reviewer,
  STEP_WORDS,
  MOMENT_WORDS,
} from './delivery-model.ts'
import type { DeliveryTarget } from './delivery-rules.tsx'
import type { FormFootProps } from './parts.tsx'

/**
 * The dialog each line of the delivery rules opens, as the page of the stories holds it: its
 * title, its body over the drafts, and its foot, whose save applies the draft to the rules.
 */

type Template = 'commit' | 'title' | 'body'

const TEMPLATE_LABELS: Record<Template, string> = {
  commit: 'Commit message',
  title: 'Pull request title',
  body: 'Pull request body',
}

/** What a dialog needs of the page that holds it. */
export interface DialogContext {
  rules: DeliveryRules
  drafts: Drafts
  /** Whether a story's save is refused, and what the page does on a save. */
  foot: (
    what: string,
    apply: () => void,
    refusal?: string,
    extra?: Partial<FormFootProps>,
  ) => ReactNode
  onTemplate: (next: string) => void
  onPush: (next: PushDraft) => void
  onReviewers: (next: Reviewer[]) => void
  onRepository: (next: RepositoryDraft) => void
  onStep: (next: StepDraft) => void
  onClose: () => void
  setPullRequests: (part: Partial<PullRequestRules>) => void
  edit: (change: (rules: DeliveryRules) => DeliveryRules) => void
}

type Of<Kind extends DeliveryTarget['kind']> = Extract<DeliveryTarget, { kind: Kind }>

function templateDialog(
  kind: Template,
  { drafts, foot, onTemplate, setPullRequests }: DialogContext,
): SettingsForm {
  const { template } = drafts
  const refused = templateRefusal(template)
  return {
    title: TEMPLATE_LABELS[kind],
    icon: <IconGitMerge size="sm" />,
    body: (
      <TemplateForm
        label={TEMPLATE_LABELS[kind]}
        value={template}
        multiline={kind === 'body'}
        refused={refused}
        example={filled(template)}
        onChange={onTemplate}
      />
    ),
    footer: foot(kind, () => setPullRequests({ [kind]: template }), refused),
  }
}

function repositoryDialog(form: Of<'repository'>, context: DialogContext): SettingsForm {
  const { rules, drafts, foot, onRepository } = context
  const found = rules.repositories.find((one) => one.path === form.repository)
  const { repository } = drafts
  return {
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
        onChange={onRepository}
      />
    ),
    footer: foot('repository', () => {}),
  }
}

function stepDialog(form: Of<'step'> | Of<'add-step'>, context: DialogContext): SettingsForm {
  const { rules, drafts, foot, onStep, onClose } = context
  const found = rules.repositories.find((one) => one.path === form.repository)
  const existing =
    form.kind === 'step' ? found?.steps.find((one) => one.step.id === form.id) : undefined
  const name = existing === undefined ? 'New step' : STEP_WORDS[existing.step.config.kind]
  const when = existing === undefined ? '' : ` · ${MOMENT_WORDS[existing.moment]}`
  return {
    title: `${name} · ${form.repository}${when}`,
    icon: <IconGitMerge size="sm" />,
    body: (
      <StepForm
        draft={drafts.step}
        onChange={onStep}
        commands={DELIVERY_COMMANDS}
        refused={existing?.refused}
        adding={
          form.kind === 'add-step'
            ? {
                kinds: RECIPE_KINDS,
                moments: true,
                after: (found?.steps ?? []).map((one) => ({
                  id: one.step.id,
                  label: STEP_WORDS[one.step.config.kind],
                  moment: one.moment,
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
      onRemove: onClose,
    }),
  }
}

function cleanupDialog(
  form: Of<'cleanup'> | Of<'add-cleanup'>,
  context: DialogContext,
): SettingsForm {
  const { rules, drafts, foot, onStep, edit } = context
  const { step } = drafts
  const existing =
    form.kind === 'cleanup' ? rules.cleanup.find((one) => one.id === form.id) : undefined
  return {
    title: existing?.label ?? 'New cleanup step',
    icon: <IconGitMerge size="sm" />,
    body: (
      <StepForm
        draft={step}
        onChange={onStep}
        commands={DELIVERY_COMMANDS}
        adding={existing === undefined ? { kinds: CLEANUP_KINDS, after: [] } : undefined}
      />
    ),
    footer: foot(
      'cleanup',
      () => {
        if (existing === undefined)
          edit((before) => withCleanup(before, step.config, STEP_WORDS[step.config.kind]))
      },
      undefined,
      { save: existing === undefined ? 'Add' : 'Save' },
    ),
  }
}

/** The dialog a line opens. */
export function dialogFor(form: DeliveryTarget, context: DialogContext): SettingsForm {
  const { drafts, foot, onPush, onReviewers, setPullRequests, edit } = context
  switch (form.kind) {
    case 'commit':
    case 'title':
    case 'body':
      return templateDialog(form.kind, context)
    case 'push':
      return {
        title: 'Push and open the pull requests',
        icon: <IconGitMerge size="sm" />,
        body: <PushForm draft={drafts.push} onChange={onPush} />,
        footer: foot('push', () => {
          setPullRequests(drafts.push)
          edit((before) => withPushIn(before, drafts.push.placement))
        }),
      }
    case 'reviewers':
      return {
        title: 'Reviewers',
        icon: <IconGitMerge size="sm" />,
        body: (
          <ReviewersForm chosen={drafts.reviewers} candidates={CANDIDATES} onChange={onReviewers} />
        ),
        footer: foot('reviewers', () => setPullRequests({ reviewers: drafts.reviewers })),
      }
    case 'repository':
      return repositoryDialog(form, context)
    case 'step':
    case 'add-step':
      return stepDialog(form, context)
    case 'cleanup':
    case 'add-cleanup':
      return cleanupDialog(form, context)
  }
}
