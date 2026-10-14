/**
 * The file a path the gate judged really is, when a tool uses it (#373).
 *
 * The gate judges a path by where it really leads, then the tool uses it: between the two, a
 * command running beside the session can plant a link or a junction on the way, and a file can
 * carry a second name (a hard link) whose other name lies in a place the session may not reach.
 * So a file is opened once and the opened file is checked, then used through that handle only:
 *
 * - its path is still its own real path, with no link or junction anywhere on it;
 * - the file at that path is the very one opened (same device, same file id), so a link planted
 *   for the open and taken away before the check is caught;
 * - it has a single name on the disk: Hemera never makes a hard link, and a file that has one may
 *   hold what another place keeps.
 *
 * A folder cannot be opened and listed through one handle from Node: it is checked the same way
 * after it is read, and what was read is used only when the check holds.
 */

import { type FileHandle, open, realpath, stat } from 'node:fs/promises'

/** Why a path is no longer the one judged: a link or a junction now stands on the way. */
export const THROUGH_A_LINK =
  'a link or a junction now stands on its way, and a path is never followed after it was judged'

/** Why a file with more than one name is not used. */
export const MORE_THAN_ONE_NAME =
  'it has more than one name on the disk (a hard link), and what it holds may belong to a place this session may not reach'

/** Thrown when a path is not the file or folder that was judged. */
export class NotJudged extends Error {}

/** Checks that `path` still leads to `real`, the real path the gate judged: no link on its way. */
export async function stillJudged(path: string, real: string = path): Promise<void> {
  if ((await realpath(path)) !== real) throw new NotJudged(THROUGH_A_LINK)
}

/**
 * Opens the file at `path` and checks the opened file is the one judged, at the real path `real`
 * (the path itself when the gate handed it over), with a single name. The handle is the caller's
 * to close.
 */
export async function openJudged(
  path: string,
  options: {
    readonly real?: string
    readonly flags?: string
    readonly mode?: number | undefined
  } = {},
): Promise<FileHandle> {
  const handle = await open(path, options.flags ?? 'r', options.mode)
  try {
    const opened = await handle.stat({ bigint: true })
    await stillJudged(path, options.real ?? path)
    const named = await stat(path, { bigint: true })
    if (opened.dev !== named.dev || opened.ino !== named.ino) throw new NotJudged(THROUGH_A_LINK)
    if (opened.isFile() && opened.nlink > 1n) throw new NotJudged(MORE_THAN_ONE_NAME)
    return handle
  } catch (cause) {
    await handle.close()
    throw cause
  }
}

/** The whole file at a judged path, read through the handle that was checked. */
export async function readJudged(path: string): Promise<Buffer> {
  const handle = await openJudged(path)
  try {
    return await handle.readFile()
  } finally {
    await handle.close()
  }
}
