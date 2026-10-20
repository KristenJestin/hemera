/**
 * The images of a mission's pull requests (R7): which images are published, and how the
 * description shows them.
 *
 * - **Which.** Only an image of the mission's evidence (PNG, JPEG, WebP) the user dropped in a
 *   feedback of theirs (#341), unless they unmarked it, or one they marked publishable. Nothing else
 *   (logs, an agent's images, other evidence) is ever sent. In the order they were added; one file
 *   once, however many evidences hold it.
 * - **Alt text.** The first line of the feedback it was dropped in, or the evidence's name, kept to
 *   one line without the brackets and `#` that would end it early, and made unique among the
 *   images of a call: the description read back says which file became which copy by it.
 * - **The description.** `{images}` becomes one `![alt](./<file>)` per image, which gh's `--attach`
 *   rewrites to the uploaded copy, or a list of file names where the forge cannot host them.
 * - **Read as Hemera kept it.** Before gh is given a file, it is read through the engine's own
 *   read: never through a link, never a pipe, at most the size an image of the evidence may be,
 *   and holding what its name says (its sha256). The evidence is never changed.
 */

import { createHash } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

import { EVIDENCE_IMAGE_MAX_BYTES, evidenceExtension } from '@hemera/core/domain'
import { and, asc, eq, inArray, ne } from 'drizzle-orm'
import { Effect } from 'effect'

import { Database, refusedWhile } from '../storage/database.ts'
import { memoryEvidence, reviewFeedback, reviewFeedbackImages } from '../storage/schema.ts'
import { readOwnSync } from '../tools/judged.ts'

/** The media types an image the forge hosts is kept as. */
export const IMAGE_TYPES: ReadonlyArray<string> = ['image/png', 'image/jpeg', 'image/webp']

/** gh attaches at most this many files in one call. */
export const ATTACH_AT_ONCE = 50

/** An image of the mission chosen for its pull requests. */
export interface ChosenImage {
  readonly evidenceId: string
  readonly name: string
  readonly alt: string
  /** Its file in the evidence folder, named by what it holds. */
  readonly file: string
  readonly sha256: string
}

/** An alt text on one line, without what would end it early. */
const altOf = (text: string, name: string): string => {
  const line = (text.split('\n').find((one) => one.trim() !== '') ?? '')
    .replace(/[[\]#()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
    .trim()
  return line === '' ? name.replace(/[[\]#()]/g, ' ').trim() : line
}

/** The alt texts made unique: a second one the same is numbered. */
const unique = (alts: ReadonlyArray<string>): ReadonlyArray<string> => {
  const seen = new Set<string>()
  return alts.map((alt) => {
    let made = alt
    for (let next = 2; seen.has(made); next += 1) made = `${alt} (${String(next)})`
    seen.add(made)
    return made
  })
}

/**
 * The mission's images chosen for its pull requests, in the order they were added, each alt text
 * masked as `mask` does.
 */
export const chosenImages = (missionId: string, mask: (text: string) => string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const rows = yield* database
      .select()
      .from(memoryEvidence)
      .where(
        and(
          eq(memoryEvidence.missionId, missionId),
          inArray(memoryEvidence.mediaType, [...IMAGE_TYPES]),
        ),
      )
      .orderBy(asc(memoryEvidence.addedAt))
      .pipe(Effect.mapError(refusedWhile('reading the mission’s images')))
    const dropped = yield* database
      .select({ evidenceId: reviewFeedbackImages.evidenceId, body: reviewFeedback.body })
      .from(reviewFeedbackImages)
      .innerJoin(reviewFeedback, eq(reviewFeedback.id, reviewFeedbackImages.feedbackId))
      .where(
        and(
          eq(reviewFeedback.missionId, missionId),
          eq(reviewFeedback.authorKind, 'user'),
          ne(reviewFeedback.state, 'withdrawn'),
        ),
      )
      .orderBy(asc(reviewFeedback.createdAt), asc(reviewFeedbackImages.position))
      .pipe(Effect.mapError(refusedWhile('reading the feedback’s images')))
    const said = new Map<string, string>()
    for (const one of dropped) if (!said.has(one.evidenceId)) said.set(one.evidenceId, one.body)
    const files = new Set<string>()
    const chosen = rows.flatMap((row) => {
      const feedback = said.get(row.id)
      const publishable = row.publishable === null ? feedback !== undefined : row.publishable === 1
      const file = `${row.sha256}.${evidenceExtension(row.mediaType)}`
      if (!publishable || files.has(file)) return []
      files.add(file)
      return [{ row, file, alt: mask(altOf(feedback ?? '', row.name)) }]
    })
    const alts = unique(chosen.map((one) => one.alt))
    return chosen.map((one, at): ChosenImage => ({
      evidenceId: one.row.id,
      name: one.row.name,
      alt: alts[at] ?? one.alt,
      file: one.file,
      sha256: one.row.sha256,
    }))
  })

/** What `{images}` becomes where the forge hosts them: gh rewrites each reference. */
export const imageLines = (images: ReadonlyArray<Pick<ChosenImage, 'alt' | 'file'>>): string =>
  images.map((image) => `![${image.alt}](./${image.file})`).join('\n')

/** What `{images}` becomes elsewhere: the file names. */
export const nameList = (images: ReadonlyArray<Pick<ChosenImage, 'name'>>): string =>
  images.map((image) => `- ${image.name}`).join('\n')

/**
 * The copy an image became in a description read back, by its alt text: null while its reference
 * still names the file (it was not uploaded) or it is not there.
 */
export const copyIn = (body: string, alt: string): string | null => {
  const opening = `![${alt}](`
  for (let at = body.indexOf(opening); at >= 0; at = body.indexOf(opening, at + 1)) {
    const start = at + opening.length
    const end = body.indexOf(')', start)
    if (end < 0) return null
    const url = body.slice(start, end)
    if (/^https?:\/\//.test(url)) return url
  }
  return null
}

/**
 * Whether an image's file can be handed to gh: read through the engine's own read and holding
 * what Hemera kept. Null when it can, otherwise why not, in words.
 */
export const unreadable = (folder: string, image: Pick<ChosenImage, 'file'>) => {
  const path = join(folder, image.file)
  // Its file is named by the sha256 of what it holds.
  const [sha256 = ''] = image.file.split('.')
  // gh would read what follows a `#` as the alt text.
  if (path.includes('#'))
    return 'The path of the data folder holds a #, which gh would read as the start of the alt text.'
  try {
    const real = join(realpathSync.native(dirname(path)), basename(path))
    const { bytes } = readOwnSync(path, EVIDENCE_IMAGE_MAX_BYTES, real)
    if (createHash('sha256').update(bytes).digest('hex') !== sha256) {
      return 'The evidence file no longer holds what Hemera kept.'
    }
    return null
  } catch (cause) {
    return `The evidence file could not be read as Hemera kept it: ${cause instanceof Error ? cause.message : String(cause)}`
  }
}
