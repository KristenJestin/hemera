/**
 * What Review asks of the tools' gate (#341):
 *
 * - **The hold.** While a mission is in Review, its sessions are refused `fs_write`, `fs_edit` and
 *   `commands_run`, a role guard checked before any verdict: it never becomes a question.
 * - **Images read by path** (open question 37). `fs_read` of a png, a jpeg or a webp in the
 *   session's own `missions/<key>/evidence/` answers the image, for the Builder and the Planner;
 *   another mission's evidence is refused with its place (CT-17), never asked. The file is read
 *   only when its real path is that very path in the session's own evidence: a link or a folder
 *   on the way is refused, never followed (CT-17: "after links are resolved").
 */

import { lstat, readFile, realpath } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'

import { type Role, type ToolName, reviewToolRefusal, sniffImage } from '@hemera/core/domain'
import { eq } from 'drizzle-orm'
import { Effect, Option } from 'effect'

import { ProfileHome } from '../profile-home.ts'
import { Database } from '../storage/database.ts'
import { missions } from '../storage/schema.ts'
import { MISSIONS_FOLDER, missionKeyOf } from '../memory/files.ts'
import { type ToolAnswer, refusal } from '../tools/files.ts'
import { containedIn } from '../tools/paths.ts'
import { type CallSession, SensitivePlaces } from '../tools/ports.ts'

/** Why a read of the mission's evidence through a link, or of what is not a file, is refused. */
const LINKED =
  "this is not a file of the mission's evidence: a link or a folder there is never followed"

/** The roles that read the images of a round's feedback by their path. */
const IMAGE_READERS: ReadonlyArray<Role> = ['builder', 'planner']

/** Why a session of a mission may not call a tool now, or null: the hold of Review. */
export const reviewHeld = (missionId: string | null, tool: ToolName) =>
  Effect.gen(function* () {
    if (missionId === null) return null
    const database = yield* Database
    const [mission] = yield* database
      .select({ stage: missions.stage })
      .from(missions)
      .where(eq(missions.id, missionId))
      .pipe(Effect.orElseSucceed(() => []))
    return mission?.stage === 'review' ? reviewToolRefusal('review', tool) : null
  })

/**
 * What `fs_read` of a file in a mission's evidence answers: the image of the session's own, a
 * refusal naming another mission's place, or null when the read goes on as any read.
 */
export const evidenceRead = (session: CallSession, path: string) =>
  Effect.gen(function* () {
    const { dataFolder } = yield* ProfileHome
    const realData = yield* Effect.tryPromise(() => realpath(dataFolder)).pipe(Effect.option)
    const data = [dataFolder, ...Option.toArray(realData)].find((one) => containedIn(one, path))
    if (data === undefined) return null
    const [first, key, third] = relative(data, path).split(sep)
    if (first !== MISSIONS_FOLDER || third !== 'evidence') return null
    const sensitive = yield* SensitivePlaces.use((places) =>
      places.sensitive(path, { session, writes: false }),
    )
    if (sensitive !== null) return refusal(`refused: ${sensitive}`)
    // Only the session's own evidence is answered as an image; a dependency's is read as any file.
    if (session.missionId === null) return null
    const ownKey = yield* missionKeyOf(session.missionId).pipe(Effect.option)
    if (Option.isNone(ownKey) || key !== ownKey.value) return null
    // The file itself, never through a link: the places were checked on the path as written.
    const own = join(
      Option.getOrElse(realData, () => dataFolder),
      MISSIONS_FOLDER,
      key,
      'evidence',
    )
    const real = yield* Effect.tryPromise(() => realpath(path)).pipe(Effect.option)
    const file = yield* Effect.tryPromise(() => lstat(path)).pipe(Effect.option)
    const settled = join(own, relative(join(data, MISSIONS_FOLDER, key, 'evidence'), path))
    if (
      Option.isNone(real) ||
      Option.isNone(file) ||
      !file.value.isFile() ||
      real.value !== settled ||
      !containedIn(own, real.value)
    ) {
      return refusal(`refused: ${LINKED}`)
    }
    if (!IMAGE_READERS.includes(session.role)) return null
    const bytes = yield* Effect.tryPromise(() => readFile(real.value)).pipe(Effect.option)
    if (Option.isNone(bytes)) return null
    const image = sniffImage(bytes.value)
    if (image === null || image === 'image/gif') return null
    const answer: ToolAnswer = {
      ok: true,
      refused: false,
      text: `An image of the mission's evidence (${image}, ${String(bytes.value.length)} bytes).`,
      image: { mimeType: image, data: bytes.value.toString('base64') },
    }
    return answer
  })
