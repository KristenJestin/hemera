/**
 * Hemera's own images: its screenshots (#253), in the folder of the data folder they are written
 * to, and the images of a mission's evidence (R7), in `missions/<key>/evidence/`; and the check
 * that a path names one of them, the only files a forge CLI may attach to a pull request.
 */

import { realpathSync } from 'node:fs'
import { isAbsolute, join, relative, sep } from 'node:path'

/** The folder of the data folder Hemera writes its screenshots to. */
export const screenshotsFolder = (dataFolder: string): string => join(dataFolder, 'screenshots')

/** The real path of a file or folder, or null when there is none. */
const realPathOf = (path: string): string | null => {
  try {
    return realpathSync.native(path)
  } catch {
    return null
  }
}

/**
 * Whether a path is under the folder by its words alone: absolute, no `.` or `..` segment, the
 * folder's path then more. Read before anything is resolved: a network path (`\\host\share\…`)
 * would be reached by resolving it.
 */
const writtenUnder = (folder: string, path: string): boolean => {
  if (!isAbsolute(path)) return false
  if (path.split(/[\\/]/).some((part) => part === '.' || part === '..')) return false
  const root = folder.endsWith(sep) ? folder : `${folder}${sep}`
  // Windows compares paths without their case.
  const [given, under] =
    process.platform === 'win32' ? [path.toLowerCase(), root.toLowerCase()] : [path, root]
  return given.length > under.length && given.startsWith(under)
}

/**
 * The real path of the screenshot a path names, or null when it names none: written under the
 * folder, then resolved (a link followed) to an existing file whose real path is inside the
 * folder's. The real path is the one to read: the path given could be swapped after the check.
 */
export const screenshotIn =
  (folder: string, resolve: (path: string) => string | null = realPathOf) =>
  (path: string): string | null => {
    if (!writtenUnder(folder, path)) return null
    const real = resolve(path)
    const root = resolve(folder)
    if (real === null || root === null) return null
    const inside = relative(root, real)
    return inside !== '' && !inside.startsWith('..') && !isAbsolute(inside) ? real : null
  }

/**
 * The real path of a file of a mission's evidence a path names, or null: under the missions
 * folder by its words, and resolved to a file whose real path is `<key>/evidence/<file>` in it.
 */
export const evidenceIn =
  (missions: string, resolve: (path: string) => string | null = realPathOf) =>
  (path: string): string | null => {
    const real = screenshotIn(missions, resolve)(path)
    const root = resolve(missions)
    if (real === null || root === null) return null
    const parts = relative(root, real).split(sep)
    return parts.length === 3 && parts[1] === 'evidence' ? real : null
  }
