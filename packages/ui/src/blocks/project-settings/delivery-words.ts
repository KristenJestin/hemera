import {
  type DeliveryRepository,
  FORGE_CLI,
  type ForgeView,
  type PullRequestRules,
  type RecipeStep,
  STEP_WORDS,
  TEMPLATE_VARIABLES,
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

// ——— Templates ———

/** What a template is filled with, for the example under its field: ACME-12. */
export const EXAMPLE: Record<(typeof TEMPLATE_VARIABLES)[number]['name'], string> = {
  '{key}': 'ACME-12',
  '{title}': 'Export invoices as CSV',
  '{slug}': 'export-invoices-as-csv',
  '{branch}': 'acme/ACME-12-export-invoices-as-csv',
  '{summary}': 'The invoices page exports its rows as CSV, streamed page by page.',
  '{images}': '![The export button](export.png)',
}

/** The names a template holds that Hemera does not fill. */
export function unknownNames(template: string): string[] {
  const known = new Set<string>(TEMPLATE_VARIABLES.map((one) => one.name))
  return [...template.matchAll(/\{[^{}\s]*\}/g)]
    .map((match) => match[0])
    .filter((name) => !known.has(name))
}

/** The engine's refusal of a template, in its words. */
export function templateRefusal(template: string): string | undefined {
  const unknown = unknownNames(template)
  if (unknown.length === 0) return undefined
  const names = TEMPLATE_VARIABLES.map((one) => one.name).join(', ')
  return `${unknown.join(', ')} ${unknown.length === 1 ? 'is not a name' : 'are not names'} Hemera fills. Use ${names}.`
}

/** A template as ACME-12 fills it. */
export function filled(template: string): string {
  let text = template
  for (const [name, value] of Object.entries(EXAMPLE)) text = text.replaceAll(name, value)
  return text
}
