import { CATALOGUE, type StepConfig, type StepKind, type StepStart } from './delivery-model.ts'

/** What the dialogs of the delivery rules offer and start from: plain data, apart from their components. */

export const START_ITEMS: { value: StepStart; label: string }[] = [
  { value: 'auto', label: 'On its own' },
  { value: 'click', label: 'Waits for your click' },
]

/** A step not written yet, of each kind. */
export function newStep(kind: StepKind): StepConfig {
  switch (kind) {
    case 'bump':
      return { kind, how: 'command', command: null }
    case 'merge':
      return { kind, method: 'squash' }
    case 'remote-action':
      return { kind, action: '' }
    case 'published':
      return { kind, by: 'tag', pattern: '' }
    case 'command':
      return { kind, command: '' }
    case 'agent':
      return { kind, task: '' }
    case 'confirm':
      return { kind, what: '' }
    case 'commit-by-hemera':
    case 'commit-by-me':
    case 'commit-by-agent':
    case 'push':
    case 'pull-request':
    case 'ci':
    case 'local-merge':
    case 'pull-main-checkout':
    case 'stop-services':
    case 'remove-worktrees':
    case 'remove-workspace':
      return { kind }
  }
}

/** The kinds a step added to a recipe or to the cleanup may be: the whole catalogue, in each. */
export const RECIPE_KINDS = CATALOGUE

export const CLEANUP_KINDS = CATALOGUE
