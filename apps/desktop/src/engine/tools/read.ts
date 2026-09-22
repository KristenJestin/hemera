/**
 * One page of a file, read by its bytes (design D6-03).
 *
 * `fs_read` is paginated by byte range, so a page is read as a range: the file is opened, the
 * bytes asked for are read at their position, and nothing else of it is held. A file of a
 * gigabyte costs one page of memory, as a file of a kilobyte does.
 *
 * A page ends where a line ends when it can — after the last newline of the bytes it read — so
 * that the next page begins on a line of its own and the numbering of both reads as one text. A
 * page that holds no newline at all (one line longer than a page) ends on a character instead:
 * never in the middle of one, because a character cut in two decodes as two replacement
 * characters and the agent would read neither half.
 */

import { type FileHandle, open } from 'node:fs/promises'

/** The bytes a page covers, and where the next one starts. */
export interface ReadRange {
  /** The first byte of the page. */
  readonly offset: number
  /** The byte after the last one of the page. */
  readonly end: number
  /** The size of the whole file. */
  readonly size: number
  /** Whether the file goes on past this page. */
  readonly truncated: boolean
  /** Where the next page starts, and null when this one reached the end. */
  readonly next: number | null
}

/** A page of text, the range it covers, and the number of its first line. */
export interface Page extends ReadRange {
  readonly text: string
  readonly firstLine: number
}

/** How much of the file before a page is read at a time to count its lines. */
const COUNTING_CHUNK = 64 * 1024

/** The newline byte, which is what a line is counted by. */
const NEWLINE = 0x0a

/** How many bytes at the start of a buffer continue a character that began before it. */
function continuing(bytes: Buffer): number {
  let skipped = 0
  while (skipped < 3 && skipped < bytes.length && ((bytes[skipped] ?? 0) & 0xc0) === 0x80) {
    skipped += 1
  }
  return skipped
}

/**
 * Where a page that does not reach the end of the file stops: after its last newline, else
 * before a character it would cut, else — a page smaller than one character — where it was cut.
 */
function stopOf(bytes: Buffer): number {
  const newline = bytes.lastIndexOf(NEWLINE)
  if (newline >= 0) return newline + 1
  for (let at = bytes.length - 1; at >= 0 && at >= bytes.length - 4; at -= 1) {
    const byte = bytes[at] ?? 0
    if ((byte & 0x80) === 0) return bytes.length
    if ((byte & 0xc0) === 0xc0) {
      const length = byte >= 0xf0 ? 4 : byte >= 0xe0 ? 3 : 2
      if (bytes.length - at >= length) return bytes.length
      return at === 0 ? bytes.length : at
    }
  }
  return bytes.length
}

/**
 * How many lines end before a byte of the file, counted a chunk at a time.
 *
 * Recursive rather than a loop, because each step awaits a read and the repository refuses the
 * loop that awaits inside itself. The prefix is read and let go of chunk by chunk: what is kept
 * is a number, never the text.
 */
async function newlinesBefore(handle: FileHandle, upTo: number, from = 0): Promise<number> {
  if (from >= upTo) return 0
  const chunk = Buffer.alloc(Math.min(COUNTING_CHUNK, upTo - from))
  const { bytesRead } = await handle.read(chunk, 0, chunk.length, from)
  if (bytesRead === 0) return 0
  let found = 0
  for (
    let at = chunk.indexOf(NEWLINE);
    at >= 0 && at < bytesRead;
    at = chunk.indexOf(NEWLINE, at + 1)
  ) {
    found += 1
  }
  return found + (await newlinesBefore(handle, upTo, from + bytesRead))
}

/** One page of a file, from a byte, at most `limit` bytes long. */
export async function readPage(path: string, offset: number, limit: number): Promise<Page> {
  const handle = await open(path, 'r')
  try {
    const { size } = await handle.stat()
    const from = Math.min(offset, size)
    const buffer = Buffer.alloc(Math.min(limit, size - from))
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, from)
    const bytes = buffer.subarray(0, bytesRead)
    // An offset the agent chose may land inside a character: the page starts on the next one.
    const skipped = continuing(bytes)
    const stop = from + bytesRead >= size ? bytesRead : stopOf(bytes)
    const start = from + skipped
    const end = from + Math.max(stop, skipped)
    return {
      text: bytes.subarray(skipped, Math.max(stop, skipped)).toString('utf8'),
      firstLine: 1 + (await newlinesBefore(handle, start)),
      offset: start,
      end,
      size,
      truncated: end < size,
      next: end < size ? end : null,
    }
  } finally {
    await handle.close()
  }
}

/** A page's text with the number of each line in front of it, as `cat -n` prints them. */
export function numbered(page: Page): string {
  if (page.text === '') return ''
  const lines = page.text.endsWith('\n')
    ? page.text.slice(0, -1).split('\n')
    : page.text.split('\n')
  return lines
    .map((line, index) => `${String(page.firstLine + index).padStart(6, ' ')}\t${line}`)
    .join('\n')
}
