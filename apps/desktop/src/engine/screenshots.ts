/**
 * Hemera's own screenshots (#253): the folder of the data folder they are written to, and the
 * check that a path names one of them, the only files a forge CLI may attach to a pull request.
 */

import { realpathSync } from 'node:fs'
import { isAbsolute, join, relative } from 'node:path'

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
 * Whether a path names an existing file of the folder: absolute, and real (a link followed) inside
 * the folder's real path. Any other file would be read and uploaded.
 */
export const isScreenshotIn =
  (folder: string) =>
  (path: string): boolean => {
    if (!isAbsolute(path)) return false
    const real = realPathOf(path)
    const root = realPathOf(folder)
    if (real === null || root === null) return false
    const inside = relative(root, real)
    return inside !== '' && !inside.startsWith('..') && !isAbsolute(inside)
  }
