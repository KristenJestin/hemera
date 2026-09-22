/**
 * The eleven tools, and the one door every call goes through (design D6-03, D6-04, D6-05).
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
  type SearchResult,
  TOOL_NAMES,
  type ToolName,
  admitTool,
} from '@hemera/core'
import { Context, Effect, Layer } from 'effect'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative } from 'node:path'

import { Commands } from '../commands/service.ts'
import { Projects } from '../projects.ts'
import { Sessions } from '../sessions.ts'
import { Database } from '../storage/database.ts'
import { mutate } from '../transaction.ts'
import { type ToolArguments, type ParsedCall, parseCall } from './arguments.ts'
import { type RefusedPathError, resolveInside } from './paths.ts'
import { ToolPermissions } from './permissions.ts'
import { searchIn } from './search.ts'

/** How much of an argument list is kept in the Journal, so a payload stays a payload. */
const ARGUMENTS_KEPT = 400

/** How many entries of the thread `session.get` hands back. */
const THREAD_TAIL = 20

/** How many answered keys are held against a retry before the oldest are let go of. */
const KEYS_KEPT = 200

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
}

export interface ToolCatalogueService {
  /** One call, from the guard to the answer. Never fails: a refusal is an answer. */
  readonly call: (asked: ToolCall) => Effect.Effect<ToolOutcome>
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

/** What a tool hands back before it has been written down. */
interface Answer {
  readonly ok: boolean
  readonly summary: string
  readonly text: string
  readonly paths: readonly string[]
}

/** What reading a file answered, before it became an answer. */
interface Page {
  readonly text: string
  readonly offset: number
  /** How many bytes this page took, which is where the next one starts. */
  readonly read: number
  readonly size: number
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

/** One line of a folder, as `fs.list` shows it. */
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
  return [head, stop, ...lines].join('\n')
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
  Projects | Sessions | Commands | ToolPermissions | Database
> = Layer.effect(
  ToolCatalogue,
  Effect.gen(function* () {
    const projects = yield* Projects
    const sessions = yield* Sessions
    const commands = yield* Commands
    const permissions = yield* ToolPermissions
    const database = yield* Database

    /** The answers already given for a key, so a retry is answered and not repeated. */
    const done = new Map<string, ToolOutcome>()

    /**
     * Keeps one answer against its key, and lets go of the oldest when there are too many.
     *
     * A retry happens seconds after the answer it lost, so what is worth holding is the recent
     * past: an engine that ran for a day would otherwise be holding every write of every Session
     * it ever served, texts and all.
     */
    const remember = (key: string, outcome: ToolOutcome) => {
      done.set(key, outcome)
      while (done.size > KEYS_KEPT) {
        const oldest = done.keys().next()
        if (oldest.done === true) break
        done.delete(oldest.value)
      }
    }

    const withDatabase = <A, E>(effect: Effect.Effect<A, E, Database>): Effect.Effect<A, E> =>
      effect.pipe(Effect.provideService(Database, database))

    /** The line and the event of one call, written together, in the thread and in the Journal. */
    const note = (asked: ToolCall, state: ToolState, answer: Answer, made: Made) =>
      Effect.gen(function* () {
        const payload = JSON.stringify({
          tool: asked.tool,
          state,
          caller: asked.caller,
          // Who asked and how long it took: the thread shows a call under the agent that made it,
          // and a call that took a while is a call the reader wants the length of.
          agent: made.agent,
          ms: made.milliseconds,
          paths: answer.paths,
          arguments: JSON.stringify(asked.arguments).slice(0, ARGUMENTS_KEPT),
        })
        yield* sessions
          .write(asked.sessionId, {
            role: 'agent',
            kind: 'hemera_tool_call',
            body: answer.summary,
            payload,
            correlationId: asked.key === null ? null : `tool:${asked.tool}:${asked.key}`,
            state,
          })
          .pipe(
            // A thread that cannot be written is a Session that went away while the call was
            // running: the answer is still the answer, and losing the line is not losing it.
            Effect.catch(() => Effect.void),
          )
        yield* withDatabase(
          mutate('recording a tool call', () =>
            Effect.succeed({
              result: null,
              events: [
                {
                  type: `tool.${state}`,
                  entityKind: 'session' as const,
                  entityId: asked.sessionId,
                  source: 'system' as const,
                  author: 'mcp' as const,
                  projectId: made.projectId,
                  sessionId: asked.sessionId,
                  payload: {
                    tool: asked.tool,
                    state,
                    caller: asked.caller,
                    paths: answer.paths.length,
                    milliseconds: made.milliseconds,
                  },
                },
              ],
            }),
          ),
        ).pipe(Effect.catch(() => Effect.void))
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
        }
        // Only what happened is remembered. A key is there so that a retry after a lost answer
        // does not write twice, and a call that wrote nothing — a refusal, a read that failed —
        // wrote nothing to protect: answering it from memory would refuse the corrected call
        // that comes back under the same key for ever.
        if (asked.key !== null && state === 'completed') {
          remember(`${asked.sessionId}|${asked.tool}|${asked.key}`, outcome)
        }
        return outcome
      })

    /** A refusal: the same road as an answer, so a refusal is recorded like any call. */
    const refused = (asked: ToolCall, made: Made, reason: string) =>
      settle(asked, made, { ok: false, summary: reason, text: reason, paths: [] }, 'refused')

    /** Where a tool may act: inside the root, or wherever the human has just allowed. */
    const allowed = (asked: ToolCall, root: string, named: string) =>
      Effect.gen(function* () {
        const settled = yield* Effect.promise(() =>
          resolveInside(root, named).then(
            (path) => ({ inside: true as const, path }),
            (refusal: RefusedPathError) => ({ inside: false as const, refusal }),
          ),
        )
        if (settled.inside) return { allowed: true as const, path: settled.path }
        if (settled.refusal.why === 'unreadable') {
          return { allowed: false as const, reason: settled.refusal.message }
        }
        const id = crypto.randomUUID()
        const body = `${asked.tool} asks to act outside the Workspace: ${named}`
        // The block the window already draws for an agent's own permission is the one this is
        // read by: the same two options every time, because the question is always the same one
        // and nothing about it is remembered (D6-05). The request and the decision are two rows
        // under two correlations, so neither is written over the other.
        const request = (state: string) =>
          sessions
            .write(asked.sessionId, {
              role: 'hemera',
              kind: 'permission_request',
              body,
              payload: JSON.stringify({
                toolCallId: id,
                options: OUTSIDE_OPTIONS,
                tool: asked.tool,
                named,
                root,
              }),
              correlationId: `perm:${id}`,
              state,
            })
            .pipe(Effect.catch(() => Effect.void))

        yield* request('pending')
        const answer = yield* permissions.askOutside({
          id,
          sessionId: asked.sessionId,
          tool: asked.tool,
          named,
          root,
        })
        yield* request(answer === 'allowed' ? 'decided' : 'refused')
        yield* sessions
          .write(asked.sessionId, {
            role: 'user',
            kind: 'permission_decision',
            body:
              answer === 'allowed'
                ? `you allowed ${asked.tool} to act on ${named}`
                : `you refused ${asked.tool} on ${named}`,
            payload: JSON.stringify({
              toolCallId: id,
              optionId: answer === 'allowed' ? 'allowed' : null,
              tool: asked.tool,
              named,
              answer,
            }),
            correlationId: `decision:${id}`,
            state: answer === 'allowed' ? 'completed' : 'refused',
          })
          .pipe(Effect.catch(() => Effect.void))
        const absolute = isAbsolute(named) ? named : join(root, named)
        if (answer === 'refused') {
          return {
            allowed: false as const,
            reason: `the user refused: ${named} is outside ${root}`,
          }
        }
        return { allowed: true as const, path: absolute }
      })

    /** Which run a call means, when it named none: the only one this Session has going. */
    /**
     * Which run a call is about: the one it names, else the only one running, else — when the
     * call came to read and nothing is running — the last run of the Session. A `check` or a
     * `utility` is over by the time its output is read, and its exit code is the whole point.
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
      run: () => Promise<A>,
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
      projectId: string,
      projectName: string,
      repositories: readonly string[],
      call: ParsedCall,
    ): Effect.Effect<Answer> =>
      Effect.gen(function* () {
        switch (call.tool) {
          case 'fs.read': {
            const settled = yield* allowed(asked, root, call.arguments.path)
            if (!settled.allowed) return failed(settled.reason, settled.reason)
            const page = yield* attempt<Page>(() =>
              readFile(settled.path).then((data) => {
                const offset = call.arguments.offset ?? 0
                const limit = call.arguments.limit ?? READ_PAGE_BYTES
                const slice = data.subarray(offset, offset + limit)
                return {
                  text: slice.toString('utf8'),
                  offset,
                  // What the next page starts at is how many bytes were taken, not how long the
                  // text reads: a page that ends in the middle of a character decodes to a
                  // replacement character three bytes wide, and an offset measured on the text
                  // would skip the two bytes the next page has to begin with.
                  read: slice.length,
                  size: data.length,
                }
              }),
            )
            if (!page.ok) {
              return failed(`could not read ${call.arguments.path}`, page.reason)
            }
            const end = page.value.offset + page.value.read
            const more =
              end < page.value.size
                ? `\n(that is bytes ${page.value.offset}-${end} of ${page.value.size}; the next page starts at offset ${end})`
                : ''
            return {
              ok: true,
              summary: `read ${call.arguments.path} (bytes ${page.value.offset}-${end} of ${page.value.size})`,
              text: `${page.value.text}${more}`,
              paths: [call.arguments.path],
            }
          }

          case 'fs.write': {
            const settled = yield* allowed(asked, root, call.arguments.path)
            if (!settled.allowed) return failed(settled.reason, settled.reason)
            const written = yield* attempt(() =>
              mkdir(dirname(settled.path), { recursive: true }).then(() =>
                writeFile(settled.path, call.arguments.content, 'utf8'),
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

          case 'fs.edit': {
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
            const next = current.value.replace(call.arguments.old, call.arguments.new)
            const written = yield* attempt(() => writeFile(settled.path, next, 'utf8'))
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

          case 'fs.list': {
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
            const found = yield* attempt(() =>
              searchIn({
                root,
                query: call.arguments.query,
                path: relative(root, within.path) === '' ? null : relative(root, within.path),
                cursor: call.arguments.cursor ?? null,
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

          case 'commands.list': {
            const listed = yield* answered(commands.list(projectId))
            if (listed === undefined) {
              return failed("could not read the Project's commands", 'the commands did not read')
            }
            const lines = listed.map(
              (command) => `${command.name}  ${command.kind}  ${command.line}`,
            )
            return {
              ok: true,
              summary: `${listed.length} command(s) in the catalogue of ${projectName}`,
              text:
                lines.length === 0 ? `the catalogue of ${projectName} is empty` : lines.join('\n'),
              paths: [],
            }
          }

          case 'commands.run': {
            const named = call.arguments.name
            const line = call.arguments.line
            if (named === undefined && line === undefined) {
              return failed(
                'commands.run was given neither a name nor a line',
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
            const where = call.arguments.folder ?? entry?.folder ?? null
            const inside =
              where === null || where === '' || where === '.'
                ? { allowed: true as const, path: root }
                : yield* allowed(asked, root, where)
            if (!inside.allowed) return failed(inside.reason, inside.reason)
            const started = yield* answered(
              commands.run({
                sessionId: asked.sessionId,
                projectId,
                commandId: entry?.id ?? null,
                name: entry?.name ?? named ?? (line ?? '').split(/\s+/)[0] ?? 'command',
                line: entry?.line ?? line ?? '',
                kind: entry?.kind ?? 'utility',
                cwd: inside.path,
                startedBy: 'agent',
              }),
            )
            if (started === undefined) {
              return failed('the command did not start', 'the engine could not start this command')
            }
            const run = started
            const tail = run.output.split('\n').slice(-40).join('\n')
            return {
              ok: run.state !== 'failed',
              summary: run.joined
                ? `${run.name} is already running (${run.id})`
                : `${run.name} is ${run.state} (${run.id})`,
              text: [
                `run ${run.id}: ${run.name} — ${run.state}${run.pid === null ? '' : ` (pid ${run.pid})`}`,
                run.url === null ? 'no address published yet' : `address: ${run.url}`,
                tail === '' ? 'nothing printed yet' : `output:\n${tail}`,
              ].join('\n'),
              paths: [],
            }
          }

          case 'commands.output': {
            const chosen = yield* chooseRun(asked, call.arguments.run ?? null, true)
            if (chosen === null) {
              return failed('no run of this Session to read', 'start one with commands.run')
            }
            const read = yield* answered(commands.output(asked.sessionId, chosen))
            if (read === undefined) {
              return failed(
                `no run of this Session has the identifier "${chosen}"`,
                'that run is not one of this Session',
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

          case 'commands.stop': {
            const chosen = yield* chooseRun(asked, call.arguments.run ?? null)
            if (chosen === null) {
              return failed('no run of this Session is running', 'nothing to stop')
            }
            const stopped = yield* answered(commands.stop(asked.sessionId, chosen))
            if (stopped === undefined) {
              return failed(
                `no run of this Session has the identifier "${chosen}"`,
                'that run is not one of this Session',
              )
            }
            return completed(
              `stopped ${stopped.name}`,
              `${stopped.name} was stopped, and so was everything it started`,
            )
          }

          case 'project.get': {
            const lines = [
              `project: ${projectName} (${projectId})`,
              `root: ${root}`,
              repositories.length === 0
                ? 'reads from: nothing but the root'
                : `reads from: ${repositories.join(', ')}`,
            ]
            return completed(`read the Project ${projectName}`, lines.join('\n'))
          }

          case 'session.get': {
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

    return {
      call: (asked) =>
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
            }
          }
          const root = project.mainPath
          // The agent of the Session is what the thread names as the caller, beside the digest of
          // the token: a Session without one is served all the same, and "agent" is what it says.
          const made = {
            projectId: project.id,
            agent: session.provider ?? 'agent',
            milliseconds: 0,
          } satisfies Made

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

          const key = asked.key === null ? null : `${asked.sessionId}|${named}|${asked.key}`
          if (key !== null) {
            const earlier = done.get(key)
            if (earlier !== undefined) return { ...earlier, repeated: true }
          }

          // Measured around the tool itself, question to the human included: what the Journal
          // says a call took is how long the agent waited for it.
          const began = Date.now()
          const answer = yield* perform(
            asked,
            root,
            project.id,
            project.name,
            project.repositories,
            parsed.call,
          )
          // A tool has no error channel on purpose: everything a tool can be told no by is
          // answered as a value, and what would remain is a defect the engine should hear about.
          return yield* settle(
            asked,
            { ...made, milliseconds: Date.now() - began },
            answer,
            answer.ok ? 'completed' : 'failed',
          )
        }),
    }
  }),
)
