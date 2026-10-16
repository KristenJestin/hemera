/**
 * The key of a Probe's capture (#425): what the hash of a file whose content is withheld is keyed
 * with, so a change to it is seen on every platform while the stored hash cannot be brute-forced
 * back into a short secret (a `.env` of a few words).
 *
 * Thirty-two random bytes, made once per profile in a file of its own in the data folder, readable
 * by its owner only, and never written into the database beside the hashes: a copy of the database
 * alone tells nothing. A key lost (a profile restored without it) only makes the files a Probe's
 * preparation left read as changed by it.
 */

import { randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { Effect, Predicate } from 'effect'

/** The file the key is kept in, in the data folder. */
export const CAPTURE_KEY_FILE = 'capture.key'

const KEY_BYTES = 32

const codeOf = (cause: Error): string | undefined =>
  'code' in cause && Predicate.isString(cause.code) ? cause.code : undefined

/** The profile's capture key, made the first time it is asked for. */
export const captureKey = (dataFolder: string): Effect.Effect<Buffer> =>
  Effect.sync(() => {
    const file = join(dataFolder, CAPTURE_KEY_FILE)
    try {
      // `wx`: never over a key another start made first; then that one is read.
      writeFileSync(file, randomBytes(KEY_BYTES), { flag: 'wx', mode: 0o600 })
    } catch (cause) {
      if (!(cause instanceof Error) || codeOf(cause) !== 'EEXIST') throw cause
    }
    const key = readFileSync(file)
    if (key.length !== KEY_BYTES) throw new Error(`${file} is not a capture key`)
    return key
  })
