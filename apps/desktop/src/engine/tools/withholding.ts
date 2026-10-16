/**
 * Whose content a file read for an agent withholds, in one place (#392).
 *
 * Every tool that reads a file for an agent reads it through the judged open (`./judged.ts`), and
 * that open takes a `Withholding`, which only the sensitive places (`SensitivePlaces`) make: a
 * read path that skips them does not compile. A file in a sensitive place is never opened; its
 * read fails with `content withheld: sensitive place: …`, which a search names beside the file.
 *
 * The one exception is the file a verdict judged (`asked`): a sensitive place always asks there,
 * so the read only happens once the human allowed it, and what it reads is masked as #74 masks it.
 */

import { Effect } from 'effect'

import { type CallSession, SensitivePlaces } from './ports.ts'

/** What starts the reason a read is refused for when the file's content is withheld. */
export const CONTENT_WITHHELD = 'content withheld: '

export class Withholding {
  readonly #withheld: (real: string) => Promise<string | null>

  private constructor(withheld: (real: string) => Promise<string | null>) {
    this.#withheld = withheld
  }

  /** Why the content of the file at a real path is withheld, or null when it may be read. */
  withheld(real: string): Promise<string | null> {
    return this.#withheld(real)
  }

  /**
   * What a session reads without a verdict on the file itself (a search's files, a prototype's
   * kept file, an evidence): every file in a sensitive place is withheld.
   */
  static of(session: CallSession) {
    return Withholding.besides(session, null)
  }

  /**
   * What a session reads of the file a verdict judged (`fs_read`, and what `fs_write` and
   * `fs_edit` compare): that one file is read, since the verdict asked about it; any other is
   * withheld as `of` withholds it.
   */
  static asked(session: CallSession, judged: string) {
    return Withholding.besides(session, judged)
  }

  private static besides(session: CallSession, judged: string | null) {
    return Effect.gen(function* () {
      const places = yield* SensitivePlaces
      return new Withholding(async (real) => {
        if (real === judged) return null
        const place = await Effect.runPromise(places.sensitive(real, { session, writes: false }))
        return place === null ? null : `${CONTENT_WITHHELD}${place}`
      })
    })
  }
}
