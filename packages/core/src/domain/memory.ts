/**
 * The rules of a mission's Memory: what any agent picks a mission up from, the way a bot keeps its
 * soul and memory in files.
 *
 * - **Now**: where the mission stands, who has the ball and what comes next; Hemera's fields are
 *   computed, and each live session owns one "doing" line; "next" is the stage's main session's.
 * - **Journal**: what happened, one line per domain event a mapper turns into a line, append-only.
 * - **Notes**: what was learned on the way, added and condensed.
 * - **Evidence**: the heavy proofs (full logs, images), by their sha256, kept with the mission.
 */

import type { Role } from './tools.ts'
import type { Stage } from './mission.ts'

/** How many Journal lines a page holds. */
export const JOURNAL_PAGE = 50

/** How many of the last Journal lines a brief carries. */
export const JOURNAL_TAIL = 30

/** The largest image the evidence store takes. */
export const EVIDENCE_IMAGE_MAX_BYTES = 10 * 1024 * 1024

/** The longest "doing" line, "next" step, Journal line and note an agent writes. */
export const NOW_TEXT_MAX = 500
export const JOURNAL_TEXT_MAX = 2000
export const NOTE_TEXT_MAX = 2000
export const NOTE_TOPIC_MAX = 80

/**
 * The role of a stage's main session: the Planner in Planning, the Builder in Building. Only it
 * sets the mission's next step and condenses its notes; the other stages have none.
 */
export const MAIN_ROLES: Partial<Record<Stage, Role>> = {
  planning: 'planner',
  building: 'builder',
}

export const mainRoleOf = (stage: Stage): Role | null => MAIN_ROLES[stage] ?? null

/** The images the evidence store takes, by the media type their first bytes say. */
export const EVIDENCE_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const
export type EvidenceImageType = (typeof EVIDENCE_IMAGE_TYPES)[number]

/** An image recognised by its first bytes: one the store takes, or a gif, which it refuses. */
export type SniffedImage = EvidenceImageType | 'image/gif'

const startsWith = (bytes: Uint8Array, prefix: ReadonlyArray<number>, at = 0): boolean =>
  bytes.length >= at + prefix.length && prefix.every((byte, index) => bytes[at + index] === byte)

/** The image a file is by its first bytes, never by its name; null when it is none of these. */
export function sniffImage(bytes: Uint8Array): SniffedImage | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  // RIFF, four bytes of size, then WEBP.
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8))
    return 'image/webp'
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return 'image/gif'
  return null
}

/** The extension an evidence file takes from its media type. */
export const evidenceExtension = (mediaType: string): string => {
  switch (mediaType) {
    case 'image/png':
      return 'png'
    case 'image/jpeg':
      return 'jpg'
    case 'image/webp':
      return 'webp'
    default:
      return 'txt'
  }
}

/** A size as a person reads it: "14 MB", "320 KB", "12 bytes". */
export function sizeSaid(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${String(Math.round(bytes / (1024 * 1024)))} MB`
  if (bytes >= 1024) return `${String(Math.round(bytes / 1024))} KB`
  return `${String(bytes)} bytes`
}

const KEY = /^([A-Za-z][A-Za-z0-9]{1,5})-(\d+)$/

/** A mission key read back into its prefix and number; null when it is not one. */
export function missionKeyParts(key: string): { prefix: string; number: number } | null {
  const found = KEY.exec(key.trim())
  if (found === null) return null
  return { prefix: (found[1] ?? '').toUpperCase(), number: Number(found[2]) }
}
