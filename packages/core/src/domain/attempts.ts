/**
 * The attempts of a Building and their verdict (#142): what an attempt is at, how its checks make
 * it green, red or not verified, where its task goes after it, and the end of a red check's output
 * as the runner is handed it. Pure rules: the engine records and delivers.
 *
 * After the third red attempt on the same subject Hemera stops and asks the user: repeated
 * failures call for rethinking an assumption, never a fourth identical attempt.
 */

import { Schema } from 'effect'

/** What an attempt is at: a task, the checks of a requirement, or the end of the Building. */
export const ATTEMPT_SCOPES = ['task', 'requirement', 'end'] as const
export const AttemptScope = Schema.Literals(ATTEMPT_SCOPES)
export type AttemptScope = typeof AttemptScope.Type

/** How an attempt was judged: a red check, else a green one, else no check that ran. */
export const ATTEMPT_RESULTS = ['green', 'red', 'not_verified'] as const
export const AttemptResult = Schema.Literals(ATTEMPT_RESULTS)
export type AttemptResult = typeof AttemptResult.Type

/** What one check said in one place: skipped when it had nothing to run on. */
export const CHECK_VERDICTS = ['green', 'red', 'skipped'] as const
export const CheckVerdict = Schema.Literals(CHECK_VERDICTS)
export type CheckVerdict = typeof CheckVerdict.Type

/** How many red attempts on one subject make an error need. */
export const REDS_BEFORE_A_NEED = 3

/** The lines and bytes of a red check's output a runner is handed. */
export const RED_TAIL_LINES = 40
export const RED_TAIL_BYTES = 4096

/** An attempt's result from its checks' verdicts: any red, else any green, else not verified. */
export function attemptResult(verdicts: ReadonlyArray<CheckVerdict>): AttemptResult {
  if (verdicts.includes('red')) return 'red'
  return verdicts.includes('green') ? 'green' : 'not_verified'
}

/**
 * Where a task goes once an attempt is judged, `reds` counting this one if it is red: done unless
 * red; a red goes back in progress, and the third red is blocked by an error need.
 */
export function stateAfterAttempt(
  result: AttemptResult,
  reds: number,
): 'done' | 'in_progress' | 'blocked' {
  if (result !== 'red') return 'done'
  return reds >= REDS_BEFORE_A_NEED ? 'blocked' : 'in_progress'
}

/** Where a check ran, in words: the repository, or the Workspace root. */
export function placeWords(place: string): string {
  return place === '' ? 'the Workspace root' : place
}

/**
 * The end of an output as a runner is handed it: its last 40 lines, at most 4 KB of them, and what
 * was cut in words, or null when nothing was.
 */
export function outputTail(output: string, lines = RED_TAIL_LINES, bytes = RED_TAIL_BYTES) {
  const all = output.replace(/\n$/, '').split('\n')
  const kept = all.slice(-lines)
  let tail = kept.join('\n')
  const cutLines = all.length - kept.length
  const encoded = new TextEncoder().encode(tail)
  const cutBytes = encoded.length > bytes
  if (cutBytes) {
    // The last bytes, from the first whole line among them; one long line is kept cut.
    const end = new TextDecoder().decode(encoded.slice(encoded.length - bytes))
    const newline = end.indexOf('\n')
    tail = newline === -1 ? end : end.slice(newline + 1)
  }
  const shown = tail === '' ? 0 : tail.split('\n').length
  const hidden = all.length - shown
  const cut: string | null =
    cutLines === 0 && !cutBytes
      ? null
      : `the first ${String(hidden)} line(s) are cut: only the last ${String(shown)} line(s)${cutBytes ? `, at most ${String(bytes / 1024)} KB,` : ''} are shown`
  return { tail, cut }
}
