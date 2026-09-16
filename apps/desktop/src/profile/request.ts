/**
 * What the process that holds the database decides about a message before anything runs (D3-02).
 *
 * The same discipline as the bridge the page is held to, minus the one question that has no
 * meaning here: a `MessagePort` has exactly one possible sender, so there is no origin to
 * check. What is left is the name and the schema — a message whose name is not declared, or
 * whose argument does not satisfy the schema of that name, is refused with a reason that says
 * which use case and which field, and no service is ever reached.
 *
 * Nothing here knows about Electron or about a port, so all of it runs in a plain Node test.
 */

import {
  PROFILE_REQUESTS,
  type ProfileArguments,
  type ProfileRequestName,
  type ProfileResponse,
} from '@hemera/ipc'
import { Effect } from 'effect'

import { Preferences } from './preferences.ts'
import { ProfileStatus } from './status.ts'
import type { DatabaseError } from './storage/database.ts'

/** What the main process sends: an identifier to answer, a use case, and its argument. */
export interface ProfileRequest {
  id: number
  name: string
  // oxlint-disable-next-line anti-slop/no-unknown-type-aliases -- what arrives is unparsed by definition; `decideRequest` is what parses it
  argument: unknown
}

/** What goes back, on the identifier it came in on. */
export type ProfileAnswer<K extends ProfileRequestName = ProfileRequestName> =
  | { id: number; ok: true; value: ProfileResponse<K> }
  | { id: number; ok: false; error: string }

export type RequestDecision<K extends ProfileRequestName> =
  | { accepted: true; name: K; argument: ProfileArguments<K> }
  | { accepted: false; reason: string }

function isDeclared(name: string): name is ProfileRequestName {
  return Object.hasOwn(PROFILE_REQUESTS, name)
}

export function decideRequest(
  name: string,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the I/O boundary itself: the one place a message is still unparsed
  argument: unknown,
): RequestDecision<ProfileRequestName> {
  if (!isDeclared(name)) {
    return { accepted: false, reason: `${name}: refused a use case that is not declared` }
  }

  const read = PROFILE_REQUESTS[name].arguments.safeParse(argument)
  if (!read.success) {
    const issue = read.error.issues[0]
    const field =
      issue === undefined || issue.path.length === 0 ? 'its argument' : issue.path.join('.')
    return {
      accepted: false,
      reason: `${name}: refused a message whose ${field} does not match the use case (${issue?.message ?? 'no detail'})`,
    }
  }
  // SAFETY: `read.data` is the output of `PROFILE_REQUESTS[name].arguments`, the schema that
  // defines `ProfileArguments<typeof name>`; TypeScript cannot carry the key through the lookup.
  return { accepted: true, name, argument: read.data as ProfileArguments<ProfileRequestName> }
}

/**
 * The use case itself, once the message has been read and accepted.
 *
 * Each one is a function of a service, so what this does is choose which and hand it what it
 * was given. Nothing is validated again here: a decision is what stands between a message and
 * this function, and there is no other way in.
 */
export function answer(
  decision: Extract<RequestDecision<ProfileRequestName>, { accepted: true }>,
): Effect.Effect<ProfileResponse<ProfileRequestName>, DatabaseError, Preferences | ProfileStatus> {
  return Effect.gen(function* () {
    if (decision.name === 'profile.status') {
      return yield* (yield* ProfileStatus).read
    }
    const preferences = yield* Preferences
    if (decision.name === 'preferences.read') {
      return yield* preferences.read
    }
    return yield* preferences.write(decision.argument)
  })
}
