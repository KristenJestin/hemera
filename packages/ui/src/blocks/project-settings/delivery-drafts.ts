import { newStep } from './delivery-form-options.ts'
import type { PushDraft, RepositoryDraft, StepDraft } from './delivery-forms.tsx'
import type { DeliveryRules, RecipeStep, Reviewer } from './delivery-model.ts'
import type { DeliveryTarget } from './delivery-rules.tsx'

/** Where a placed step stands: its moment, and the step it follows there, null for first. */
export function placeOf(
  steps: readonly RecipeStep[],
  found: RecipeStep,
): Pick<StepDraft, 'moment' | 'after'> {
  const before = steps
    .slice(0, steps.indexOf(found))
    .filter((one) => one.moment === found.moment && one.origin !== 'omitted')
    .at(-1)
  return { moment: found.moment, after: before?.step.id ?? null }
}

export interface Drafts {
  template: string
  push: PushDraft
  reviewers: Reviewer[]
  repository: RepositoryDraft
  step: StepDraft
}

/** What a dialog opens with: what the rules hold for its target. */
export function seed(target: DeliveryTarget | null, rules: DeliveryRules | null): Drafts {
  const pr = rules?.pullRequests
  const drafts: Drafts = {
    template: '',
    push: { placement: pr?.placement ?? 'review', start: pr?.start ?? 'auto' },
    reviewers: [...(pr?.reviewers ?? [])],
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
    const steps = rules.repositories.find((one) => one.path === target.repository)?.steps ?? []
    const found = steps.find((one) => one.step.id === target.id)
    if (found !== undefined)
      return {
        ...drafts,
        step: { start: found.step.start, config: found.step.config, ...placeOf(steps, found) },
      }
  }
  if (target.kind === 'cleanup') {
    const found = rules.cleanup.find((one) => one.id === target.id)
    if (found?.config !== undefined)
      return { ...drafts, step: { start: 'auto', config: found.config } }
  }
  return drafts
}
