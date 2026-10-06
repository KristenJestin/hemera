/**
 * The values of the variables the setup agent proposes (#44), held in the engine's memory only,
 * under the card's id, until the card is decided; never in the database, a card, the Journal, the
 * session's hidden thread, the trace or a log. Each value is a known secret for #35's masking the
 * moment it arrives, so every copy of the call's arguments shows `•••`; once the call is recorded
 * only the values its cards hold stay secrets, until each card is decided. A number, a boolean or
 * a value shorter than six characters is never one: masked as a part of any text, it would hide
 * the words that hold it. An engine that stops forgets them: their cards are then refused at the
 * click.
 */

import { Context, Effect, Layer, Option, Predicate, Schema, Semaphore } from 'effect'

import { Secrets } from '../secrets.ts'

/** The masking source of the values a call carried, before its cards exist. */
const ASKED = 'setup-asked'
/** The masking source of the values the cards hold. */
const HELD = 'setup-held'

export class SetupValues extends Context.Service<
  SetupValues,
  {
    /** Masks every `value` a `setup_propose` call carries, whatever else it holds. */
    readonly heard: (raw: Schema.Json) => Effect.Effect<void>
    /** The call is recorded or refused: its values are secrets no longer, but what a card holds. */
    readonly passed: (raw: Schema.Json) => Effect.Effect<void>
    readonly hold: (cardId: string, value: string) => Effect.Effect<void>
    /** The value of a card, or null when it is no longer held. */
    readonly valueOf: (cardId: string) => Effect.Effect<string | null>
    /** The card is decided: its value is let go of. */
    readonly forget: (cardId: string) => Effect.Effect<void>
    /** One decision at a time per Project, so a card read again inside is decided once. */
    readonly deciding: (
      projectId: string,
    ) => <A, E, R>(decision: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
  }
>()('SetupValues') {}

const Asked = Schema.Struct({
  changes: Schema.Array(Schema.Struct({ value: Schema.optionalKey(Schema.Unknown) })),
})
const readAsked = Schema.decodeUnknownOption(Asked)

/** Every string under a `value` key of a call's changes, whatever their kind. */
export const valuesIn = (raw: Schema.Json): ReadonlyArray<string> =>
  Option.match(readAsked(raw), {
    onNone: () => [],
    onSome: (asked) =>
      asked.changes.flatMap((change) => (Predicate.isString(change.value) ? [change.value] : [])),
  })

/** Whether a value is worth masking: not a number, not a boolean, six characters or more. */
const secretWorthy = (value: string): boolean => {
  const trimmed = value.trim()
  return (
    trimmed.length >= 6 &&
    !/^[-+]?\d+(?:[.,]\d+)?$/.test(trimmed) &&
    !['true', 'false'].includes(trimmed.toLowerCase())
  )
}

export const setupValuesLayer = Layer.effect(
  SetupValues,
  Effect.gen(function* () {
    const secrets = yield* Secrets
    const held = new Map<string, string>()
    const asked = new Set<string>()
    const decisions = new Map<string, Semaphore.Semaphore>()
    const register = () => {
      secrets.register(ASKED, [...asked])
      secrets.register(HELD, [...held.values()].filter(secretWorthy))
    }
    return {
      heard: (raw) =>
        Effect.sync(() => {
          for (const value of valuesIn(raw).filter(secretWorthy)) asked.add(value)
          register()
        }),
      passed: (raw) =>
        Effect.sync(() => {
          for (const value of valuesIn(raw)) asked.delete(value)
          register()
        }),
      hold: (cardId, value) =>
        Effect.sync(() => {
          held.set(cardId, value)
          asked.delete(value)
          register()
        }),
      valueOf: (cardId) => Effect.sync(() => held.get(cardId) ?? null),
      forget: (cardId) =>
        Effect.sync(() => {
          held.delete(cardId)
          register()
        }),
      deciding: (projectId) => {
        const one = decisions.get(projectId) ?? Semaphore.makeUnsafe(1)
        decisions.set(projectId, one)
        return Semaphore.withPermits(one, 1)
      },
    }
  }),
)
