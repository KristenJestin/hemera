import {
  ADDABLE,
  type StepConfig,
  type StepKind,
  type StepStart,
  type WhoCommits,
} from './delivery-model.ts'

/** What the dialogs of the delivery rules offer and start from: plain data, apart from their components. */

export const START_ITEMS: { value: StepStart; label: string }[] = [
  { value: 'auto', label: 'On its own' },
  { value: 'click', label: 'Waits for your click' },
]

/** Each value of “who commits”: its words and what it does. */
export const COMMITS: readonly { value: WhoCommits; label: string; effect: string }[] = [
  {
    value: 'task',
    label: 'Hemera, after each verified task',
    effect: 'A commit per task, named by the commit template. What is left goes in at the push.',
  },
  {
    value: 'agent',
    label: 'The agent, as it works',
    effect:
      'The agent commits when it sees fit, with the commit template. What is left goes in at the push.',
  },
  {
    value: 'push',
    label: 'Hemera, once, at the push',
    effect: 'Nothing is committed during Building: the push makes one commit per repository.',
  },
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
    case 'push':
    case 'pull-request':
    case 'ci':
    case 'local-merge':
      return { kind }
  }
}

/** The kinds a step added to a recipe may be; a cleanup step is a command, an agent or a confirm. */
export const RECIPE_KINDS = ADDABLE

export const CLEANUP_KINDS: readonly StepKind[] = ['command', 'agent', 'confirm']
