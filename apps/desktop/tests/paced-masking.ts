/**
 * The proof that the engine keeps answering while a large file is masked (#402, as #338 proved it
 * for a CLI's output): a registry whose masks are watched. A fiber counts its turns for as long
 * as a paced mask of a large text runs, and every mask of a large text that is not paced is
 * counted: such a mask holds the engine, whatever else runs. No bound of time, only turns.
 */

import { Effect, Fiber } from 'effect'

import { type SecretsRegistry, secretsRegistry } from '../src/engine/secrets.ts'

/** A text this long is a large file: masking it takes many slices. */
export const LARGE_TEXT = 256 * 1024

/** What the watched registry saw of the masks of large texts. */
export interface MaskWatch {
  /** The masks of a large text that held the engine for their whole run. */
  syncOnLarge: number
  /** For each paced mask of a large text, the turns another fiber took while it ran. */
  readonly pacedTurns: number[]
}

/** A registry that masks as the engine's does, watched, and what it saw. */
export function watchedSecrets(register: (secrets: SecretsRegistry) => void) {
  const real = secretsRegistry()
  register(real)
  const watch: MaskWatch = { syncOnLarge: 0, pacedTurns: [] }
  const paced =
    (mask: (text: string) => ReturnType<SecretsRegistry['maskPaced']>) => (text: string) =>
      text.length < LARGE_TEXT
        ? mask(text)
        : Effect.gen(function* () {
            const turns = { count: 0 }
            const counter = yield* Effect.forkChild(
              Effect.forever(
                Effect.sync(() => {
                  turns.count += 1
                }).pipe(Effect.andThen(Effect.yieldNow)),
              ),
            )
            const masked = yield* mask(text).pipe(Effect.ensuring(Fiber.interrupt(counter)))
            watch.pacedTurns.push(turns.count)
            return masked
          })
  const secrets: SecretsRegistry = {
    ...real,
    mask: (text) => {
      if (text.length >= LARGE_TEXT) watch.syncOnLarge += 1
      return real.mask(text)
    },
    maskPaced: paced(real.maskPaced),
    maskPrinted: paced(real.maskPrinted),
  }
  return { secrets, watch, unwatched: real }
}

/**
 * A JSON text of about `size` characters (a lockfile's shape) holding `value` in a few places.
 */
export function largeJson(size: number, value: string): string {
  const entry = (at: number) =>
    JSON.stringify({
      name: `package-${String(at)}`,
      version: `1.${String(at)}.0`,
      resolved: `https://registry.example/package-${String(at)}.tgz`,
      note: at % 997 === 0 ? `token ${value}` : 'plain',
    })
  const entries: string[] = []
  let length = 2
  for (let at = 0; length < size; at += 1) {
    const one = entry(at)
    entries.push(one)
    length += one.length + 1
  }
  return `[${entries.join(',')}]`
}
