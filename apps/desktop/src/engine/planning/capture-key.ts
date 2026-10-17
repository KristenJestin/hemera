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
import { existsSync, linkSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { Effect, Predicate } from 'effect'

/** The file the key is kept in, in the data folder. */
export const CAPTURE_KEY_FILE = 'capture.key'

const KEY_BYTES = 32

const codeOf = (cause: Error): string | undefined =>
  'code' in cause && Predicate.isString(cause.code) ? cause.code : undefined

/** How the key's bytes reach a new file: the owner's only, never over a file already there. */
export type KeyWrite = (file: string, bytes: Uint8Array) => void

const writeOwnerOnly: KeyWrite = (file, bytes) =>
  writeFileSync(file, bytes, { flag: 'wx', mode: 0o600 })

/**
 * The key is written to a file of its own beside its name, and given that name only once whole,
 * by a hard link: unlike a rename, which on Windows replaces a file already there, a link refuses
 * (`EEXIST`) one a concurrent start put in place first, and that one is then read. A write that
 * dies half way leaves a stray file under another name, never a key cut short under this one.
 */
const putInPlace = (file: string, write: KeyWrite): void => {
  const pending = `${file}.${randomBytes(6).toString('hex')}.tmp`
  try {
    write(pending, randomBytes(KEY_BYTES))
    linkSync(pending, file)
  } catch (cause) {
    if (!(cause instanceof Error) || codeOf(cause) !== 'EEXIST') throw cause
  } finally {
    try {
      unlinkSync(pending)
    } catch {
      // Nothing was written, or the write died before the file was made: nothing to remove.
    }
  }
}

/** The profile's capture key, made the first time it is asked for. */
export const captureKey = (
  dataFolder: string,
  write: KeyWrite = writeOwnerOnly,
): Effect.Effect<Buffer> =>
  Effect.sync(() => {
    const file = join(dataFolder, CAPTURE_KEY_FILE)
    if (!existsSync(file)) putInPlace(file, write)
    const key = readFileSync(file)
    if (key.length !== KEY_BYTES) throw new Error(`${file} is not a capture key`)
    return key
  })
