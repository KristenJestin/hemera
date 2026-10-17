/**
 * The Go module of a proof's test file (#462), which tells a Go red's package apart: the `go.mod`
 * nearest above the file, from its folder up to its repository's, as Go itself finds it (a
 * `go.work` makes no module). Each `go.mod` is read on the engine's own behalf, never through a
 * link leading out of the repository, never a pipe waited on, never more than `GO_MOD_CAP`.
 */

import { lstat, realpath } from 'node:fs/promises'
import { join, relative } from 'node:path'

import { type GoModule, goModulePath } from '@hemera/core/domain'

import { readOwnSync } from '../tools/judged.ts'
import { containedIn, resolvePath } from '../tools/paths.ts'

/** The most of a `go.mod` Hemera reads. */
export const GO_MOD_CAP = 1024 * 1024

/** Whether nothing at all is at a path, not even a link. */
const nothingAt = (path: string) =>
  lstat(path).then(
    () => false,
    (cause: NodeJS.ErrnoException) => cause.code === 'ENOENT',
  )

/**
 * The module of the test file at `testPath` in the repository at `folder`, under the Workspace's
 * `root`: the first `go.mod` found from the file's folder up to the repository's names it, and its
 * folder. Null when none is found, or when the nearest one does not read (a link leading out, a
 * pipe, a folder, a file over the cap or that may not be opened, no single `module` line): a
 * farther `go.mod` never decides in its place.
 */
export const goModuleOf = async (
  root: string,
  folder: string,
  testPath: string,
): Promise<GoModule | null> => {
  const repository = join(await realpath(root), relative(root, folder))
  const folders = testPath.split(/[\\/]+/).filter((part) => part !== '' && part !== '.')
  /** The module the `go.mod` of the file's folders down to `depth` names, else a nearer one's. */
  const from = async (depth: number): Promise<GoModule | null> => {
    if (depth < 0) return null
    const below = folders.slice(0, depth).join('/')
    const named = below === '' ? 'go.mod' : `${below}/go.mod`
    if (await nothingAt(join(repository, named))) return from(depth - 1)
    const found = await resolvePath(root, folder, named, '')
    if (!found.certain || !containedIn(repository, found.path)) return null
    try {
      const text = readOwnSync(found.path, GO_MOD_CAP, found.path).bytes.toString('utf8')
      const path = goModulePath(text)
      return path === null ? null : { path, folder: below }
    } catch {
      return null
    }
  }
  return from(folders.length - 1)
}
