import {
  InvalidBranchName,
  InvalidCommand,
  InvalidRecipeStep,
  InvalidRepositoryPath,
  InvalidTemplate,
  InvalidVariableKey,
  ShellSyntax,
} from '@hemera/ipc'
import type { StepDraft } from '@hemera/ui'

import type { Refusals } from './settings-types.ts'

export const sentenceOf = (failure: Error): string => failure.message

/** Where a refusal of a repository's form is said. */
export function repositoryRefusal(failure: Error): Refusals {
  if (failure instanceof InvalidRepositoryPath) return { path: failure.message }
  if (failure instanceof InvalidBranchName) return { branch: failure.message }
  return { foot: sentenceOf(failure) }
}

/** Where a refusal of a command's form is said: its name, its files, or the foot. */
export function commandRefusal(failure: Error, lineRefused: boolean): Refusals {
  if (failure instanceof InvalidCommand) {
    if (failure.reason.startsWith('the write glob')) return { globs: failure.message }
    if (failure.reason.startsWith('its name') || failure.reason.startsWith('a command named')) {
      return { name: failure.message }
    }
  }
  // Shell syntax and an unknown name are already said under the line they are in.
  if ((failure instanceof ShellSyntax || failure instanceof InvalidTemplate) && lineRefused) {
    return {}
  }
  return { foot: sentenceOf(failure) }
}

/** Where a refusal of a step's form is said: its source for a copy or a link, or the foot. */
export function stepRefusal(failure: Error, draft: StepDraft, position: number): Refusals {
  const aboutSource =
    draft.kind !== 'run' &&
    ((failure instanceof InvalidRecipeStep && failure.position === position) ||
      failure instanceof InvalidRepositoryPath ||
      failure instanceof InvalidTemplate)
  return aboutSource ? { path: failure.message } : { foot: sentenceOf(failure) }
}

export function variableRefusal(failure: Error): Refusals {
  if (failure instanceof InvalidVariableKey) return { key: failure.message }
  if (failure instanceof InvalidTemplate) return { value: failure.message }
  return { foot: sentenceOf(failure) }
}
