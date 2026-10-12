/**
 * What the Checks and Documentation sections of a Project's settings show of the engine's records
 * (#152), and what their dialogs write back: a check's catalogue command with its line and its
 * "ask before running" mark, a minimum written as text, a recipe's words or none, the proposals
 * given ids the lists can move, a refusal said under the field it concerns, and the one move a
 * reorder is. Plain values and functions: no React, no link.
 */

import { CheckRefused, DocRecipeRefused } from '@hemera/ipc'
import type {
  CheckDraft as EngineCheckDraft,
  Command,
  DocRecipe,
  DocRecipeDraft as EngineDocRecipeDraft,
  ProjectCheck,
} from '@hemera/ipc'
import type {
  CatalogueChoice,
  CheckDraft,
  CheckRefusals,
  DocRecipeDraft,
  DocRecipeRefusals,
  SettingsCheck,
  SettingsDocRecipe,
} from '@hemera/ui'

/** A command of the catalogue as the check's field offers it, its mark with it. */
function choiceOf(command: Command): CatalogueChoice {
  return {
    id: command.id,
    name: command.name,
    type: command.type,
    line: command.line,
    askBeforeRunning: command.askBeforeRunning,
  }
}

/** The commands a check may run: those the catalogue marks as checks, never a service. */
export function checkChoicesOf(catalogue: ReadonlyArray<Command>): CatalogueChoice[] {
  return catalogue.filter((one) => one.check && one.type !== 'serve').map(choiceOf)
}

/** A check, or a proposal given an id, as its line shows it. */
function shownCheck(
  id: string,
  check: EngineCheckDraft,
  catalogue: ReadonlyArray<Command>,
): SettingsCheck {
  const command = catalogue.find((one) => one.id === check.commandId)
  return {
    id,
    name: check.name,
    command: command === undefined ? null : choiceOf(command),
    line: check.line,
    where: check.where,
    repository: check.repository,
    when: check.when,
    expect:
      check.expect === null
        ? null
        : { pattern: check.expect.pattern, minimum: String(check.expect.minimum) },
    files: check.files,
  }
}

export function settingsCheckOf(
  check: ProjectCheck,
  catalogue: ReadonlyArray<Command>,
): SettingsCheck {
  return shownCheck(check.id, check, catalogue)
}

/** What Hemera proposes, each with an id of its own until it is accepted. */
export function proposedChecksOf(
  proposals: ReadonlyArray<EngineCheckDraft>,
  catalogue: ReadonlyArray<Command>,
): SettingsCheck[] {
  return proposals.map((one, index) => shownCheck(`proposed-${String(index)}`, one, catalogue))
}

/** A check as its dialog holds it: its catalogue command by id. */
export function checkFormOf({ id: _id, command, ...rest }: SettingsCheck): CheckDraft {
  return { ...rest, command: command?.id ?? null }
}

/** A minimum as typed: a number, or no number for the engine to refuse in its words. */
function minimumOf(typed: string): number {
  return typed.trim() === '' ? Number.NaN : Number(typed)
}

/** What the engine writes of a dialog's draft: a command chosen sends no line. */
export function checkDraftOf(draft: CheckDraft): EngineCheckDraft {
  return {
    name: draft.name,
    commandId: draft.command,
    line: draft.command === null ? draft.line : null,
    where: draft.where,
    repository: draft.repository,
    when: draft.when,
    expect:
      draft.expect === null
        ? null
        : { pattern: draft.expect.pattern, minimum: minimumOf(draft.expect.minimum) },
    files: draft.files,
  }
}

/** A refusal said under the fields it concerns, and what concerns the whole at the foot. */
export interface Said<Fields> {
  readonly fields: Fields
  readonly foot: string | undefined
}

export function checkRefusalsOf(failure: Error): Said<CheckRefusals> {
  if (failure instanceof CheckRefused && failure.field !== undefined && failure.field !== null) {
    return { fields: { [failure.field]: failure.message }, foot: undefined }
  }
  return { fields: {}, foot: failure.message }
}

/** A recipe, or a proposal given an id, as its line shows it. */
function shownRecipe(id: string, recipe: EngineDocRecipeDraft): SettingsDocRecipe {
  return {
    id,
    place: recipe.repository,
    path: recipe.path,
    purpose: recipe.purpose,
    words: recipe.applies === 'always' ? null : recipe.words,
  }
}

export function settingsDocRecipeOf(recipe: DocRecipe): SettingsDocRecipe {
  return shownRecipe(recipe.id, recipe)
}

/** What Hemera found in the main checkout, each with an id of its own until it is accepted. */
export function proposedDocRecipesOf(
  proposals: ReadonlyArray<EngineDocRecipeDraft>,
): SettingsDocRecipe[] {
  return proposals.map((one, index) => shownRecipe(`proposed-${String(index)}`, one))
}

export function docRecipeFormOf({ id: _id, ...draft }: SettingsDocRecipe): DocRecipeDraft {
  return draft
}

/** What the engine writes of a recipe's draft: its words trimmed, the blank ones left out. */
export function docRecipeDraftOf(draft: DocRecipeDraft): EngineDocRecipeDraft {
  return {
    repository: draft.place,
    path: draft.path,
    purpose: draft.purpose,
    applies: draft.words === null ? 'always' : 'when_impact_names',
    words: (draft.words ?? []).map((word) => word.trim()).filter((word) => word !== ''),
  }
}

export function docRecipeRefusalsOf(failure: Error): Said<DocRecipeRefusals> {
  if (failure instanceof DocRecipeRefused && failure.field !== undefined) {
    return { fields: { [failure.field]: failure.message }, foot: undefined }
  }
  return { fields: {}, foot: failure.message }
}

/**
 * The one move that turns an order into the next: the line taken out and the place it goes to,
 * or null when nothing moved.
 */
export function moveOf(
  before: ReadonlyArray<string>,
  after: ReadonlyArray<string>,
): { readonly id: string; readonly rank: number } | null {
  const at = after.findIndex((id, index) => before[index] !== id)
  if (at === -1) return null
  const without = (ids: ReadonlyArray<string>, id: string) => ids.filter((one) => one !== id)
  const same = (a: ReadonlyArray<string>, b: ReadonlyArray<string>) =>
    a.length === b.length && a.every((id, index) => b[index] === id)
  // Moved up: the line now at `at` came from further down.
  const raised = after[at] ?? ''
  if (same(without(before, raised), without(after, raised))) return { id: raised, rank: at }
  // Moved down: the line that stood at `at` went further down.
  const lowered = before[at] ?? ''
  return { id: lowered, rank: after.indexOf(lowered) }
}
