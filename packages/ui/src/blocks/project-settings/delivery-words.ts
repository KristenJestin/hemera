import {
  type DeliveryRepository,
  FORGE_CLI,
  type ForgeView,
  type PullRequestRules,
  type RecipeStep,
  STEP_WORDS,
  detailOf,
  writesToNetwork,
} from './delivery-model.ts'

/** What the delivery rules say in words: a line's value, a legend, and a step for a screen reader. */

/** Where a forge's command line stands, in a few words. */
export function cliWords(forge: ForgeView): string {
  if (forge.kind === 'none') return 'No forge: everything stays on this machine'
  const cli = FORGE_CLI[forge.kind]
  switch (forge.cli) {
    case null:
      return `Checking ${cli}`
    case 'ready':
      return `${cli} is ready`
    case 'missing':
      return `${cli} is not installed`
    case 'signed-out':
      return `${cli} is signed out of ${forge.host}`
    case 'unreachable':
      return `${forge.host} cannot be reached`
  }
}

/** Whether a forge's command line keeps the forge's steps waiting. */
export function cliTroubled(forge: ForgeView): boolean {
  return forge.kind !== 'none' && forge.cli !== null && forge.cli !== 'ready'
}

/** How many things a repository changes of its preset. */
export function changesOf(repository: Pick<DeliveryRepository, 'steps'>): number {
  return repository.steps.filter((one) => one.origin !== 'preset').length
}

/** What a repository's line says of its changes. */
export function changesWords(count: number): string {
  if (count === 0) return 'as the preset'
  return count === 1 ? '1 change' : `${String(count)} changes`
}

/** Where the push and the pull requests stand, in words. */
export function pushWords(rules: Pick<PullRequestRules, 'placement' | 'start'>): string {
  const when = rules.placement === 'review' ? 'When Review starts' : 'After Ship, in each wave'
  return `${when} · ${rules.start === 'auto' ? 'on its own' : 'waits for your click'}`
}

/** Who commits, in words. */
export const COMMITS_WORDS: Record<PullRequestRules['commits'], string> = {
  task: 'Hemera, after each verified task',
  agent: 'The agent, as it works',
  push: 'Hemera, once, at the push',
}

/** The reviewers, in words: the first two, and how many more. */
export function reviewersWords(rules: Pick<PullRequestRules, 'reviewers'>): string {
  const names = rules.reviewers.map((one) => one.name ?? one.handle)
  if (names.length === 0) return 'Nobody'
  if (names.length <= 2) return names.join(', ')
  return `${names.slice(0, 2).join(', ')} and ${String(names.length - 2)} more`
}

/** The words of a step for a screen reader: everything its line shows. */
export function stepWords(
  recipe: RecipeStep,
  repository: Pick<DeliveryRepository, 'remote' | 'base'>,
): string {
  const { step, origin } = recipe
  return [
    STEP_WORDS[step.config.kind],
    detailOf(step.config, repository),
    origin === 'changed' ? 'changed here' : null,
    origin === 'added' ? 'added here' : null,
    origin === 'omitted' ? 'left out here' : null,
    step.start === 'click' ? 'waits for your click' : null,
    writesToNetwork(step.config) ? 'may write to the network' : null,
  ]
    .filter((part) => part !== null)
    .join(', ')
}
