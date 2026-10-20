/**
 * Whose content a file read for an agent withholds, in one place (#392).
 *
 * A file tool reads a file for an agent through the judged open (`./judged.ts`), and that open
 * takes a `Withholding`, which only the sensitive places (`SensitivePlaces`) make: a read through
 * it that skips them does not compile. A file in a sensitive place, or a second name of one (a
 * hard link), is never opened; its read fails with `content withheld: sensitive place: …`, which
 * a search names beside the file. What holds it beyond the types is checked by
 * `tools/boundaries.ts`: under `engine/tools/`, only `judged.ts` reads a file with `node:fs`, and
 * only the gate makes the exception below.
 *
 * The one exception is the file of the call a verdict judged (`asked`): a sensitive place always
 * asks there, so the read only happens once the human allowed it, and what it reads is masked as
 * #74 masks it.
 */

import { Effect } from 'effect'

import { type CallSession, type JudgedCall, SensitiveLinks, SensitivePlaces } from './ports.ts'

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
  static of(session: CallSession, links = new SensitiveLinks()) {
    return Withholding.besides(session, null, links)
  }

  /**
   * What a session reads of the file of a call a verdict judged (`fs_read`, and what `fs_write`
   * and `fs_edit` compare): that call's own path is read, since the verdict asked about it; any
   * other file is withheld as `of` withholds it. Made by the gate only, once the verdict allowed
   * the call or the human did (`tools/boundaries.ts`).
   */
  static asked(judged: JudgedCall) {
    return Withholding.besides(
      judged.session,
      judged.path?.resolved ?? null,
      judged.links ?? new SensitiveLinks(),
    )
  }

  private static besides(session: CallSession, judged: string | null, links: SensitiveLinks) {
    return Effect.gen(function* () {
      const places = yield* SensitivePlaces
      return new Withholding(async (real) => {
        if (real === judged) return null
        const place = await Effect.runPromise(
          places.sensitive(real, { session, writes: false, links }),
        )
        return place === null ? null : `${CONTENT_WITHHELD}${place}`
      })
    })
  }
}
