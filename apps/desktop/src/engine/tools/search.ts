/**
 * Searching the workspace, bounded and resumable (design D6-04).
 *
 * A search is not a grep: it has a budget of its own — at most `SEARCH_MATCH_LIMIT` matches and
 * `SEARCH_SCAN_BYTES` bytes scanned — and it says which of the two stopped it. The cursor is
 * what makes the budget harmless: it is where the next call continues from, so an agent that
 * wants more of an answer asks for it instead of receiving a truncated one and not knowing.
 *
 * The walk is streamed: one folder is read at a time, a file is read in chunks, and the budget is
 * checked after every chunk, so a call stops where its budget ends rather than after a whole file
 * or a whole tree has been listed. A file the search passes over — one that looks binary, or one
 * it could not read — is named in the result rather than silently left out.
 *
 * `.gitignore` is respected from the workspace root, and `.git` never is: what the user told Git
 * to ignore is not what they told an agent to read. Only the root's file is read, and only its
 * simple patterns — a pattern list is a convention, not a matcher, and one that refused nothing
 * because it understood a niche syntax would be worse than one that is documented.
 */

import { createReadStream } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'

import {
  SEARCH_MATCH_LIMIT,
  SEARCH_SCAN_BYTES,
  SEARCH_SKIPS_LISTED,
  type SearchHit,
  type SearchLimit,
  type SearchResult,
  type SearchSkip,
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

/** How much of a file is read at a time, and so how far past its budget a call can go. */
const CHUNK_BYTES = 64 * 1024

/** What one call has found so far, shared by the files it reads. */
interface Progress {
  readonly hits: SearchHit[]
  readonly skipped: SearchSkip[]
  skippedCount: number
  scanned: number
  stoppedBy: SearchLimit | null
  /** The last line examined, as the cursor names it. */
  stoppedAt: string | null
}

/**
 * Searches the files of a workspace, one call at a time.
 *
 * The walk is deterministic — folders in their sorted order, depth first — because the cursor
 * names a position in it: a walk in the filesystem's own order would resume somewhere else
 * every time, and a search that repeats or skips a file is worse than a slow one. When the
 * cursor's own file is gone (deleted, renamed, or now `.gitignore`d), the first file past its
 * path in this same order stands in for it.
 */
export async function searchIn(request: SearchRequest): Promise<SearchResult> {
  const ignored = await ignoredPatterns(request.root)
  const start =
    request.path === null || request.path === undefined
      ? request.root
      : join(request.root, request.path)
  const cursor = parseCursor(request.cursor ?? null)
  const resumePath = cursor === null ? null : cursor.path
  const resumeLine = cursor === null ? 0 : cursor.line
  const query = request.query.toLowerCase()

  const progress: Progress = {
    hits: [],
    skipped: [],
    skippedCount: 0,
    scanned: 0,
    stoppedBy: null,
    stoppedAt: null,
  }
  let resumed = cursor === null
  // The budget ran out at the end of a file: the call stops at the next file, if there is one,
  // and the cursor names the last line of the one it finished.
  let spent = false

  for await (const file of filesUnder(start, request.root, ignored, resumePath)) {
    const rel = relative(request.root, file).split(sep).join('/')
    if (!resumed) {
      if (resumePath !== null && rel !== resumePath && !after(rel, resumePath)) continue
      resumed = true
    }
    if (spent) {
      progress.stoppedBy = 'scanned'
      break
    }
    // The cursor names the last line the previous call examined, so this one starts after it.
    const ended = await scanFile(file, rel, rel === resumePath ? resumeLine : 0, query, progress)
    if (progress.stoppedBy !== null) break
    if (ended && progress.scanned >= SEARCH_SCAN_BYTES) spent = true
  }

  return {
    hits: progress.hits,
    stoppedBy: progress.stoppedBy,
    scanned: progress.scanned,
    cursor: progress.stoppedBy === null ? null : progress.stoppedAt,
    skipped: progress.skipped,
    skippedCount: progress.skippedCount,
  }
}

/** Notes a file the search passed over: named while the list is short, counted always. */
function skip(progress: Progress, path: string, reason: SearchSkip['reason']): void {
  progress.skippedCount += 1
  if (progress.skipped.length < SEARCH_SKIPS_LISTED) progress.skipped.push({ path, reason })
}

/**
 * Reads one file in chunks, line by line, from line `from` on, and says whether it reached the
 * end of it.
 *
 * The budget is checked after every chunk: a file larger than what is left of it is read up to
 * the budget and the cursor points at the last line examined, so the next call continues inside
 * the same file. The lines before `from` are passed over without counting against the budget —
 * the previous call already paid for them — and without being held, since nothing reads them.
 *
 * A line is counted while it is still being read, not once its end arrives: a minified bundle or
 * a log with no newline is one line, and waiting for its end would read the whole file past the
 * budget and hold it in memory. A line that outlasts the budget is examined as far as it was read
 * and cut there; the cursor names it, so the next call goes on from the line after it.
 */
async function scanFile(
  file: string,
  rel: string,
  from: number,
  query: string,
  progress: Progress,
): Promise<boolean> {
  let carry = ''
  let index = 0
  let first = true
  /** One whole line: examined, and a hit when it holds the query. */
  const examine = (text: string): void => {
    index += 1
    if (index <= from || progress.stoppedBy !== null) return
    progress.scanned += Buffer.byteLength(text, 'utf8') + 1
    progress.stoppedAt = `${rel}:${index}`
    if (!text.toLowerCase().includes(query)) return
    progress.hits.push({ path: rel, line: index, text: text.trim().slice(0, 240) })
    if (progress.hits.length >= SEARCH_MATCH_LIMIT) progress.stoppedBy = 'matches'
  }

  const stream = createReadStream(file, { encoding: 'utf8', highWaterMark: CHUNK_BYTES })
  try {
    for await (const chunk of stream) {
      const text = String(chunk)
      // A NUL byte in the first chunk is what a binary file looks like read as text, and a
      // search that returned matches inside a bundle would be a search nobody trusts.
      if (first && text.includes('\u0000')) {
        skip(progress, rel, 'binary')
        return true
      }
      first = false
      const lines = (carry + text).split('\n')
      carry = lines.pop() ?? ''
      for (const line of lines) examine(line)
      if (progress.stoppedBy !== null) return false
      // The line still being read is one the previous call already went past: only its end
      // matters, and the newline that ends it is in a chunk still to come.
      if (index + 1 <= from) carry = ''
      const reading = Buffer.byteLength(carry, 'utf8')
      if (progress.scanned + reading >= SEARCH_SCAN_BYTES) {
        if (reading > 0) examine(carry)
        progress.stoppedBy = progress.stoppedBy ?? 'scanned'
        return false
      }
    }
  } catch {
    // A file that cannot be read — gone since it was listed, or not ours to open — is said to
    // have been passed over rather than left out without a word.
    skip(progress, rel, 'unreadable')
    return true
  } finally {
    stream.destroy()
  }
  if (carry !== '') examine(carry)
  return true
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

/**
 * Whether `rel` comes after `cursorPath` in the walk's own order.
 *
 * The walk sorts a folder's entries by plain `<` on their name and recurses depth first, so two
 * paths compare the same way: segment by segment, the first pair that differs decides, and a
 * path that is a prefix of the other — a folder above what is inside it — comes before it.
 */
function after(rel: string, cursorPath: string): boolean {
  const relSegments = rel.split('/')
  const cursorSegments = cursorPath.split('/')
  const length = Math.min(relSegments.length, cursorSegments.length)
  for (let index = 0; index < length; index += 1) {
    const relSegment = relSegments[index] ?? ''
    const cursorSegment = cursorSegments[index] ?? ''
    if (relSegment !== cursorSegment) return relSegment > cursorSegment
  }
  return relSegments.length > cursorSegments.length
}

/**
 * The files under a folder, one at a time, in the order the cursor expects.
 *
 * One folder is read at a time and a folder's files are handed over before the next folder is
 * read, so a search that stops early has listed only what it read. A folder that lies wholly
 * before the cursor is not walked at all: nothing in it could come after the cursor.
 */
async function* filesUnder(
  folder: string,
  root: string,
  ignored: readonly string[],
  resumePath: string | null,
): AsyncGenerator<string> {
  let names: { name: string; folder: boolean; file: boolean }[]
  try {
    const entries = await readdir(folder, { withFileTypes: true })
    names = entries.map((entry) => ({
      name: entry.name,
      folder: entry.isDirectory(),
      file: entry.isFile(),
    }))
  } catch {
    // A file named where a folder was expected is a search of that one file, not a failure.
    yield folder
    return
  }
  names.sort((left, right) => (left.name < right.name ? -1 : 1))
  for (const entry of names) {
    if (NEVER_WALKED.has(entry.name)) continue
    const path = join(folder, entry.name)
    const rel = relative(root, path).split(sep).join('/')
    if (ignored.some((pattern) => matches(pattern, rel))) continue
    if (entry.folder) {
      const before =
        resumePath !== null && !resumePath.startsWith(`${rel}/`) && !after(rel, resumePath)
      if (!before) yield* filesUnder(path, root, ignored, resumePath)
    } else if (entry.file) {
      yield path
    }
  }
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
