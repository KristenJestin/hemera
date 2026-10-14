/**
 * What Review asks of the tools' gate (#341):
 *
 * - **The hold.** While a mission is in Review, its sessions are refused `fs_write`, `fs_edit` and
 *   `commands_run`, a role guard checked before any verdict: it never becomes a question.
 * - **Images read by path** (open question 37). `fs_read` of a png, a jpeg or a webp in the
 *   session's own `missions/<key>/evidence/` answers the image, for the Builder and the Planner;
 *   another mission's evidence is refused with its place (CT-17), never asked.
 */

import { readFile } from 'node:fs/promises'
import { relative, sep } from 'node:path'

import { type Role, type ToolName, reviewToolRefusal, sniffImage } from '@hemera/core/domain'
import { eq } from 'drizzle-orm'
import { Effect, Option } from 'effect'

import { ProfileHome } from '../profile-home.ts'
import { Database } from '../storage/database.ts'
import { missions } from '../storage/schema.ts'
import { MISSIONS_FOLDER } from '../memory/files.ts'
import { type ToolAnswer, refusal } from '../tools/files.ts'
import { containedIn } from '../tools/paths.ts'
import { type CallSession, SensitivePlaces } from '../tools/ports.ts'

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
    if (!containedIn(dataFolder, path)) return null
    const [first, , third] = relative(dataFolder, path).split(sep)
    if (first !== MISSIONS_FOLDER || third !== 'evidence') return null
    const sensitive = yield* SensitivePlaces.use((places) =>
      places.sensitive(path, { session, writes: false }),
    )
    if (sensitive !== null) return refusal(`refused: ${sensitive}`)
    if (!IMAGE_READERS.includes(session.role)) return null
    const bytes = yield* Effect.tryPromise(() => readFile(path)).pipe(Effect.option)
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
