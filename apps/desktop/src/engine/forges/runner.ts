/**
 * The one runner of the forge CLIs (#253): every `gh` and `bkt` call Hemera makes goes through it.
 *
 * - It refuses, before spawning, any command whose arguments match no registered shape
 *   (`shapes.ts`): what Hemera may write on a forge is that list. A gh command that names another
 *   host than its call's is refused too.
 * - The CLI is found on the user's `PATH` (`gh.exe`, `bkt.exe`, or a `.cmd` shim, which `cmd.exe`
 *   runs, on Windows) and run as a program with an argument array, never through a shell, under
 *   the process supervisor, in the user's own environment: never the agents' (no empty
 *   `GH_CONFIG_DIR`, no injected `pushInsteadOf`), and never with a token Hemera would pass. A text
 *   Hemera sends goes on the standard input.
 * - A read has 30 seconds, a write 2 minutes; a call cut at its limit is killed, waited for, and
 *   answered `ForgeTimeout`. A process that cannot run, or dies on a signal, is `ForgeUnreachable`.
 * - The exit code is kept, and the standard error, masked: the caller decides what a failure is.
 * - A write is recorded as an effectful action (CT-09): its intent before it starts, its outcome
 *   after.
 */

import { type ForgeCli, type ForgeName, ForgeTimeout, ForgeUnreachable } from '@hemera/ipc'
import { Context, Deferred, Effect, Layer, Option, Schema } from 'effect'

import { findOnPath, hostLookup, invocationOf } from '../command-line.ts'
import type { DomainEvents } from '../domain-events.ts'
import { Secrets } from '../secrets.ts'
import type { Database, DatabaseError } from '../storage/database.ts'
import { ProcessSupervisor } from '../supervisor.ts'
import { actionDone, actionFailed, beginAction, settleActionIn } from '../tools/actions.ts'
import { mutate, outsideTransaction } from '../transaction.ts'
import { type CommandShape, type ParsedCommand, aimsAt, parseCommand } from './shapes.ts'

/** How long a forge call may run: a read, a write. */
export const FORGE_LIMITS = { read: 30_000, write: 120_000 } as const

const readJsonObject = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.Json)),
)

/** How much of what a CLI prints is read before the call is cut. */
const OUTPUT_LIMIT = 32 * 1024 * 1024

export interface ForgeSettings {
  /** The environment the CLIs are found and run in: the engine's own, the user's, otherwise. */
  readonly env?: Readonly<Record<string, string | undefined>> | undefined
  /** Shorter limits, for the suites. */
  readonly limits?: { readonly read: number; readonly write: number } | undefined
  /**
   * The real path of the screenshot of Hemera's a path names, or null: the only files attached.
   * None otherwise, and nothing is attached.
   */
  readonly attachable?: ((path: string) => string | null) | undefined
}

/** One call: which CLI, for which forge and host, for which Project, with which arguments. */
export interface ForgeCall {
  readonly cli: ForgeCli
  readonly forge: ForgeName
  readonly host: string
  readonly projectId: string
  readonly args: ReadonlyArray<string>
  /** The bkt context the port chose for the host, which a bkt write must name; none otherwise. */
  readonly context?: string | null
  /** Written on the standard input, then closed. */
  readonly input?: string
}

/**
 * What a call answered: the command it ran, its exit code, what it printed and its standard error,
 * all three masked. An output that is a JSON object is read first and masked value by value
 * (`maskRecord`: every string, and a credential field whole), then written back, so its structure
 * stays readable; any other output is masked as text.
 */
export interface ForgeAnswer {
  readonly command: string
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

/** A command no registered shape allows, refused before anything was started. */
export class ForgeCommandRefused extends Schema.TaggedError<ForgeCommandRefused>()(
  'ForgeCommandRefused',
  { command: Schema.String },
) {
  override get message(): string {
    return `Hemera does not run “${this.command}”: it is not a command it may send to a forge.`
  }
}

/** The CLI is not on the user's `PATH`. */
export class ForgeCliMissing extends Schema.TaggedError<ForgeCliMissing>()('ForgeCliMissing', {
  cli: Schema.String,
}) {
  override get message(): string {
    return `${this.cli} was not found on the PATH.`
  }
}

export type ForgeRunFailure =
  | ForgeCommandRefused
  | ForgeCliMissing
  | ForgeTimeout
  | ForgeUnreachable

export class ForgeRunner extends Context.Service<
  ForgeRunner,
  {
    /** Where the CLI is on the user's `PATH`, or none. */
    readonly find: (cli: ForgeCli) => Effect.Effect<Option.Option<string>>
    readonly run: (call: ForgeCall) => Effect.Effect<ForgeAnswer, ForgeRunFailure>
  }
>()('ForgeRunner') {}

/**
 * The arguments to run, an attachment named by the real path checked; null when the command
 * attaches anything but one of Hemera's own screenshots (`ForgeSettings.attachable`), which would
 * read and upload a file of the user's. `path#caption` holds one `#` at most: the CLI might split
 * on another one than the check did.
 */
const withOwnAttachment = (
  args: ReadonlyArray<string>,
  parsed: ParsedCommand,
  attachable: ((path: string) => string | null) | undefined,
): ReadonlyArray<string> | null => {
  const value = parsed.flags.get('--attach')
  if (value === undefined) return args
  if (value === null || attachable === undefined) return null
  const [path = '', caption, ...more] = value.split('#')
  if (more.length > 0) return null
  const real = attachable(path)
  if (real === null) return null
  const at = args.indexOf('--attach', parsed.shape.words.length) + 1
  return args.with(at, caption === undefined ? real : `${real}#${caption}`)
}

/** Whether a bkt write names the context its call carries, the one chosen for the host. */
const throughItsContext = (call: ForgeCall, parsed: ParsedCommand): boolean =>
  call.cli !== 'bkt' ||
  parsed.shape.class === 'read' ||
  (call.context !== undefined &&
    call.context !== null &&
    parsed.flags.get('--context') === call.context)

/** What each CLI is told so that it never waits on a person nor decorates what it prints. */
const QUIET: Readonly<Record<ForgeCli, Readonly<Record<string, string>>>> = {
  gh: { GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1', NO_COLOR: '1' },
  bkt: { NO_COLOR: '1' },
}

export const forgeRunnerLayer = (settings: ForgeSettings = {}) =>
  Layer.effect(
    ForgeRunner,
    Effect.gen(function* () {
      const supervisor = yield* ProcessSupervisor
      const secrets = yield* Secrets
      const context = yield* Effect.context<Database | DomainEvents | Secrets>()
      const env = settings.env ?? process.env
      const limits = settings.limits ?? FORGE_LIMITS
      const recording = <A, E>(effect: Effect.Effect<A, E, Database | DomainEvents | Secrets>) =>
        Effect.provide(effect, context)

      const environment = (cli: ForgeCli) => {
        const given: Record<string, string> = {}
        for (const [name, value] of Object.entries(env)) {
          if (value !== undefined) given[name] = value
        }
        return { ...given, ...QUIET[cli] }
      }

      /** What a CLI printed, masked: a JSON object value by value, any other text as text. */
      const maskOutput = (printed: string): string =>
        Option.match(readJsonObject(printed), {
          onNone: () => secrets.mask(printed),
          onSome: (object) => JSON.stringify(secrets.maskRecord(object)),
        })

      const find = (cli: ForgeCli) =>
        Effect.sync(() =>
          Option.fromNullishOr(findOnPath(cli, hostLookup(process.cwd(), env), process.platform)),
        )

      /** Spawns the CLI and reads its answer, within its limit. */
      const spawned = (
        call: ForgeCall,
        program: string,
        limit: number,
        command: string,
      ): Effect.Effect<ForgeAnswer, ForgeRunFailure> =>
        Effect.scoped(
          Effect.gen(function* () {
            const invocation = invocationOf(
              [program, ...call.args],
              process.platform,
              hostLookup(process.cwd(), env),
            )
            const started = invocation ?? { program, args: call.args, verbatim: false }
            const where = { forge: call.forge, host: call.host, command }
            const child = yield* supervisor
              .start(started.program, started.args, {
                env: environment(call.cli),
                verbatim: started.verbatim,
                owner: { kind: 'forge', id: call.host },
                graceMillis: 0,
              })
              .pipe(
                Effect.mapError((failed) =>
                  failed.reason.includes('ENOENT')
                    ? new ForgeCliMissing({ cli: call.cli })
                    : new ForgeUnreachable({ ...where, reason: secrets.mask(failed.reason) }),
                ),
              )
            if (call.input !== undefined) yield* child.write(call.input)
            yield* child.closeInput
            const out: string[] = []
            const err: string[] = []
            let printed = 0
            const outputEnded = yield* Deferred.make<void>()
            const errorsEnded = yield* Deferred.make<void>()
            const tooLong = yield* Deferred.make<void>()
            // A CLI on Windows ends its lines with CRLF: the carriage return is not part of a line.
            const line = (text: string) => text.replace(/\r$/, '')
            child.onStdout(
              (text) => {
                printed += text.length + 1
                if (printed > OUTPUT_LIMIT) Deferred.doneUnsafe(tooLong, Effect.void)
                else out.push(line(text))
              },
              () => {
                Deferred.doneUnsafe(outputEnded, Effect.void)
              },
            )
            child.onStderr(
              (text) => {
                printed += text.length + 1
                if (printed > OUTPUT_LIMIT) Deferred.doneUnsafe(tooLong, Effect.void)
                else err.push(line(text))
              },
              () => {
                Deferred.doneUnsafe(errorsEnded, Effect.void)
              },
            )
            // Answered once it exited and both its outputs were read to their end.
            const ended = Effect.all([
              child.exited,
              Deferred.await(outputEnded),
              Deferred.await(errorsEnded),
            ])
            const finished = yield* Effect.raceFirst(
              Effect.map(ended, ([exit]) => Option.some(exit)),
              Effect.as(Deferred.await(tooLong), Option.none()),
            ).pipe(Effect.timeoutOption(limit))
            if (Option.isNone(finished)) {
              yield* child.kill
              yield* child.exited
              return yield* new ForgeTimeout({ ...where, seconds: limit / 1000 })
            }
            if (Option.isNone(finished.value)) {
              yield* child.kill
              yield* child.exited
              return yield* new ForgeUnreachable({
                ...where,
                reason: 'it printed more than Hemera reads of one answer',
              })
            }
            const exit = finished.value.value
            if (exit.code === null) {
              return yield* new ForgeUnreachable({
                ...where,
                reason: `it ended on ${exit.signal ?? 'a signal'}`,
              })
            }
            return {
              command,
              code: exit.code,
              stdout: maskOutput(out.join('\n')),
              stderr: secrets.mask(err.join('\n').trim()),
            } satisfies ForgeAnswer
          }),
        )

      /** A write, recorded: its intent committed before it starts, its outcome after. */
      const recorded = (
        call: ForgeCall,
        shape: CommandShape,
        command: string,
        effect: Effect.Effect<ForgeAnswer, ForgeRunFailure>,
      ): Effect.Effect<ForgeAnswer, ForgeRunFailure | DatabaseError> =>
        Effect.gen(function* () {
          const id = yield* recording(
            beginAction(
              `forge.${shape.operation}`,
              { kind: 'project', projectId: call.projectId },
              { forge: call.forge, host: call.host, command },
            ),
          )
          const failed = <F extends ForgeRunFailure>(failure: F) =>
            Effect.andThen(recording(actionFailed(id, failure.message)), Effect.fail(failure))
          const answer = yield* effect.pipe(
            Effect.catchTags({
              // Cut at its limit, a write may or may not have reached the forge.
              ForgeTimeout: (cut) =>
                Effect.andThen(
                  recording(
                    mutate('recording a forge call cut at its limit', (transaction) =>
                      Effect.map(
                        settleActionIn(transaction, id, 'indeterminate', null),
                        (events) => ({ result: undefined, events }),
                      ),
                    ),
                  ),
                  Effect.fail(cut),
                ),
              ForgeUnreachable: failed,
              ForgeCliMissing: failed,
              ForgeCommandRefused: failed,
            }),
          )
          yield* recording(
            answer.code === 0
              ? actionDone(id, `exit 0`)
              : actionFailed(
                  id,
                  answer.stderr === '' ? `exit ${String(answer.code)}` : answer.stderr,
                ),
          )
          return answer
        })

      const run = (call: ForgeCall): Effect.Effect<ForgeAnswer, ForgeRunFailure> =>
        Effect.gen(function* () {
          const asked = secrets.mask([call.cli, ...call.args].join(' '))
          const parsed = parseCommand(call.cli, call.args)
          // A command for another host than its call's would reach a forge it was not meant for,
          // and so would a bkt write through another context than the one chosen for the host; an
          // image from anywhere but Hemera's screenshots would upload a file of the user's.
          const args =
            parsed === null ? null : withOwnAttachment(call.args, parsed, settings.attachable)
          if (
            parsed === null ||
            args === null ||
            !aimsAt(call.cli, call.args, call.host) ||
            !throughItsContext(call, parsed)
          ) {
            return yield* new ForgeCommandRefused({ command: asked })
          }
          // What runs, and is recorded: an attachment by the real path checked.
          const ran: ForgeCall = { ...call, args }
          const command = secrets.mask([ran.cli, ...ran.args].join(' '))
          const { shape } = parsed
          const program = yield* find(ran.cli)
          if (Option.isNone(program)) return yield* new ForgeCliMissing({ cli: ran.cli })
          const limit = shape.class === 'read' ? limits.read : limits.write
          const answered = spawned(ran, program.value, limit, command)
          const done = shape.class === 'read' ? answered : recorded(ran, shape, command, answered)
          return yield* outsideTransaction(`run ${ran.cli} ${ran.args[0] ?? ''}`, done).pipe(
            Effect.catchTag('SideEffectInTransaction', (refused) => Effect.die(refused)),
          )
        }).pipe(
          // The records of a write that could not be written are the data folder's failure.
          Effect.catchTag('DatabaseError', (failure) => Effect.die(failure)),
        )

      return { find, run }
    }),
  )
