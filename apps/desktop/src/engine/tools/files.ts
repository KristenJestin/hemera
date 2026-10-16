/**
 * The file tools: `fs_read`, `fs_list`, `search`, `fs_write` and `fs_edit`, on paths the gate has
 * already resolved and judged.
 *
 * Writing is done only on the version that was read. Per session and file, the fingerprint of the
 * version the session last read or wrote is kept (sha256 of the whole file, whatever page was
 * read), and survives a restart with the session. `fs_write` and `fs_edit` write only if the file
 * still has it: compare, write a temporary file beside the target, rename it over the target. A
 * file the session never read is written only if it does not exist. A refusal names the file,
 * says it changed since the session read it, and shows the lines that differ, masked, when the
 * version it read is still known.
 *
 * A write is an action with an effect outside the database: its intent is written before the
 * file is, and its outcome after.
 */

import { lstat, rename, rm } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

import {
  LIST_ENTRIES_MAX,
  READ_PAGE_BYTES,
  SEARCH_MATCH_LIMIT,
  SEARCH_SCAN_BYTES,
  type ToolArguments,
} from '@hemera/core/domain'
import { and, eq } from 'drizzle-orm'
import { Effect, Predicate, Result } from 'effect'

import { Secrets, type SecretsRegistry, maskedHead } from '../secrets.ts'
import { Database, refusedWhile } from '../storage/database.ts'
import { sessionFiles } from '../storage/schema.ts'
import { mutate } from '../transaction.ts'
import type { ActionOwner } from './actions.ts'
import { EffectfulActions } from './actions.ts'
import {
  type JudgedFolder,
  MOVED,
  NotJudged,
  madeFolder,
  openFolder,
  openJudged,
  refusedAsJudged,
} from './judged.ts'
import { WriteAttribution } from './ports.ts'
import { type Page, fingerprintOf, numbered, readPage } from './read.ts'
import { type SearchResult, searchIn } from './search.ts'
import type { Withholding } from './withholding.ts'

/** What a tool answers: whether it did what was asked, and what the agent reads. */
export interface ToolAnswer {
  readonly ok: boolean
  /** A rule said no, rather than something going wrong. */
  readonly refused: boolean
  readonly text: string
  /** An image answered beside the text, as base64 (#341: an image of the mission's evidence). */
  readonly image?: { readonly mimeType: string; readonly data: string }
}

export const answered = (text: string): ToolAnswer => ({ ok: true, refused: false, text })
export const refusal = (text: string): ToolAnswer => ({ ok: false, refused: true, text })
export const failure = (text: string): ToolAnswer => ({ ok: false, refused: false, text })

/** The largest version of a file kept in memory to show what changed in it. */
const KEPT_FOR_DIFF_BYTES = 256 * 1024

/** How many versions kept for a diff a session holds, the least recent let go of first. */
const KEPT_PER_SESSION = 32

/** How many lines a diff in a refusal shows. */
const DIFF_LINES = 20

/** How much of one line a diff in a refusal shows: a minified line can be the whole file. */
const DIFF_LINE_CHARS = 400

/**
 * The versions a session read, kept in memory only to show what changed when a write is refused:
 * never written anywhere, gone at a restart (the refusal then says it cannot show the change).
 */
export class ReadVersions {
  private readonly bySession = new Map<string, Map<string, string>>()

  keep(sessionId: string, path: string, text: string): void {
    if (Buffer.byteLength(text, 'utf8') > KEPT_FOR_DIFF_BYTES) return this.drop(sessionId, path)
    const kept = this.bySession.get(sessionId) ?? new Map<string, string>()
    kept.delete(path)
    kept.set(path, text)
    for (const oldest of kept.keys()) {
      if (kept.size <= KEPT_PER_SESSION) break
      kept.delete(oldest)
    }
    this.bySession.set(sessionId, kept)
  }

  drop(sessionId: string, path: string): void {
    this.bySession.get(sessionId)?.delete(path)
  }

  read(sessionId: string, path: string): string | undefined {
    return this.bySession.get(sessionId)?.get(path)
  }
}

/** What a file tool is handed with its arguments: the session and where the call acts. */
export interface FileCall {
  readonly sessionId: string
  readonly owner: ActionOwner
  /** The path the gate resolved and judged, absolute. */
  readonly path: string
  /** As the agent wrote it. */
  readonly named: string
  readonly versions: ReadVersions
  /** What the session may not read of what the call reads (`./withholding.ts`). */
  readonly withholding: Withholding
}

/** The fingerprint of the version a session last read or wrote of a file, if it has one. */
const knownFingerprint = (sessionId: string, path: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const [row] = yield* database
      .select({ fingerprint: sessionFiles.fingerprint })
      .from(sessionFiles)
      .where(and(eq(sessionFiles.sessionId, sessionId), eq(sessionFiles.path, path)))
      .pipe(Effect.mapError(refusedWhile('reading what the session read')))
    return row?.fingerprint ?? null
  })

/** Keeps the fingerprint of the version a session read or wrote. */
const keepFingerprint = (sessionId: string, path: string, fingerprint: string) =>
  mutate('keeping what the session read', (transaction) => {
    const recordedAt = new Date().toISOString()
    return transaction
      .insert(sessionFiles)
      .values({ sessionId, path, fingerprint, recordedAt })
      .onConflictDoUpdate({
        target: [sessionFiles.sessionId, sessionFiles.path],
        set: { fingerprint, recordedAt },
      })
      .pipe(
        Effect.mapError(refusedWhile('keeping what the session read')),
        Effect.as({ result: undefined, events: [] }),
      )
  })

/** Passes what a session read or wrote to its successor at a restart: it writes on those versions. */
export const passFingerprints = (from: string, to: string) =>
  mutate('passing on what the session read', (transaction) =>
    Effect.gen(function* () {
      const kept = yield* transaction
        .select()
        .from(sessionFiles)
        .where(eq(sessionFiles.sessionId, from))
        .pipe(Effect.mapError(refusedWhile('reading what the session read')))
      if (kept.length > 0)
        yield* transaction
          .insert(sessionFiles)
          .values(
            kept.map(({ path, fingerprint, recordedAt }) => ({
              sessionId: to,
              path,
              fingerprint,
              recordedAt,
            })),
          )
          .pipe(Effect.mapError(refusedWhile('passing on what the session read')))
      return { result: undefined, events: [] }
    }),
  )

/** The code of a system error, when it has one. */
const codeOf = (cause: Error): string | undefined =>
  'code' in cause && Predicate.isString(cause.code) ? cause.code : undefined

const said = (cause: Error): string => {
  const code = codeOf(cause)
  if (code === 'ENOENT') return 'there is no such file or folder'
  if (code === 'EISDIR') return 'it is a folder'
  if (code === 'ENOTDIR') return 'a part of the path is not a folder'
  if (code === 'EACCES' || code === 'EPERM') return 'the system does not allow it'
  if (code === 'EBUSY') return 'another process holds it'
  return cause.message
}

/** One filesystem call, its failure as a sentence rather than a thrown error. */
export const attempt = <A>(run: (signal: AbortSignal) => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (cause) => (cause instanceof Error ? said(cause) : String(cause)),
  })

/**
 * What a failed use of a judged path answers: a refusal when the path is no longer the file that
 * was judged (`./judged.ts`), a failure otherwise.
 */
export const failedOn = (reason: string, text: string): ToolAnswer =>
  refusedAsJudged(reason) ? refusal(`refused: ${text}`) : failure(text)

/** A page of a file as an agent reads it: its numbered lines, where it stands in the file, and the range. */
export const pageSaid = (value: Page): string => {
  const range = JSON.stringify({
    offset: value.offset,
    end: value.end,
    size: value.size,
    next: value.next,
  })
  const where =
    value.next === null
      ? `(bytes ${String(value.offset)}-${String(value.end)} of ${String(value.size)}, the end of the file)`
      : `(bytes ${String(value.offset)}-${String(value.end)} of ${String(value.size)}; the next page starts at offset ${String(value.next)})`
  return [numbered(value), where, range].filter((part) => part !== '').join('\n')
}

export const fsRead = (call: FileCall, args: ToolArguments<'fs_read'>) =>
  Effect.gen(function* () {
    const offset = args.range?.offset ?? 0
    const length = args.range?.length ?? READ_PAGE_BYTES
    const page = yield* attempt(() => readPage(call.path, offset, length, call.withholding)).pipe(
      Effect.result,
    )
    if (Result.isFailure(page)) {
      return failedOn(page.failure, `could not read ${call.named}: ${page.failure}`)
    }
    const value = page.success
    yield* keepFingerprint(call.sessionId, call.path, value.fingerprint)
    if (value.offset === 0 && value.next === null)
      call.versions.keep(call.sessionId, call.path, value.text)
    else call.versions.drop(call.sessionId, call.path)
    return answered(pageSaid(value))
  })

type Entry = { readonly line: string }

/**
 * The entries of a folder to a depth, naming what could not be read. Each folder is opened, proven
 * to be the one judged, and read through its handle (`./judged.ts`): the folder asked for refuses
 * the whole listing, one under it is named as not read. A link is named, never followed nor
 * measured; an entry is measured through its folder's handle.
 */
const listed = async (path: string, depth: number): Promise<ReadonlyArray<Entry>> => {
  const lines: Entry[] = []
  const walk = async (folder: JudgedFolder, rel: string, level: number): Promise<void> => {
    if (lines.length >= LIST_ENTRIES_MAX) return
    const entries = await folder.entries().catch((cause: Error) => {
      lines.push({ line: `${rel === '' ? '.' : rel}/  could not be read: ${said(cause)}` })
      return null
    })
    if (entries === null) return
    for (const entry of [...entries].sort((left, right) => (left.name < right.name ? -1 : 1))) {
      if (lines.length >= LIST_ENTRIES_MAX) return
      const named = rel === '' ? entry.name : `${rel}/${entry.name}`
      if (entry.isDirectory()) {
        lines.push({ line: `${named}/` })
        // oxlint-disable-next-line no-await-in-loop -- one entry at a time, in order, within the bound
        if (level < depth) await walkInto(folder, entry.name, named, level + 1)
        continue
      }
      const kind = entry.isFile() ? 'file' : entry.isSymbolicLink() ? 'link' : 'other'
      if (kind === 'link') {
        lines.push({ line: `${named}  link` })
        continue
      }
      // oxlint-disable-next-line no-await-in-loop -- one entry at a time, in order, within the bound
      const size = await lstat(folder.at(entry.name)).then(
        (found) => String(found.size),
        (cause: Error) => `size unknown: ${said(cause)}`,
      )
      lines.push({ line: `${named}  ${kind}  ${size}` })
    }
  }
  /** A folder under the one listed, opened through its parent's handle and proven, then walked. */
  const walkInto = async (parent: JudgedFolder, name: string, rel: string, level: number) => {
    const inner = await openFolder(parent.at(name), join(parent.real, name)).catch(
      (cause: Error) => {
        lines.push({ line: `${rel}/  could not be read: ${said(cause)}` })
        return null
      },
    )
    if (inner === null) return
    try {
      await walk(inner, rel, level)
    } finally {
      await inner.close()
    }
  }
  const root = await openFolder(path)
  try {
    await walk(root, '', 1)
  } finally {
    await root.close()
  }
  return lines
}

export const fsList = (call: FileCall, args: ToolArguments<'fs_list'>) =>
  Effect.gen(function* () {
    const found = yield* attempt(() => listed(call.path, args.depth ?? 1)).pipe(Effect.result)
    if (Result.isFailure(found)) {
      return failedOn(found.failure, `could not list ${call.named}: ${found.failure}`)
    }
    const lines = found.success.map((entry) => entry.line)
    if (lines.length === 0) return answered(`${call.named} is empty`)
    const more =
      lines.length >= LIST_ENTRIES_MAX
        ? [`… stopped at ${String(LIST_ENTRIES_MAX)} entries: list a folder under it`]
        : []
    return answered([...lines, ...more].join('\n'))
  })

/** What a search answered, as a text an agent can act on. */
const describeSearch = (result: SearchResult, pattern: string): string => {
  const head =
    result.hits.length === 0
      ? `no match for "${pattern}" in ${String(result.scanned)} bytes scanned`
      : `${String(result.hits.length)} match(es) for "${pattern}" in ${String(result.scanned)} bytes scanned`
  const stop =
    result.stoppedBy === null
      ? 'the search reached the end of what it scanned'
      : `stopped by ${result.stoppedBy === 'matches' ? 'the match limit' : 'the scan budget'}; resume with cursor ${result.cursor ?? ''}`
  const limits = `limits: at most ${String(SEARCH_MATCH_LIMIT)} matches and ${String(SEARCH_SCAN_BYTES)} bytes scanned per call`
  const passed =
    result.skippedCount === 0
      ? []
      : [
          `${String(result.skippedCount)} file(s) not searched: ${result.skipped
            .map((one) => `${one.path} (${one.reason === 'withheld' ? one.withheld : one.reason})`)
            .join(', ')}${result.skippedCount > result.skipped.length ? ', …' : ''}`,
        ]
  const lines = result.hits.map((hit) => `${hit.path}:${String(hit.line)}: ${hit.text}`)
  return [head, stop, limits, ...passed, ...lines].join('\n')
}

export const search = (call: FileCall, args: ToolArguments<'search'>) =>
  Effect.gen(function* () {
    const found = yield* attempt((signal) =>
      searchIn({
        root: call.path,
        judged: call.path,
        query: args.pattern,
        glob: args.glob ?? null,
        cursor: args.cursor ?? null,
        signal,
        withholding: call.withholding,
      }),
    ).pipe(Effect.result)
    if (Result.isFailure(found)) return failure(`the search did not run: ${found.failure}`)
    return answered(describeSearch(found.success, args.pattern))
  })

/**
 * Writes a file by replacing it: a new file beside it, renamed over it. Whatever sits under the
 * name (a link planted after the path was judged, a hard link shared with a file elsewhere) is
 * replaced, not written through; the mode of the file it replaces is kept.
 *
 * Its folder, and the missing ones above it, are made and proven on their handles first
 * (`./judged.ts`); the new file is made and proven there before anything is written in it, then
 * renamed through the same folder's handle, so the content reaches the folder judged or nowhere,
 * and a new file not renamed is removed from that same folder. A folder moved away while the file
 * was written makes the write fail, saying so.
 */
export async function replaceFile(path: string, content: string): Promise<void> {
  const folder = await madeFolder(dirname(path))
  try {
    const name = basename(path)
    const mode = await lstat(folder.at(name)).then(
      (found) => (found.isFile() ? found.mode : undefined),
      () => undefined,
    )
    const temporary = `.${name}.${crypto.randomUUID()}.hemera`
    try {
      const handle = await openJudged(folder.at(temporary), {
        real: join(folder.real, temporary),
        create: true,
        mode,
      })
      try {
        await handle.writeFile(content, 'utf8')
      } finally {
        await handle.close()
      }
      await rename(folder.at(temporary), folder.at(name))
    } catch (cause) {
      await rm(folder.at(temporary), { force: true })
      throw cause
    }
    await folder.still().catch(() => {
      throw new NotJudged(MOVED)
    })
  } finally {
    await folder.close()
  }
}

/**
 * The lines that differ between two versions, at most `DIFF_LINES` of at most `DIFF_LINE_CHARS`
 * each, masked in slices: a longer line is cut to its masked head (`maskedHead`), never masked
 * whole, and the lines are masked again together, where a credential may span them.
 */
const diffOf = (before: string, after: string, secrets: SecretsRegistry) => {
  const old = before.split('\n')
  const now = after.split('\n')
  let start = 0
  while (start < old.length && start < now.length && old[start] === now[start]) start += 1
  let end = 0
  while (
    end < old.length - start &&
    end < now.length - start &&
    old[old.length - 1 - end] === now[now.length - 1 - end]
  ) {
    end += 1
  }
  const lines = [
    `@@ line ${String(start + 1)} @@`,
    ...old.slice(start, old.length - end).map((line) => `- ${line}`),
    ...now.slice(start, now.length - end).map((line) => `+ ${line}`),
  ]
  const shownLines =
    lines.length > DIFF_LINES + 1
      ? [
          ...lines.slice(0, DIFF_LINES + 1),
          `… ${String(lines.length - DIFF_LINES - 1)} more line(s)`,
        ]
      : lines
  return Effect.gen(function* () {
    const heads = yield* Effect.forEach(shownLines, (line) =>
      line.length <= DIFF_LINE_CHARS
        ? Effect.succeed(line)
        : Effect.map(maskedHead(secrets, line, DIFF_LINE_CHARS), (head) => `${head}…`),
    )
    return yield* secrets.maskPaced(heads.join('\n'))
  })
}

/**
 * Whether the session may write over the file as it is now: it read or wrote this very version,
 * or the file does not exist and the session never read it. Answers the refusal, or null.
 */
const versionRefusal = (
  call: FileCall,
  current: { readonly fingerprint: string | null; readonly text: string | null },
) =>
  Effect.gen(function* () {
    const known = yield* knownFingerprint(call.sessionId, call.path)
    if (known === null) {
      return current.fingerprint === null
        ? null
        : refusal(
            `refused: ${call.named} exists and this session has not read it: read it with fs_read first`,
          )
    }
    if (current.fingerprint === known) return null
    if (current.fingerprint === null) {
      return refusal(
        `refused: ${call.named} was removed since this session read it; nothing was written`,
      )
    }
    const secrets = yield* Secrets
    const before = call.versions.read(call.sessionId, call.path)
    const change =
      before === undefined || current.text === null
        ? 'The version it read is no longer kept, so what changed cannot be shown.'
        : `What changed:\n${yield* diffOf(before, current.text, secrets)}`
    return refusal(
      `refused: ${call.named} changed since this session read it; read it again before writing. ${change}`,
    )
  })

/**
 * The file as it is now: its text and fingerprint, or nothing when there is none. Read from the
 * file judged only (`./judged.ts`): what a link planted since leads to is never read, nor shown;
 * what the session may not read, neither.
 */
const currentOf = (call: FileCall) =>
  attempt(async () => {
    const handle = await openJudged(call.path, {
      oneNameFor: 'write',
      withholding: call.withholding,
    }).catch((cause: Error) => {
      if (codeOf(cause) === 'ENOENT') return null
      throw cause
    })
    if (handle === null) return { fingerprint: null, text: null }
    try {
      const bytes = await handle.readFile()
      return { fingerprint: fingerprintOf(bytes), text: bytes.toString('utf8') }
    } finally {
      await handle.close()
    }
  })

/** A whole new content written over the version read, with its intent and its outcome. */
const writeVersion = (call: FileCall, before: string | null, content: string) =>
  Effect.gen(function* () {
    const actions = yield* EffectfulActions
    const after = fingerprintOf(Buffer.from(content, 'utf8'))
    const intent = yield* actions.begin('file.write', call.owner, {
      path: call.path,
      before,
      after,
      sessionId: call.sessionId,
    })
    const written = yield* attempt(() => replaceFile(call.path, content)).pipe(Effect.result)
    if (Result.isFailure(written)) {
      yield* actions.failed(intent, written.failure)
      return written.failure === MOVED
        ? failure(`could not write ${call.named}: ${MOVED}`)
        : failedOn(
            written.failure,
            `could not write ${call.named}: ${written.failure}; the file is as it was`,
          )
    }
    // In the outcome's own transaction, a mission's write is attributed to its task (#142).
    const attributed =
      call.owner.kind === 'mission'
        ? (yield* WriteAttribution).written({
            sessionId: call.sessionId,
            missionId: call.owner.missionId,
            path: call.path,
            fingerprint: after,
            actionId: intent,
          })
        : undefined
    yield* actions.done(
      intent,
      `wrote ${String(Buffer.byteLength(content, 'utf8'))} bytes`,
      attributed,
    )
    yield* keepFingerprint(call.sessionId, call.path, after)
    call.versions.keep(call.sessionId, call.path, content)
    return null
  })

export const fsWrite = (call: FileCall, args: ToolArguments<'fs_write'>) =>
  Effect.gen(function* () {
    const current = yield* currentOf(call).pipe(Effect.result)
    if (Result.isFailure(current)) {
      return failedOn(
        current.failure,
        `could not read ${call.named}: ${current.failure}; nothing was written`,
      )
    }
    const refused = yield* versionRefusal(call, current.success)
    if (refused !== null) return refused
    const failed = yield* writeVersion(call, current.success.fingerprint, args.content)
    if (failed !== null) return failed
    return answered(
      `wrote ${call.named} (${String(Buffer.byteLength(args.content, 'utf8'))} bytes)`,
    )
  })

/** How many times a text appears in another, overlaps included. */
const occurrences = (text: string, anchor: string): number => {
  let found = 0
  for (let at = text.indexOf(anchor); at >= 0; at = text.indexOf(anchor, at + 1)) found += 1
  return found
}

export const fsEdit = (call: FileCall, args: ToolArguments<'fs_edit'>) =>
  Effect.gen(function* () {
    const current = yield* currentOf(call).pipe(Effect.result)
    if (Result.isFailure(current)) {
      return failedOn(
        current.failure,
        `could not read ${call.named}: ${current.failure}; nothing was written`,
      )
    }
    if (current.success.text === null) {
      return refusal(`refused: there is no file ${call.named} to edit; write it with fs_write`)
    }
    const known = yield* knownFingerprint(call.sessionId, call.path)
    if (known === null) {
      return refusal(
        `refused: this session has not read ${call.named}: read it with fs_read before editing it`,
      )
    }
    const refused = yield* versionRefusal(call, current.success)
    if (refused !== null) return refused
    let text = current.success.text
    for (const [index, edit] of args.edits.entries()) {
      const found = occurrences(text, edit.old)
      if (found !== 1) {
        return refusal(
          `refused: the anchor of edit ${String(index + 1)} appears ${String(found)} time(s) in ${call.named}; it must appear exactly once. Nothing was changed`,
        )
      }
      // Spliced rather than `replace`d: a replacement string reads `$&` as a pattern.
      const at = text.indexOf(edit.old)
      text = text.slice(0, at) + edit.new + text.slice(at + edit.old.length)
    }
    const failed = yield* writeVersion(call, current.success.fingerprint, text)
    if (failed !== null) return failed
    return answered(`edited ${call.named} (${String(args.edits.length)} edit(s))`)
  })
