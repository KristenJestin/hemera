/**
 * The twelve tools, and the one door every call goes through (design D6-03, D6-04, D6-05).
 *
 * A call arrives here as a name, a flat bag of arguments, and the set the Session was offered.
 * Nothing else about it is trusted: the name is checked against the catalogue, the arguments
 * against the schema of that name, and the Session it claims to serve against the database —
 * in that order, for every call, and never once at the start of a Session. An agent that has a
 * token has the right to ask, not the right to be obeyed.
 *
 * What a tool answers is a sentence and a text: the summary is what the thread shows, the text
 * is what the agent reads, and the same bounded payload is what the Journal records. A refusal
 * is an answer like another — the agent is told what it did wrong and asked again — and a call
 * that reads a file outside the root is refused until the human says otherwise (D6-05).
 *
 * Two things are deliberately not here. Nothing does an authorisation by itself: a path outside
 * the root goes to `ToolPermissions`, which is a question to the human, and the answer is not
 * remembered from one call to the next. And nothing writes twice: a caller that sends a key gets
 * the earlier answer back rather than a second write, because a lost answer and a second call
 * look exactly the same from where the agent stands.
 */

import {
  READ_PAGE_BYTES,
  ROOT_REPOSITORY,
  SEARCH_MATCH_LIMIT,
  SEARCH_SCAN_BYTES,
  type SearchResult,
  TOOL_NAMES,
  type ToolName,
  admitTool,
} from '@hemera/core'
import { Context, Deferred, Effect, Layer } from 'effect'
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative } from 'node:path'

import { HeldWords } from '../agents/held.ts'
import { AgentNotices } from '../agents/notices.ts'
import { Commands } from '../commands/service.ts'
import { Projects } from '../projects.ts'
import { type SessionWorkspace, Sessions, type ThreadWrite } from '../sessions.ts'
import { Database } from '../storage/database.ts'
import { Variables } from '../workspaces/variables.ts'
import { mutate } from '../transaction.ts'
import { ToolAccess } from './access.ts'
import {
  RUN_WAIT_MS,
  THREAD_TAIL,
  type ToolArguments,
  type ParsedCall,
  parseCall,
} from './arguments.ts'
import { type RefusedPathError, resolveInside } from './paths.ts'
import { type OutsideAnswer, ToolPermissions } from './permissions.ts'
import { type Page, type ReadRange, numbered, readPage } from './read.ts'
import { searchIn } from './search.ts'

/** How much of an argument list is kept in the Journal, so a payload stays a payload. */
const ARGUMENTS_KEPT = 400

/** How many answered keys a Session keeps against a retry, the least recently asked let go of first. */
const KEYS_KEPT = 256

/**
 * The two answers a path outside the Workspace can be given, as the block draws them.
 *
 * `allow_once` and `reject_once` and nothing else: what the user allows is this call, and the
 * next one asks again — there is no "always" to give, because nothing is remembered (D6-05).
 */
const OUTSIDE_OPTIONS = [
  { optionId: 'allowed', name: 'Allow once', kind: 'allow_once' },
  { optionId: 'refused', name: 'Refuse', kind: 'reject_once' },
] as const

/** What one call is, as the server has already established it. */
export interface ToolCall {
  readonly sessionId: string
  /** The name as the agent asked for it: an agent prefixes what it registers, a proxy does not. */
  readonly tool: string
  readonly arguments: ToolArguments
  /** What the agent sent to make a retry harmless, and null when it sent nothing. */
  readonly key: string | null
  /** What this Session was offered, as the grant that carried the token said. */
  readonly offered: readonly ToolName[]
  /** The digest of the token, which is how the thread names whoever asked. */
  readonly caller: string
  /**
   * The agent's own identifier of the call, when its request carries one: what the thread pairs
   * the agent's report of the call with Hemera's entry by (D6-06).
   */
  readonly callId?: string | null
}

/** How a call ended, in the words the thread and the Journal share. */
export type ToolState = 'completed' | 'failed' | 'refused'

/** What a tool answered, and what the thread and the agent each read of it. */
export interface ToolOutcome {
  readonly ok: boolean
  readonly state: ToolState
  /** One line for the thread, and the line the Journal carries. */
  readonly summary: string
  /** What the agent reads, which is longer than the summary and bounded all the same. */
  readonly text: string
  /** What the call touched, relative to the root: what the interface lists under the entry. */
  readonly paths: readonly string[]
  /** Whether this is the answer an earlier call with the same key was given. */
  readonly repeated: boolean
  /** The bytes a read covered and where the next page starts; null for every other tool. */
  readonly range: ReadRange | null
}

export interface ToolCatalogueService {
  /** One call, from the guard to the answer. Never fails: a refusal is an answer. */
  readonly call: (asked: ToolCall) => Effect.Effect<ToolOutcome>
  /**
   * Records a call the server turned away before it reached a tool — a name no tool has, or
   * arguments that do not read — as a refusal like any other: an entry and a Journal line.
   */
  readonly refuse: (asked: ToolCall, reason: string) => Effect.Effect<void>
}

export class ToolCatalogue extends Context.Service<ToolCatalogue, ToolCatalogueService>()(
  'ToolCatalogue',
) {}

/**
 * What one call is written down with, beside its own answer.
 *
 * Read from the Session once the call has been admitted: the Project the Journal line belongs to,
 * the agent the thread names as the caller, and how long the tool took — which is what the
 * Journal measures a call by, and what an entry of the thread shows beside it.
 */
interface Made {
  readonly projectId: string
  readonly agent: string
  readonly milliseconds: number
}

/** An answer kept against its key, with the arguments it was given for. */
interface Kept {
  readonly sent: string
  readonly outcome: ToolOutcome
}

/**
 * The arguments of a call as one text, the same whatever order the agent wrote them in: what a
 * retry is compared by.
 */
function argumentsSent(sent: ToolArguments): string {
  return JSON.stringify(Object.entries(sent).sort(([left], [right]) => (left < right ? -1 : 1)))
}

/** What a tool hands back before it has been written down. */
interface Answer {
  readonly ok: boolean
  readonly summary: string
  readonly text: string
  readonly paths: readonly string[]
  /** The bytes a read covered, for `fs_read` alone. */
  readonly range?: ReadRange
}

function completed(summary: string, text: string, paths: readonly string[] = []): Answer {
  return { ok: true, summary, text, paths }
}

function failed(summary: string, text: string): Answer {
  return { ok: false, summary, text, paths: [] }
}

/**
 * What an effect answered, and undefined when it failed.
 *
 * A tool has no business failing: every service it asks can be told no, and the sentence of a
 * refusal is an answer the agent reads. This is where that is said once, rather than a `try` at
 * every call site.
 */
const answered = <A, E>(effect: Effect.Effect<A, E>): Effect.Effect<A | undefined> =>
  effect.pipe(
    Effect.match({
      onFailure: () => undefined,
      onSuccess: (value: A) => value,
    }),
  )

/**
 * Writes a file by replacing it: a new file beside it, renamed over it.
 *
 * Renaming replaces the name in its folder rather than writing through it, so whatever sits under
 * that name — a link planted after the path was judged, a hard link shared with a file outside the
 * root — is replaced and not written into. The mode of the file it replaces is kept, so a script
 * the agent edits stays a script.
 */
async function replaceFile(path: string, content: string): Promise<void> {
  const mode = await stat(path).then(
    (found) => found.mode,
    () => undefined,
  )
  const beside = join(dirname(path), `.${basename(path)}.${crypto.randomUUID()}.hemera`)
  try {
    await writeFile(beside, content, { encoding: 'utf8', mode })
    await rename(beside, path)
  } catch (cause) {
    await rm(beside, { force: true })
    throw cause
  }
}

/** One line of a folder, as `fs_list` shows it. */
function describeEntry(name: string, kind: 'folder' | 'file' | 'other', size: number): string {
  if (kind === 'folder') return `${name}/`
  return `${name}  ${kind}  ${size}`
}

/** Why a search stopped, in the words an agent reads. */
function stoppedSentence(result: SearchResult): string {
  if (result.stoppedBy === null) return 'the search reached the end of what it scanned'
  const reason = result.stoppedBy === 'matches' ? 'the match limit' : 'the scan budget'
  return `stopped by ${reason}; continue from cursor ${result.cursor ?? ''}`
}

/** What a search answered, as a text an agent can act on. */
function describeSearch(result: SearchResult, query: string): string {
  const lines = result.hits.map((hit) => `${hit.path}:${hit.line}: ${hit.text.trim()}`)
  const head =
    result.hits.length === 0
      ? `no match for "${query}" in ${result.scanned} bytes scanned`
      : `${result.hits.length} match(es) for "${query}" in ${result.scanned} bytes scanned`
  const stop = stoppedSentence(result)
  // The limits are in every answer and not only in the description (D6-04): an agent that reads
  // "no match" has to know how much was looked through to know what it means.
  const limits = `limits: at most ${SEARCH_MATCH_LIMIT} matches and ${SEARCH_SCAN_BYTES} bytes scanned per call`
  // What the search passed over is said, so a match the agent expected and did not get has a
  // reason under it rather than a silence.
  const passed =
    result.skippedCount === 0
      ? []
      : [
          `${result.skippedCount} file(s) not searched: ${result.skipped
            .map((one) => `${one.path} (${one.reason})`)
            .join(', ')}${result.skippedCount > result.skipped.length ? ', …' : ''}`,
        ]
  return [head, stop, limits, ...passed, ...lines].join('\n')
}

/**
 * The catalogue of this engine, over everything a tool needs.
 *
 * The services are captured once, when the layer is built, so a tool never hands its caller a
 * requirement: what a tool needs is the engine's own, and the engine is what built this.
 */
export const toolCatalogueLayer: Layer.Layer<
  ToolCatalogue,
  never,
  | Projects
  | Sessions
  | Commands
  | ToolAccess
  | ToolPermissions
  | HeldWords
  | AgentNotices
  | Database
  | Variables
> = Layer.effect(
  ToolCatalogue,
  Effect.gen(function* () {
    const projects = yield* Projects
    const sessions = yield* Sessions
    const commands = yield* Commands
    const permissions = yield* ToolPermissions
    const database = yield* Database
    const access = yield* ToolAccess
    const held = yield* HeldWords
    const notices = yield* AgentNotices
    const variables = yield* Variables

    /**
     * One entry of a call written into its Session's thread, below what the agent said before it.
     *
     * The runtime holds a message's words until its timer writes them (Decided 10 of #17): a call
     * is written after them, because the agent asked for it after saying them. The window is told
     * as the runtime tells it about the agent's own entries: the thread is drawn from what arrives.
     */
    const inThread = (sessionId: string, entry: ThreadWrite) =>
      held.flushed(sessionId).pipe(
        Effect.andThen(() => sessions.write(sessionId, entry)),
        Effect.tap((written) => Effect.sync(() => notices.wrote(sessionId, written.entry))),
      )

    /**
     * The answers already given, per Session and by tool and key, so a retry is answered and not
     * repeated. A Session's map is ordered by use: a hit moves its key to the end, and the first
     * key is the one let go of when the Session holds more than `KEYS_KEPT`.
     */
    const done = new Map<string, Map<string, Kept>>()

    /**
     * The calls running under a key, reserved before they run.
     *
     * A retry can arrive while the first call is still running — waiting on the human, or on a
     * command that is starting — and a key only remembered once the call settled would let both
     * run. The second call waits on the first and is answered what the first one was.
     */
    const inFlight = new Map<
      string,
      { readonly sent: string; readonly outcome: Deferred.Deferred<ToolOutcome> }
    >()

    /** The answer a key was given in this Session, moved to the end as the most recently asked. */
    const answeredBefore = (sessionId: string, slot: string): Kept | undefined => {
      const kept = done.get(sessionId)
      const answer = kept?.get(slot)
      if (kept === undefined || answer === undefined) return undefined
      kept.delete(slot)
      kept.set(slot, answer)
      return answer
    }

    /**
     * Keeps one answer against its key, and lets go of the least recently asked past the bound.
     *
     * A retry happens seconds after the answer it lost, so what is worth holding is the recent
     * past: a Session that ran for a day would otherwise be holding every write it ever made,
     * texts and all.
     */
    const remember = (sessionId: string, slot: string, answer: Kept) => {
      const kept = done.get(sessionId) ?? new Map<string, Kept>()
      kept.delete(slot)
      kept.set(slot, answer)
      for (const oldest of kept.keys()) {
        if (kept.size <= KEYS_KEPT) break
        kept.delete(oldest)
      }
      done.set(sessionId, kept)
    }

    const withDatabase = <A, E>(effect: Effect.Effect<A, E, Database>): Effect.Effect<A, E> =>
      effect.pipe(Effect.provideService(Database, database))

    /** The Journal line of one call, under the Session it served. */
    const journalled = (
      asked: ToolCall,
      made: Made,
      type: string,
      payload: Readonly<Record<string, string | number | boolean>>,
    ) =>
      withDatabase(
        mutate('recording a tool call', () =>
          Effect.succeed({
            result: null,
            events: [
              {
                type,
                entityKind: 'session' as const,
                entityId: asked.sessionId,
                source: 'system' as const,
                author: 'mcp' as const,
                projectId: made.projectId,
                sessionId: asked.sessionId,
                payload: { tool: asked.tool, caller: asked.caller, ...payload },
              },
            ],
          }),
        ),
      ).pipe(Effect.catch(() => Effect.void))

    /** The line and the event of one call, written together, in the thread and in the Journal. */
    const note = (asked: ToolCall, state: ToolState, answer: Answer, made: Made) =>
      Effect.gen(function* () {
        const payload = JSON.stringify({
          tool: asked.tool,
          state,
          // The key the agent sent, which is what a retry is recognised by; the entry itself is
          // one per call, so a key used again never writes over the entry of an earlier call.
          key: asked.key,
          // The agent's identifier of the call, when it sent one: its report of the call and this
          // entry are the same call, and this is what says so (D6-06).
          callId: asked.callId ?? null,
          // The provenance of the call (D6-06): the Session the token served, the digest of that
          // token, the agent that held it, and how long it took. The row belongs to the Session
          // already; the payload says it too, so an entry read on its own still says whose it is.
          session: asked.sessionId,
          caller: asked.caller,
          // Who asked and how long it took: the thread shows a call under the agent that made it,
          // and a call that took a while is a call the reader wants the length of.
          agent: made.agent,
          ms: made.milliseconds,
          paths: answer.paths,
          arguments: JSON.stringify(asked.arguments).slice(0, ARGUMENTS_KEPT),
        })
        yield* inThread(asked.sessionId, {
          role: 'agent',
          kind: 'hemera_tool_call',
          body: answer.summary,
          payload,
          correlationId: `tool:${crypto.randomUUID()}`,
          state,
        }).pipe(
          // A thread that cannot be written is a Session that went away while the call was
          // running: the answer is still the answer, and losing the line is not losing it.
          Effect.catch(() => Effect.void),
        )
        yield* journalled(asked, made, `tool.${state}`, {
          state,
          paths: answer.paths.length,
          milliseconds: made.milliseconds,
        })
      })

    /** Writes the answer down and hands it to the caller. */
    const settle = (asked: ToolCall, made: Made, answer: Answer, state: ToolState) =>
      Effect.gen(function* () {
        yield* note(asked, state, answer, made)
        const outcome: ToolOutcome = {
          ok: answer.ok,
          state,
          summary: answer.summary,
          text: answer.text,
          paths: answer.paths,
          repeated: false,
          range: answer.range ?? null,
        }
        return outcome
      })

    /** A refusal: the same road as an answer, so a refusal is recorded like any call. */
    const refused = (asked: ToolCall, made: Made, reason: string) =>
      settle(asked, made, { ok: false, summary: reason, text: reason, paths: [] }, 'refused')

    /**
     * Where a path leads, judged against the root without asking anyone: inside, outside at a
     * resolved place, or not a place at all.
     */
    const placeOf = (root: string, named: string) =>
      Effect.promise(() =>
        resolveInside(root, named).then(
          (path) => ({ inside: true as const, path }),
          (refusal: RefusedPathError) =>
            refusal.why === 'unreadable'
              ? { inside: null, reason: refusal.message }
              : // What the human is shown is where the path leads, not how the agent spelled it:
                // `..` and a link are resolved, so the question is about the place, not the text.
                { inside: false as const, path: refusal.resolved },
        ),
      )

    /** Where a tool may act: inside the root, or wherever the human has just allowed. */
    const allowed = (asked: ToolCall, root: string, named: string) =>
      Effect.gen(function* () {
        const place = yield* placeOf(root, named)
        if (place.inside === null) return { allowed: false as const, reason: place.reason }
        if (place.inside) return { allowed: true as const, path: place.path }
        const answer = yield* askHuman(
          asked,
          root,
          named,
          place.path,
          `${asked.tool} asks to act outside the Workspace: ${place.path}`,
          null,
        )
        // Asked again once the human answered: they can take their time, and a yes given to a
        // Session whose agent has gone since is a yes nobody is left to act on.
        if (answer.allowed && !(yield* access.live(asked.sessionId))) {
          return {
            allowed: false as const,
            reason: 'the Session ended before the user answered, so nothing was done',
          }
        }
        return answer
      })

    /**
     * The permission block of D5-09, asked about one place, and the human's answer.
     *
     * `line` is the command line a one-off run would start, and null for every other question:
     * the block shows it, because a line is what the human is deciding on.
     */
    const askHuman = (
      asked: ToolCall,
      root: string,
      named: string,
      where: string,
      body: string,
      line: string | null,
    ) =>
      Effect.gen(function* () {
        const id = crypto.randomUUID()
        // The block the window already draws for an agent's own permission is the one this is
        // read by: the same two options every time, because the question is always the same one
        // and nothing about it is remembered (D6-05). The request and the decision are two rows
        // under two correlations, so neither is written over the other.
        const request = (state: string) =>
          inThread(asked.sessionId, {
            role: 'hemera',
            kind: 'permission_request',
            body,
            payload: JSON.stringify({
              toolCallId: id,
              options: OUTSIDE_OPTIONS,
              tool: asked.tool,
              named,
              resolved: where,
              root,
              line,
            }),
            correlationId: `perm:${id}`,
            state,
          }).pipe(Effect.catch(() => Effect.void))

        yield* request('pending')
        const answer = yield* permissions
          .askOutside({
            id,
            sessionId: asked.sessionId,
            tool: asked.tool,
            named: where,
            root,
          })
          .pipe(
            // The agent stopped waiting for the call: the question is withdrawn, and the block it
            // drew closes with a word saying why rather than staying open on nothing.
            Effect.onInterrupt(() =>
              Effect.gen(function* () {
                yield* request('cancelled')
                yield* inThread(asked.sessionId, {
                  role: 'hemera',
                  kind: 'permission_decision',
                  body: 'Withdrawn: the agent stopped waiting for this call',
                  payload: JSON.stringify({
                    toolCallId: id,
                    optionId: null,
                    tool: asked.tool,
                    named,
                    resolved: where,
                    answer: 'withdrawn',
                  }),
                  correlationId: `decision:${id}`,
                  state: 'cancelled',
                }).pipe(Effect.catch(() => Effect.void))
              }),
            ),
          )
        // A question nobody will answer — the turn was stopped, the Session ended — is closed as
        // the block of D5-09 closes one: cancelled, with no option chosen (D6-05).
        const closed: Record<OutsideAnswer, { state: string; said: string }> = {
          allowed: { state: 'decided', said: `you allowed ${asked.tool} to act on ${where}` },
          refused: { state: 'refused', said: `you refused ${asked.tool} on ${where}` },
          cancelled: { state: 'cancelled', said: 'Stopped' },
        }
        yield* request(closed[answer].state)
        yield* inThread(asked.sessionId, {
          role: 'user',
          kind: 'permission_decision',
          body: closed[answer].said,
          payload: JSON.stringify({
            toolCallId: id,
            optionId: answer === 'allowed' ? 'allowed' : null,
            tool: asked.tool,
            named,
            resolved: where,
            answer,
          }),
          correlationId: `decision:${id}`,
          state: answer === 'allowed' ? 'completed' : answer,
        }).pipe(Effect.catch(() => Effect.void))
        if (answer === 'cancelled') {
          return {
            allowed: false as const,
            reason: `the question about ${where} was cancelled: the turn stopped before the user answered`,
          }
        }
        if (answer === 'refused') {
          return {
            allowed: false as const,
            reason:
              line === null
                ? `the user refused: ${where} is outside ${root}`
                : `the user refused to run ${line} in ${where}`,
          }
        }
        // What was allowed is the place the human was shown, and that is where the tool acts.
        return { allowed: true as const, path: where }
      })

    /** Which run a call means, when it named none: the only one this Session has going. */
    /**
     * Which run a call is about: the one it names, else the only one running, else — when the
     * call came to read and nothing is running — the last run of the Session. A `test` or a
     * `script` is over by the time its output is read, and its exit code is the whole point.
     */
    const chooseRun = (
      asked: ToolCall,
      named: string | null,
      ended = false,
    ): Effect.Effect<string | null> =>
      Effect.gen(function* () {
        if (named !== null) return named
        const running = yield* answered(commands.running(asked.sessionId))
        if (running !== undefined && running.length === 1) return running[0]?.id ?? null
        if (!ended || (running !== undefined && running.length > 1)) return null
        const recent = yield* answered(commands.recent(asked.sessionId))
        return recent?.[0]?.id ?? null
      })

    /** One filesystem call, as an answer rather than as a thrown error. */
    const attempt = <A>(
      run: (signal: AbortSignal) => Promise<A>,
    ): Effect.Effect<
      { readonly ok: true; readonly value: A } | { readonly ok: false; readonly reason: string }
    > =>
      Effect.tryPromise({
        try: run,
        catch: (cause) => (cause instanceof Error ? cause.message : String(cause)),
      }).pipe(
        Effect.map((value) => ({ ok: true as const, value })),
        Effect.catch((reason) => Effect.succeed({ ok: false as const, reason })),
      )

    /** One tool, one answer. The arguments are the ones `parseCall` already read. */
    const perform = (
      asked: ToolCall,
      root: string,
      workspace: SessionWorkspace,
      projectId: string,
      projectName: string,
      repositories: readonly string[],
      call: ParsedCall,
    ): Effect.Effect<Answer> =>
      Effect.gen(function* () {
        switch (call.tool) {
          case 'fs_read': {
            const settled = yield* allowed(asked, root, call.arguments.path)
            if (!settled.allowed) return failed(settled.reason, settled.reason)
            const page = yield* attempt<Page>(() =>
              readPage(
                settled.path,
                call.arguments.offset ?? 0,
                call.arguments.limit ?? READ_PAGE_BYTES,
              ),
            )
            if (!page.ok) {
              return failed(`could not read ${call.arguments.path}`, page.reason)
            }
            const { offset, end, size, truncated, next } = page.value
            // The range is said in words and in fields, on a line of its own after the text: the
            // agent reads the sentence, and a client that parses reads the same numbers.
            const range = JSON.stringify({ offset, end, size, truncated, next })
            const more = truncated
              ? `(that is bytes ${offset}-${end} of ${size}; the next page starts at offset ${end})`
              : `(that is bytes ${offset}-${end} of ${size}, the end of the file)`
            return {
              ok: true,
              summary: `read ${call.arguments.path} (bytes ${offset}-${end} of ${size})`,
              text: [numbered(page.value), more, range].filter((part) => part !== '').join('\n'),
              paths: [call.arguments.path],
              range: { offset, end, size, truncated, next },
            }
          }

          case 'fs_write': {
            const settled = yield* allowed(asked, root, call.arguments.path)
            if (!settled.allowed) return failed(settled.reason, settled.reason)
            const written = yield* attempt(() =>
              mkdir(dirname(settled.path), { recursive: true }).then(() =>
                replaceFile(settled.path, call.arguments.content),
              ),
            )
            if (!written.ok) {
              return failed(`could not write ${call.arguments.path}`, written.reason)
            }
            const bytes = Buffer.byteLength(call.arguments.content, 'utf8')
            return {
              ok: true,
              summary: `wrote ${call.arguments.path} (${bytes} bytes)`,
              text: `${call.arguments.path} now holds ${bytes} bytes`,
              paths: [call.arguments.path],
            }
          }

          case 'fs_edit': {
            // An edit that changes nothing is a mistake of the agent's, and saying so is more use
            // to it than a write that leaves the file as it was and reports success.
            if (call.arguments.old === call.arguments.new) {
              return failed(
                `the edit of ${call.arguments.path} changes nothing`,
                'the old and the new text are the same, so nothing was changed',
              )
            }
            const settled = yield* allowed(asked, root, call.arguments.path)
            if (!settled.allowed) return failed(settled.reason, settled.reason)
            const current = yield* attempt(() => readFile(settled.path, 'utf8'))
            if (!current.ok) {
              return failed(`could not read ${call.arguments.path}`, current.reason)
            }
            const occurrences = current.value.split(call.arguments.old).length - 1
            if (occurrences !== 1) {
              return failed(
                `${call.arguments.old.length > 60 ? `${call.arguments.old.slice(0, 60)}…` : call.arguments.old} appears ${occurrences} time(s) in ${call.arguments.path}`,
                `the text to replace appears ${occurrences} time(s) in ${call.arguments.path}: it must appear exactly once, so nothing was changed`,
              )
            }
            // Spliced, not `replace`d: a replacement string reads `$&`, `$'` and `$$` as patterns,
            // and the new text is the agent's text, written as it was sent.
            const at = current.value.indexOf(call.arguments.old)
            const next =
              current.value.slice(0, at) +
              call.arguments.new +
              current.value.slice(at + call.arguments.old.length)
            const written = yield* attempt(() => replaceFile(settled.path, next))
            if (!written.ok) {
              return failed(`could not write ${call.arguments.path}`, written.reason)
            }
            return {
              ok: true,
              summary: `edited ${call.arguments.path}`,
              text: `${call.arguments.path} was edited`,
              paths: [call.arguments.path],
            }
          }

          case 'fs_list': {
            const named = call.arguments.path ?? '.'
            const settled = yield* allowed(asked, root, named)
            if (!settled.allowed) return failed(settled.reason, settled.reason)
            const listed = yield* attempt(() =>
              readdir(settled.path, { withFileTypes: true }).then(async (entries) =>
                Promise.all(
                  [...entries]
                    .sort((left, right) => (left.name < right.name ? -1 : 1))
                    .map(async (entry) => {
                      const path = join(settled.path, entry.name)
                      const details = entry.isDirectory()
                        ? null
                        : await stat(path).catch(() => null)
                      const kind = entry.isDirectory()
                        ? ('folder' as const)
                        : entry.isFile()
                          ? ('file' as const)
                          : ('other' as const)
                      return describeEntry(entry.name, kind, details?.size ?? 0)
                    }),
                ),
              ),
            )
            if (!listed.ok) return failed(`could not list ${named}`, listed.reason)
            const lines = listed.value
            return {
              ok: true,
              summary: `listed ${named} (${lines.length} entries)`,
              text: lines.length === 0 ? `${named} is empty` : lines.join('\n'),
              paths: [named],
            }
          }

          case 'search': {
            const within =
              call.arguments.path === undefined
                ? { allowed: true as const, path: root }
                : yield* allowed(asked, root, call.arguments.path)
            if (!within.allowed) return failed(within.reason, within.reason)
            const found = yield* attempt((signal) =>
              searchIn({
                root,
                query: call.arguments.query,
                path: relative(root, within.path) === '' ? null : relative(root, within.path),
                cursor: call.arguments.cursor ?? null,
                signal,
              }),
            )
            if (!found.ok) return failed(`the search did not run`, found.reason)
            const hits = found.value.hits
            return {
              ok: true,
              summary:
                hits.length === 0
                  ? `no match for "${call.arguments.query}"`
                  : `${hits.length} match(es) for "${call.arguments.query}"`,
              text: describeSearch(found.value, call.arguments.query),
              paths: [...new Set(hits.map((hit) => hit.path))],
            }
          }

          case 'commands_list': {
            const listed = yield* answered(commands.list(projectId))
            if (listed === undefined) {
              return failed("could not read the Project's commands", 'the commands did not read')
            }
            // The folder is said on every line, as the description of the tool promises: a command
            // that runs in one of the Project's repositories is not the same one run at the root.
            const lines = listed.map(
              (command) =>
                `${command.name}  ${command.type}  in ${command.folder ?? 'the Workspace root'}  ${command.line}`,
            )
            // And the runs of this Session, whoever started them (recette 4 of 23 September 2026):
            // a line the human ran from the panel is in the thread, and an agent asked about it
            // that reads only the catalogue answers that it sees nothing. What is running is read
            // from memory, where it stands; what ended from its row, with how it ended.
            const running = (yield* answered(commands.running(asked.sessionId))) ?? []
            const live = new Set(running.map((run) => run.id))
            const ended = ((yield* answered(commands.recent(asked.sessionId))) ?? []).filter(
              (run) => !live.has(run.id),
            )
            const runs = [...running, ...ended].map((run) => {
              const how = run.exitCode === null ? '' : `, exit code ${run.exitCode}`
              const what = run.commandId === null ? 'one-off' : 'catalogue'
              return `${run.id}  ${run.name}  ${run.state}${how}  ${what}  ${run.line}`
            })
            return {
              ok: true,
              summary: `${listed.length} command(s) in the catalogue of ${projectName}, ${runs.length} run(s) in this Session`,
              text: [
                lines.length === 0
                  ? `the catalogue of ${projectName} is empty`
                  : `the catalogue of ${projectName}:\n${lines.join('\n')}`,
                runs.length === 0
                  ? 'no run in this Session yet'
                  : `the runs of this Session, running first, then the last that ended; read one with commands_output:\n${runs.join('\n')}`,
              ].join('\n'),
              paths: [],
            }
          }

          case 'commands_run': {
            const named = call.arguments.name
            const line = call.arguments.line
            if (named === undefined && line === undefined) {
              return failed(
                'commands_run was given neither a name nor a line',
                'give a `name` of the catalogue, or a `line` to run',
              )
            }
            const catalogue = yield* answered(commands.list(projectId))
            const entry = catalogue?.find((command) => command.name === named)
            if (named !== undefined && entry === undefined) {
              const known = catalogue?.map((one) => one.name).join(', ') ?? ''
              return failed(
                `the Project has no command named "${named}"`,
                `the catalogue holds ${known === '' ? 'nothing' : known}`,
              )
            }
            // A catalogue command runs where the user declared it (D6-12): the folder is part of
            // the command, and an agent that names another one is told so rather than obeyed.
            const declared = (folder: string | null | undefined) =>
              folder === null || folder === undefined || folder === '' || folder === '.'
                ? '.'
                : folder
            if (
              entry !== undefined &&
              call.arguments.folder !== undefined &&
              declared(call.arguments.folder) !== declared(entry.folder)
            ) {
              const home = entry.folder ?? 'the Workspace root'
              return failed(
                `${entry.name} runs in ${home}, not in ${call.arguments.folder}`,
                `the folder of a catalogue command is the Project's: ${entry.name} runs in ${home}. Send no folder to run it there, or a \`line\` to run something else where you need it`,
              )
            }
            const where = entry?.folder ?? call.arguments.folder ?? null
            const folder = where === null || where === '' || where === '.' ? '.' : where
            // A catalogue command is the user's own line, and inside the root it runs on its own.
            // A one-off is a line the agent wrote: whatever folder it names, the human sees the
            // line and decides before anything runs (D5-09) — one question, not one per rule.
            const inside =
              entry !== undefined
                ? folder === '.'
                  ? { allowed: true as const, path: root }
                  : yield* allowed(asked, root, folder)
                : yield* Effect.gen(function* () {
                    const place = yield* placeOf(root, folder)
                    if (place.inside === null) {
                      return { allowed: false as const, reason: place.reason }
                    }
                    const oneOff = line ?? ''
                    return yield* askHuman(
                      asked,
                      root,
                      folder,
                      place.path,
                      place.inside
                        ? `commands_run asks to run ${oneOff} in ${place.path}`
                        : `commands_run asks to run ${oneOff} outside the Workspace, in ${place.path}`,
                      oneOff,
                    )
                  })
            if (!inside.allowed) return failed(inside.reason, inside.reason)
            // Asked again right before the start: a call admitted while the Session was alive can
            // reach this point after the Session ended — the human took their time — and a run
            // started now would come after the sweep that stops a Session's runs, and outlive it.
            if (!(yield* access.live(asked.sessionId))) {
              return failed(
                'the Session ended before the command started',
                'this Session no longer has an agent, so nothing was started',
              )
            }
            const started = yield* answered(
              commands.run({
                sessionId: asked.sessionId,
                projectId,
                commandId: entry?.id ?? null,
                name: entry?.name ?? named ?? (line ?? '').split(/\s+/)[0] ?? 'command',
                line: entry?.line ?? line ?? '',
                lineWindows: entry?.lineWindows ?? null,
                lineLinux: entry?.lineLinux ?? null,
                type: entry?.type ?? 'script',
                scope: entry?.scope ?? 'workspace',
                portless: entry?.portless ?? false,
                folder: folder === '.' ? null : folder,
                cwd: inside.path,
                // D8-08: the run belongs to the Session's Workspace, which names it too.
                workspaceId: workspace.id,
                workspaceName: workspace.name,
                // D8-06: the Project's variables overridden by the Workspace's, kept on the run.
                environment: (yield* answered(variables.givenFor(projectId, workspace.id))) ?? {},
                startedBy: 'agent',
              }),
            )
            if (started === undefined) {
              return failed('the command did not start', 'the engine could not start this command')
            }
            // A test or a script is waited for, so the agent reads how it ended in the same
            // answer instead of polling for it; one that outlasts the wait is left running and
            // said to be. A server is meant to keep running, and is answered once it has started.
            const waits =
              call.arguments.background !== true &&
              !started.joined &&
              started.type !== 'serve' &&
              started.state === 'running'
            const run = waits
              ? ((yield* answered(
                  commands
                    .awaited(asked.sessionId, started.id, call.arguments.timeout ?? RUN_WAIT_MS)
                    .pipe(
                      // Started for this call and waited for by it: an agent that stopped waiting
                      // leaves nobody to read it, and it is stopped rather than left behind.
                      Effect.onInterrupt(() =>
                        commands.stop(asked.sessionId, started.id).pipe(Effect.ignore),
                      ),
                    ),
                )) ?? started)
              : started
            const tail = run.output.split('\n').slice(-40).join('\n')
            return {
              ok: run.state !== 'failed',
              summary: run.joined
                ? `${run.name} is already running (${run.id})`
                : `${run.name} is ${run.state} (${run.id})`,
              text: [
                `run ${run.id}: ${run.name} — ${run.state}${run.pid === null ? '' : ` (pid ${run.pid})`}`,
                // The agent reads it too, not only the thread: an agent told "running" and nothing
                // more would believe it had started a second one.
                run.joined
                  ? 'it was already running: nothing new was started, and this is that run'
                  : 'started for this call',
                run.state === 'running'
                  ? `still running, left in the background: run id ${run.id}; read it with commands_output, stop it with commands_stop`
                  : `exit code ${run.exitCode === null ? 'none' : String(run.exitCode)}`,
                run.url === null ? 'no address published yet' : `address: ${run.url}`,
                tail === '' ? 'nothing printed yet' : `output:\n${tail}`,
              ].join('\n'),
              paths: [],
            }
          }

          case 'commands_output': {
            const chosen = yield* chooseRun(asked, call.arguments.run ?? null, true)
            if (chosen === null) {
              return failed('no run of this Session to read', 'start one with commands_run')
            }
            const read = yield* answered(commands.output(asked.sessionId, chosen))
            if (read === undefined) {
              return failed(
                `no run of this Project has the identifier "${chosen}"`,
                'that run is not one of this Project',
              )
            }
            const run = read
            const tail = run.output.split('\n').slice(-200).join('\n')
            return {
              ok: true,
              summary: `${run.name} is ${run.state}${run.dropped === 0 ? '' : ` (${run.dropped} bytes dropped)`}`,
              text: [
                `run ${run.id}: ${run.name} — ${run.state}${run.pid === null ? '' : ` (pid ${run.pid})`}`,
                run.url === null ? 'no address published' : `address: ${run.url}`,
                run.exitCode === null ? 'still running' : `exit code ${run.exitCode}`,
                tail === '' ? 'nothing printed' : `output:\n${tail}`,
              ].join('\n'),
              paths: [],
            }
          }

          case 'commands_stop': {
            const chosen = yield* chooseRun(asked, call.arguments.run ?? null)
            if (chosen === null) {
              return failed('no run of this Session is running', 'nothing to stop')
            }
            const stopped = yield* answered(commands.stop(asked.sessionId, chosen))
            if (stopped === undefined) {
              return failed(
                `no run of this Project has the identifier "${chosen}"`,
                'that run is not one of this Project',
              )
            }
            return completed(
              `stopped ${stopped.name}`,
              `${stopped.name} was stopped, and so was everything it started`,
            )
          }

          case 'commands_propose': {
            const { name, line, type, why } = call.arguments
            // The folder is the root or one of the Project's repositories, as a catalogue
            // command's is (D6-12): a proposal the human could not accept as it stands is refused.
            const named = call.arguments.folder ?? ROOT_REPOSITORY
            const folder =
              named === '' || named === ROOT_REPOSITORY
                ? null
                : repositories.find((one) => one === named || one === `./${named}`)
            if (folder === undefined) {
              return failed(
                `${named} is not a repository of ${projectName}`,
                `a command runs at the Workspace root or in one of the Project's repositories: ${repositories.length === 0 ? 'it declares none' : repositories.join(', ')}`,
              )
            }
            const catalogue = yield* answered(commands.list(projectId))
            if (catalogue === undefined) {
              return failed("could not read the Project's commands", 'the commands did not read')
            }
            if (catalogue.some((command) => command.name === name)) {
              return failed(
                `the catalogue already holds ${name}`,
                `${name} is already a command of ${projectName}: run it with commands_run, or propose another name`,
              )
            }
            // The proposal is an entry of the thread the human decides on, and nothing else: the
            // agent has no write on the catalogue (D8-11). Its Journal line goes in the same
            // transaction as the entry (D8-16).
            const proposalId = crypto.randomUUID()
            const written = yield* answered(
              inThread(asked.sessionId, {
                role: 'hemera',
                kind: 'command_proposal',
                body: name,
                payload: JSON.stringify({
                  proposalId,
                  name,
                  line,
                  type,
                  folder,
                  why,
                  state: 'pending',
                }),
                correlationId: `proposal:${proposalId}`,
                state: 'pending',
                events: [
                  {
                    type: 'command.proposed',
                    entityKind: 'command',
                    entityId: proposalId,
                    source: 'system',
                    author: 'agent',
                    projectId,
                    sessionId: asked.sessionId,
                    payload: { name, type },
                  },
                ],
              }),
            )
            if (written === undefined) {
              return failed('the proposal was not written', 'the thread of this Session refused it')
            }
            return completed(
              `proposed ${name} for the catalogue`,
              'proposed: a human will decide in the Session; nothing is in the catalogue yet',
            )
          }

          case 'project_get': {
            const lines = [
              `project: ${projectName} (${projectId})`,
              `root: ${root}`,
              repositories.length === 0
                ? 'reads from: nothing but the root'
                : `reads from: ${repositories.join(', ')}`,
            ]
            return completed(`read the Project ${projectName}`, lines.join('\n'))
          }

          case 'session_get': {
            const thread = yield* answered(sessions.read(asked.sessionId, undefined, THREAD_TAIL))
            if (thread === undefined) {
              return failed('the thread did not read', 'this Session has no thread to read')
            }
            const lines = thread.entries.map(
              (entry) => `[${entry.seq}] ${entry.role}/${entry.kind}: ${entry.body.slice(0, 200)}`,
            )
            return completed(
              `read this Session (${thread.entries.length} entries)`,
              [
                `session: ${asked.sessionId}`,
                `project: ${projectName}`,
                `root: ${root}`,
                ...lines,
              ].join('\n'),
            )
          }
        }
      })

    /** One call from the guard to the answer, or one already refused by the server, recorded. */
    const handled = (asked: ToolCall, rejected: string | null) =>
      Effect.gen(function* () {
        const named = TOOL_NAMES.find((one) => one === asked.tool)
        const read = yield* answered(sessions.one(asked.sessionId))
        if (read === undefined) {
          return {
            ok: false,
            state: 'refused' as const,
            summary: 'this Session is unknown',
            text: 'this Session is unknown to the engine',
            paths: [],
            repeated: false,
            range: null,
          }
        }
        const session = read.session
        const all = yield* answered(projects.list())
        const project = all?.find((one) => one.id === session.projectId)
        if (project === undefined) {
          return {
            ok: false,
            state: 'failed' as const,
            summary: 'the Project of this Session is missing',
            text: 'this Session belongs to a Project the engine cannot read',
            paths: [],
            repeated: false,
            range: null,
          }
        }
        // The tools act in the Session's Workspace (D8-08): its path is their root.
        const workspace = yield* answered(sessions.workspace(asked.sessionId))
        if (workspace === undefined) {
          return {
            ok: false,
            state: 'failed' as const,
            summary: 'the Workspace of this Session is missing',
            text: 'this Session works in a Workspace the engine cannot read',
            paths: [],
            repeated: false,
            range: null,
          }
        }
        const root = workspace.path
        // The agent of the Session is what the thread names as the caller, beside the digest of
        // the token: a Session without one is served all the same, and "agent" is what it says.
        const made = {
          projectId: project.id,
          agent: session.provider ?? 'agent',
          milliseconds: 0,
        } satisfies Made

        if (rejected !== null) return yield* refused(asked, made, rejected)
        if (named === undefined) {
          return yield* refused(asked, made, `Hemera has no tool named ${asked.tool}`)
        }
        const decision = admitTool(asked.offered, named)
        if (!decision.admitted) return yield* refused(asked, made, decision.reason)

        const parsed = parseCall(named, asked.arguments)
        if (!parsed.ok) {
          return yield* refused(
            asked,
            made,
            `the arguments of ${named} do not read: ${parsed.reason}`,
          )
        }

        // Measured around the tool itself, question to the human included: what the Journal
        // says a call took is how long the agent waited for it.
        const run = Effect.gen(function* () {
          // A monotonic clock, to the microsecond: a read inside the root takes less than a
          // millisecond, and a call recorded as taking none is a call that says nothing of itself.
          const began = performance.now()
          const answer = yield* perform(
            asked,
            root,
            workspace,
            project.id,
            project.name,
            project.repositories,
            parsed.call,
          )
          // A tool has no error channel on purpose: everything a tool can be told no by is
          // answered as a value, and what would remain is a defect the engine should hear about.
          return yield* settle(
            asked,
            { ...made, milliseconds: Math.round((performance.now() - began) * 1000) / 1000 },
            answer,
            answer.ok ? 'completed' : 'failed',
          )
        }).pipe(
          // The agent gave up on the call — its request was aborted — and what the call was
          // doing stopped with it. It is still a call: it is written down, as one that failed.
          Effect.onInterrupt(() =>
            note(
              asked,
              'failed',
              failed(
                'the agent stopped waiting for this call',
                'the request was cancelled before the call ended',
              ),
              made,
            ),
          ),
        )
        if (asked.key === null) return yield* run

        const key = asked.key
        const slot = `${named}|${key}`
        const sent = argumentsSent(asked.arguments)
        /**
         * The answer an earlier call under this key was given, as this call's own: no second
         * entry in the thread, one Journal line that says the call was a repeat — unless the
         * arguments differ, which is a new call under an old key and is refused rather than
         * guessed at, because either answer would be wrong for one of the two.
         */
        const again = (first: ToolOutcome, firstSent: string) =>
          Effect.gen(function* () {
            if (firstSent !== sent) {
              return yield* refused(
                asked,
                made,
                `the key "${key}" was already used by a ${named} call with other arguments: send a new key for a new call`,
              )
            }
            yield* journalled(asked, made, 'tool.repeated', { state: first.state, key })
            return { ...first, repeated: true }
          })
        const earlier = answeredBefore(asked.sessionId, slot)
        if (earlier !== undefined) return yield* again(earlier.outcome, earlier.sent)
        const reservation = `${asked.sessionId}|${slot}`
        const running = inFlight.get(reservation)
        if (running !== undefined) {
          const first = yield* Deferred.await(running.outcome)
          return yield* again(first, running.sent)
        }
        const reserved = Deferred.makeUnsafe<ToolOutcome>()
        inFlight.set(reservation, { sent, outcome: reserved })
        const outcome = yield* run.pipe(
          Effect.onExit((exit) =>
            Effect.gen(function* () {
              inFlight.delete(reservation)
              yield* Deferred.done(reserved, exit)
            }),
          ),
        )
        // Whatever it answered is remembered: a retry is answered what the first call was, a
        // refusal included. A corrected call is a call with other arguments, and it is told to
        // send a new key rather than being answered for the one it replaced.
        remember(asked.sessionId, slot, { sent, outcome })
        return outcome
      })

    return {
      call: (asked) => handled(asked, null),
      refuse: (asked, reason) => handled(asked, reason).pipe(Effect.asVoid),
    }
  }),
)
