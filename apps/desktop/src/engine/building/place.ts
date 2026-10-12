/**
 * Where a resolved path falls in a Building's Workspace: the repository that holds it, and its path
 * there. Apart from the loop so that the detector of changes outside Hemera reads it too (#148).
 */

import { realpathSync } from 'node:fs'

import { Option } from 'effect'

import { type BuildingRow, bases } from './tasks.ts'

/** A folder as the file tools resolve paths: its real path, or as written when it is gone. */
const realFolder = (folder: string): string => {
  try {
    return realpathSync.native(folder)
  } catch {
    return folder
  }
}

/**
 * A path of a repository of the Workspace, or null when it is in none. Both sides are real paths;
 * on Windows the case of their letters does not tell two paths apart.
 */
export const inRepository = (
  repositories: ReadonlyArray<{ readonly repository: string; readonly folder: string }>,
  resolved: string,
  platform: NodeJS.Platform = process.platform,
): { readonly repository: string; readonly path: string } | null => {
  const separator = platform === 'win32' ? '\\' : '/'
  const folded = (path: string) => (platform === 'win32' ? path.toLowerCase() : path)
  const at = folded(resolved)
  const found = repositories
    .toSorted((a, b) => b.folder.length - a.folder.length)
    .find((one) => at.startsWith(`${folded(one.folder)}${separator}`))
  return found === undefined
    ? null
    : {
        repository: found.repository,
        path: resolved
          .slice(found.folder.length + 1)
          .split(separator)
          .join('/'),
      }
}

/** A resolved path in a repository of the Building, or null. */
export const fileOf = (building: BuildingRow, resolved: string) =>
  inRepository(
    Option.getOrElse(bases.read(building.bases), () => []).map((base) => ({
      repository: base.repository,
      folder: realFolder(base.folder),
    })),
    resolved,
  )
