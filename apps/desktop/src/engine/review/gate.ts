/**
 * What Review asks of the tools' gate (#341):
 *
 * - **The hold.** While a mission is in Review, its sessions are refused `fs_write`, `fs_edit` and
 *   `commands_run`, a role guard checked before any verdict: it never becomes a question.
 * - **Images read by path** (open question 37). `fs_read` of a png, a jpeg or a webp in the
 *   session's own `missions/<key>/evidence/` answers the image, for the Builder and the Planner;
 *   another mission's evidence is refused with its place (CT-17), never asked. The file is read
 *   only when its real path is that very path in the session's own evidence: a link or a folder
 *   on the way is refused, never followed (CT-17: "after links are resolved"). And only an evidence
 *   Hemera recorded for the mission is served, read by its id and checked against its sha256: a
 *   hard link, or a file replaced on disk, never is.
 */

import { createHash } from 'node:crypto'
import { lstat, realpath } from 'node:fs/promises'
import { basename, dirname, join, relative, sep } from 'node:path'

import { type Role, type ToolName, evidenceExtension, reviewToolRefusal } from '@hemera/core/domain'
import { and, eq } from 'drizzle-orm'
import { Effect, Option } from 'effect'

import { ProfileHome } from '../profile-home.ts'
import { Database } from '../storage/database.ts'
import { memoryEvidence, missions } from '../storage/schema.ts'
import { readEvidence } from '../memory/evidence.ts'
import { MISSIONS_FOLDER, missionKeyOf } from '../memory/files.ts'
import { type ToolAnswer, refusal } from '../tools/files.ts'
import { containedIn } from '../tools/paths.ts'
import { type CallSession, SensitivePlaces } from '../tools/ports.ts'

/** Why a read of the mission's evidence through a link, or of what is not a file, is refused. */
const LINKED =
  "this is not a file of the mission's evidence: a link or a folder there is never followed"

/** Why a file of the evidence folder Hemera did not record for the mission is not served. */
const NOT_RECORDED = 'this is not an evidence Hemera recorded for this mission: it is not served'

/** Why an evidence whose bytes are no longer the ones recorded is not served. */
const CHANGED = 'the evidence file changed on disk since Hemera recorded it: it is not served'

/** The images served as images: what the evidence store keeps, a GIF never. */
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const

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
    // Only what Hemera recorded for this mission, by its name: read by its id, never by the path
    // given, and served only when its bytes are still the ones recorded (a hard link, a swap).
    const name = basename(real.value)
    if (dirname(real.value) !== own) return refusal(`refused: ${NOT_RECORDED}`)
    const database = yield* Database
    const rows = yield* database
      .select({
        id: memoryEvidence.id,
        sha256: memoryEvidence.sha256,
        mediaType: memoryEvidence.mediaType,
      })
      .from(memoryEvidence)
      .where(
        and(
          eq(memoryEvidence.missionId, session.missionId),
          eq(memoryEvidence.sha256, name.split('.')[0] ?? ''),
        ),
      )
      .pipe(Effect.orElseSucceed(() => []))
    const recorded = rows.find(
      (row) => `${row.sha256}.${evidenceExtension(row.mediaType)}` === name,
    )
    if (recorded === undefined) return refusal(`refused: ${NOT_RECORDED}`)
    const image = IMAGE_TYPES.find((one) => one === recorded.mediaType)
    if (image === undefined) return null
    const kept = yield* readEvidence(session.missionId, recorded.id).pipe(Effect.option)
    if (Option.isNone(kept)) return refusal(`refused: ${NOT_RECORDED}`)
    const bytes = Buffer.from(kept.value.bytes)
    if (createHash('sha256').update(bytes).digest('hex') !== recorded.sha256) {
      return refusal(`refused: ${CHANGED}`)
    }
    const answer: ToolAnswer = {
      ok: true,
      refused: false,
      text: `An image of the mission's evidence (${image}, ${String(bytes.length)} bytes).`,
      image: { mimeType: image, data: bytes.toString('base64') },
    }
    return answer
  })
