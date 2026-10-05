/**
 * Approvals that never block the agent, and the identity of an action allowed for the whole
 * mission.
 *
 * A call that needs the user is answered at once: it waits for nobody, and the agent is told the
 * action has not happened. Once the user answers, Hemera acts itself and hands the result over in
 * one of four sentences.
 *
 * "Allow for this mission" holds for the same action only (CT-19): the same tool, the same words
 * after normalisation, in the same folder of the place, the same repository, setting the same
 * variables; a catalogue command is known by its id. Never a wildcard, never a prefix. The real
 * path of the program, the catalogue line and the fingerprint of a script of the place are part
 * of the identity without being part of the key: when one of them moves, the grant falls.
 */

import { Schema } from 'effect'

/** What the agent reads when its call waits for the user. */
export function waitingText(request: number): string {
  return [
    `Waiting for the user's approval, request #${String(request)}.`,
    'This action has not happened; do not assume it did.',
    'Continue with work that does not depend on it, or end your turn saying you wait.',
    'The answer will be handed to you when the user gives it.',
  ].join(' ')
}

export const REQUEST_RESULTS = ['done', 'failed', 'refused', 'not-executed'] as const
export const RequestResult = Schema.Literals(REQUEST_RESULTS)
export type RequestResult = typeof RequestResult.Type

/** Why an approval no longer holds when Hemera comes to act on it. */
export const SITUATION_CHANGED = 'the situation changed since it was allowed'

/** What the agent is handed once the user answered one of its requests. */
export function resultText(handed: {
  readonly number: number
  readonly tool: string
  readonly result: RequestResult
  /** The tool's answer, the reason nothing was done, or why it was not executed. */
  readonly text: string
}): string {
  const head = `Request #${String(handed.number)} (${handed.tool})`
  switch (handed.result) {
    case 'done':
      return `${head} was approved by the user, and Hemera has now done it. Its result:\n\n${handed.text}`
    case 'failed':
      return `${head} was approved by the user, but nothing was done: ${handed.text}`
    case 'refused':
      return `${head} was refused by the user. Nothing was done.`
    case 'not-executed':
      return `${head} was not executed: ${handed.text}.`
  }
}

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/

/**
 * The names of the variables a line sets for its program: its leading `NAME=value` words, and
 * those `env` is handed (after its own flags). Never their values.
 */
export function variablesSet(words: ReadonlyArray<string>): ReadonlyArray<string> {
  let at = 0
  if (words[0] === 'env') {
    at = 1
    while (words[at]?.startsWith('-') === true) at += 1
  }
  const names: string[] = []
  for (; at < words.length; at += 1) {
    const word = words[at] ?? ''
    if (!ASSIGNMENT.test(word)) break
    names.push(word.slice(0, word.indexOf('=')))
  }
  return names
}

/** The identity of an action, as Hemera computes it (CT-19). */
export const ActionIdentity = Schema.Struct({
  tool: Schema.String,
  /** The catalogue command's id, when it is one. */
  catalogue: Schema.NullOr(Schema.String),
  /** The catalogue command's line on this system, as it stands. */
  catalogueLine: Schema.NullOr(Schema.String),
  /** The real path of the program, when it resolves. */
  program: Schema.NullOr(Schema.String),
  /** The words of the line after normalisation (its quotes read), the program first. */
  words: Schema.Array(Schema.String),
  /** The folder it runs in, relative to the root of the place, `/`-separated. */
  folder: Schema.String,
  repository: Schema.NullOr(Schema.String),
  /** The names of the variables the line sets. */
  variables: Schema.Array(Schema.String),
  /** The sha256 of the script, when the program or its first argument is a file of the place. */
  script: Schema.NullOr(Schema.String),
  /** For a file tool: the path it acts on, resolved. */
  target: Schema.NullOr(Schema.String),
})
export type ActionIdentity = typeof ActionIdentity.Type

/**
 * What a grant is looked up by: the same tool and the same words, folder, repository and
 * variables, exactly; a catalogue command by its id. Two actions share a key only when they are
 * the same action.
 */
export function grantKey(identity: ActionIdentity): string {
  if (identity.catalogue !== null) {
    return JSON.stringify([identity.tool, 'catalogue', identity.catalogue])
  }
  return JSON.stringify([
    identity.tool,
    identity.words,
    identity.folder,
    identity.repository,
    identity.variables,
    identity.target,
  ])
}

/**
 * Why an action with the same key is no longer the one allowed: its catalogue line changed, its
 * program resolves elsewhere, or its script changed. Null when it is the same.
 */
export function identityChange(granted: ActionIdentity, now: ActionIdentity): string | null {
  if (granted.catalogueLine !== now.catalogueLine) return 'the catalogue line changed'
  if (granted.program !== now.program) return 'the program resolves elsewhere'
  if (granted.script !== now.script) return 'the script changed'
  return null
}

/** An action as the user reads it in the list of grants: its words, or the path it acts on. */
export function actionSaid(identity: ActionIdentity, catalogueName: string | null): string {
  if (identity.target !== null) return `${identity.tool} ${identity.target}`
  const line = identity.words.join(' ')
  const where = identity.folder === '.' ? '' : ` (in ${identity.folder})`
  return catalogueName === null ? `${line}${where}` : `${catalogueName}: ${line}${where}`
}
