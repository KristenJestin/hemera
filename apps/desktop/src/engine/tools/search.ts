/**
 * Searching the workspace, bounded and resumable (design D6-04).
 *
 * A search is not a grep: it has a budget of its own — at most `SEARCH_MATCH_LIMIT` matches and
 * `SEARCH_SCAN_BYTES` bytes scanned — and it says which of the two stopped it. The cursor is
 * what makes the budget harmless: it is where the next call continues from, so an agent that
 * wants more of an answer asks for it instead of receiving a truncated one and not knowing.
 *
 * `.gitignore` is respected from the workspace root, and `.git` never is: what the user told Git
 * to ignore is not what they told an agent to read. Only the root's file is read, and only its
 * simple patterns — a pattern list is a convention, not a matcher, and one that refused nothing
 * because it understood a niche syntax would be worse than one that is documented.
 */

import type { Dirent } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'

import {
  SEARCH_MATCH_LIMIT,
  SEARCH_SCAN_BYTES,
  type SearchHit,
  type SearchLimit,
  type SearchResult,
} from '@hemera/core'

/** What a search was asked for: where, what, and where to continue from. */
export interface SearchRequest {
  readonly root: string
  readonly query: string
  /** A folder or a file, relative to the root; the root itself when absent. */
  readonly path?: string | null
  /** Where the previous call stopped, as it handed it back. */
  readonly cursor?: string | null
}

/** Folders that are never walked: what Git keeps, and what no search should ever read. */
const NEVER_WALKED = new Set(['.git', 'node_modules'])

/** A file larger than this is not text worth reading, and is skipped rather than scanned. */
const LARGEST_FILE = SEARCH_SCAN_BYTES

/**
 * Searches the files of a workspace, one call at a time.
 *
 * The walk is deterministic — folders in their sorted order, depth first — because the cursor
 * names a position in it: a walk in the filesystem's own order would resume somewhere else
 * every time, and a search that repeats or skips a file is worse than a slow one.
 */
export async function searchIn(request: SearchRequest): Promise<SearchResult> {
  const ignored = await ignoredPatterns(request.root)
  const start =
    request.path === null || request.path === undefined
      ? request.root
      : join(request.root, request.path)
  const cursor = parseCursor(request.cursor ?? null)
  // Read once, so the two places that judge a position — the resume and the first line — cannot
  // disagree about which line the previous call stopped on.
  const resumePath = cursor === null ? null : cursor.path
  const resumeLine = cursor === null ? 0 : cursor.line

  const hits: SearchHit[] = []
  let scanned = 0
  let stoppedBy: SearchLimit | null = null
  let resumed = cursor === null
  // The last line examined, kept as the cursor's own text: it is written inside the walk below,
  // and a shape read across that boundary is a shape the compiler cannot see.
  let stoppedAt: string | null = null
  const query = request.query.toLowerCase()

  const files = await walk(start, request.root, ignored)

  /**
   * One file, then the next.
   *
   * Recursive rather than a loop, because the step reads from the filesystem and the repository
   * refuses the loop that awaits inside itself. What the recursion costs is nothing next to what
   * the order buys: the same file is read in the same place on every call, which is the whole
   * reason a cursor can name a position at all.
   */
  const scan = async (at: number): Promise<void> => {
    if (stoppedBy !== null || at >= files.length) return
    const file = files[at]
    if (file === undefined) return
    const rel = relative(request.root, file).split(sep).join('/')
    if (!resumed) {
      if (rel !== resumePath) {
        await scan(at + 1)
        return
      }
      resumed = true
    }
    const content = await readText(file)
    if (content === null) {
      await scan(at + 1)
      return
    }

    const lines = content.split('\n')
    // The cursor names the last line the previous call examined, so this one starts at the line
    // after it — the index of that line, since `lines` is zero-based and the cursor is not.
    const from = rel === resumePath ? resumeLine : 0
    scanned += Buffer.byteLength(content, 'utf8')
    for (let index = from; index < lines.length; index += 1) {
      const text = lines[index] ?? ''
      if (text.toLowerCase().includes(query)) {
        hits.push({ path: rel, line: index + 1, text: text.trim().slice(0, 240) })
        stoppedAt = `${rel}:${index + 1}`
        if (hits.length >= SEARCH_MATCH_LIMIT) {
          stoppedBy = 'matches'
          break
        }
      } else {
        stoppedAt = `${rel}:${index + 1}`
      }
    }
    // The budget ended in the middle of the work: the cursor points at the last line read, so
    // the next call starts at the line after it and misses nothing.
    if (stoppedBy === null && scanned >= SEARCH_SCAN_BYTES && at < files.length - 1) {
      stoppedBy = 'scanned'
    }
    await scan(at + 1)
  }
  await scan(0)

  return {
    hits,
    stoppedBy,
    scanned,
    cursor: stoppedBy === null ? null : stoppedAt,
  }
}

/**
 * What a file holds when it is text worth searching, and null when it is not.
 *
 * A NUL byte in the first kilobytes is what a binary file looks like when it is read as text,
 * and a search that returned matches inside a bundle would be a search nobody trusts.
 */
async function readText(file: string): Promise<string | null> {
  try {
    const details = await stat(file)
    if (details.size > LARGEST_FILE) return null
    const content = await readFile(file, 'utf8')
    return content.includes('\u0000') ? null : content
  } catch {
    return null
  }
}

/** The position a cursor names: a path and a line. */
function parseCursor(cursor: string | null): { path: string; line: number } | null {
  if (cursor === null) return null
  const at = cursor.lastIndexOf(':')
  if (at <= 0) return null
  const line = Number.parseInt(cursor.slice(at + 1), 10)
  if (!Number.isSafeInteger(line)) return null
  return { path: cursor.slice(0, at), line }
}

/** The files under a folder, in the order the cursor expects, `.git` and its like left out. */
async function walk(folder: string, root: string, ignored: readonly string[]): Promise<string[]> {
  let entries: Dirent<string>[]
  try {
    entries = await readdir(folder, { withFileTypes: true })
  } catch {
    // A file named where a folder was expected is a search of that one file, not a failure.
    return [folder]
  }
  const sorted = [...entries].sort((left, right) => (left.name < right.name ? -1 : 1))
  const nested = await Promise.all(sorted.map((entry) => inside(entry, folder, root, ignored)))
  return nested.flat()
}

/**
 * What one entry of a folder contributes, or nothing at all when it is not walked.
 *
 * The folders of a level are walked together and their results put back in the sorted order,
 * so the walk is the same every time and is not the filesystem's own order.
 */
async function inside(
  entry: Dirent<string>,
  folder: string,
  root: string,
  ignored: readonly string[],
): Promise<string[]> {
  if (NEVER_WALKED.has(entry.name)) return []
  const path = join(folder, entry.name)
  const rel = relative(root, path).split(sep).join('/')
  if (ignored.some((pattern) => matches(pattern, rel))) return []
  if (entry.isDirectory()) return walk(path, root, ignored)
  return entry.isFile() ? [path] : []
}

/** The root's `.gitignore`, as the simple patterns it holds, comments and blanks left out. */
async function ignoredPatterns(root: string): Promise<string[]> {
  try {
    const text = await readFile(join(root, '.gitignore'), 'utf8')
    return text
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#') && !line.startsWith('!'))
      .map((line) => line.replace(/^\//, '').replace(/\/$/, ''))
  } catch {
    return []
  }
}

/**
 * Whether a relative path is one a pattern names.
 *
 * A pattern with a slash is anchored where it was written; one without matches any segment, as
 * Git reads them; a `*` stands for anything inside one segment and `**` for anything at all.
 */
function matches(pattern: string, path: string): boolean {
  const anchored = pattern.includes('/')
  const expression = new RegExp(
    `${anchored ? '^' : '(^|/)'}${pattern
      .split('**')
      .map((part) =>
        part
          .split('*')
          .map((piece) => piece.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
          .join('[^/]*'),
      )
      .join('.*')}(/|$)`,
  )
  return expression.test(path)
}
