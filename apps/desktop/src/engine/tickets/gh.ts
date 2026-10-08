/**
 * The user's `gh`, as Hemera's own calls run it (#95). Written apart from the ticket provider so
 * that the forge port (R4) can run it the same way.
 *
 * - `gh` is found on the user's `PATH` (`gh.exe` on Windows); a missing one is said, never
 *   installed.
 * - It runs as a program with an argument array, never through a shell, under the process
 *   supervisor, its standard input closed at once.
 * - It runs with the user's own environment and `gh` configuration, plus `GH_PROMPT_DISABLED`,
 *   `GH_NO_UPDATE_NOTIFIER` and `NO_COLOR`, and `GH_HOST` set to the provider's host. The empty
 *   configuration folder the permissions engine gives agents' commands never applies here. Hemera
 *   never reads, sets or passes a GitHub token.
 * - Every call has a limit, 30 seconds (the read limit of Git calls): a call cut at its limit is
 *   killed, waited for, and reported unreachable.
 * - What it prints on its standard error is masked before it reaches a message.
 */

import { existsSync, statSync } from 'node:fs'
import { delimiter, join } from 'node:path'

import { ProviderCliMissing, ProviderUnreachable } from '@hemera/core/domain'
import { Context, Deferred, Effect, Layer, Option } from 'effect'

import { LIMITS } from '../git.ts'
import { Secrets } from '../secrets.ts'
import { ProcessSupervisor } from '../supervisor.ts'
import { outsideTransaction } from '../transaction.ts'

/** The program run as `gh`, and what goes before its arguments. */
export interface GhProgram {
  readonly command: string
  readonly leading: ReadonlyArray<string>
}

export interface GhSettings {
  /** The `PATH` `gh` is looked for on; the environment's otherwise. */
  readonly path?: string | undefined
  /** The environment `gh` runs in: the engine's own, which is the user's, otherwise. */
  readonly env?: Readonly<Record<string, string | undefined>> | undefined
  /** A program run in place of the `gh` found: the suites' fake. */
  readonly program?: GhProgram | undefined
  /** How long one call may run; 30 seconds otherwise. */
  readonly limitMillis?: number | undefined
}

/** What one call answered: its exit code, and what it printed, its standard error masked. */
export interface GhAnswer {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

/** How much of what `gh` prints is read before the call is cut. */
const OUTPUT_LIMIT = 32 * 1024 * 1024

/** What the user is told when `gh` is not found. */
export const GH_INSTALL = 'Install it from https://cli.github.com, then check again.'

/** The provider a `gh` call speaks for, as its errors name it. */
export const githubLabel = (host: string): string =>
  host === 'github.com' ? 'GitHub' : `GitHub (${host})`

/** The first `name` (`name.exe` on Windows) on a `PATH`, or null. */
export const findOnPath = (
  name: string,
  path: string,
  platform: NodeJS.Platform,
): string | null => {
  const file = platform === 'win32' ? `${name}.exe` : name
  for (const folder of path.split(platform === 'win32' ? ';' : delimiter)) {
    if (folder === '') continue
    const candidate = join(folder, file)
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  }
  return null
}

export class GhCli extends Context.Service<
  GhCli,
  {
    /** The `gh` this engine runs, or none when it is not on the PATH. */
    readonly program: Effect.Effect<Option.Option<GhProgram>>
    /** Runs `gh` with these arguments, for this host. */
    readonly run: (
      host: string,
      args: ReadonlyArray<string>,
    ) => Effect.Effect<GhAnswer, ProviderCliMissing | ProviderUnreachable>
    /** Text with the known secret values masked, for what `gh` answered on its output. */
    readonly mask: (text: string) => string
  }
>()('GhCli') {}

/** `gh` over the process supervisor, with this machine's PATH and environment unless told. */
export const ghCliLayer = (settings: GhSettings = {}) =>
  Layer.effect(
    GhCli,
    Effect.gen(function* () {
      const supervisor = yield* ProcessSupervisor
      const secrets = yield* Secrets
      const env = settings.env ?? process.env
      const limit = settings.limitMillis ?? LIMITS.read
      const program = Effect.sync(() => {
        if (settings.program !== undefined) return Option.some(settings.program)
        const found = findOnPath('gh', settings.path ?? env['PATH'] ?? '', process.platform)
        return found === null ? Option.none() : Option.some({ command: found, leading: [] })
      })

      const run = (host: string, args: ReadonlyArray<string>) =>
        Effect.gen(function* () {
          const label = githubLabel(host)
          const found = yield* program
          if (Option.isNone(found)) {
            return yield* new ProviderCliMissing({
              provider: label,
              program: 'gh',
              fix: GH_INSTALL,
            })
          }
          const environment: Record<string, string> = {}
          for (const [name, value] of Object.entries(env)) {
            if (value !== undefined) environment[name] = value
          }
          Object.assign(environment, {
            GH_HOST: host,
            GH_PROMPT_DISABLED: '1',
            GH_NO_UPDATE_NOTIFIER: '1',
            NO_COLOR: '1',
          })
          const answer = Effect.scoped(
            Effect.gen(function* () {
              const child = yield* supervisor
                .start(found.value.command, [...found.value.leading, ...args], {
                  env: environment,
                  owner: { kind: 'tickets', id: host },
                  graceMillis: 0,
                })
                .pipe(
                  Effect.catchTag('SpawnFailed', (failed) =>
                    Effect.fail(
                      failed.reason.includes('ENOENT')
                        ? new ProviderCliMissing({
                            provider: label,
                            program: 'gh',
                            fix: GH_INSTALL,
                          })
                        : new ProviderUnreachable({
                            provider: label,
                            detail: secrets.mask(failed.reason),
                          }),
                    ),
                  ),
                )
              yield* child.closeInput
              const out: string[] = []
              const err: string[] = []
              let printed = 0
              const outputEnded = yield* Deferred.make<void>()
              const tooLong = yield* Deferred.make<void>()
              child.onStdout(
                (line) => {
                  printed += line.length + 1
                  if (printed > OUTPUT_LIMIT) Deferred.doneUnsafe(tooLong, Effect.void)
                  else out.push(line)
                },
                () => {
                  Deferred.doneUnsafe(outputEnded, Effect.void)
                },
              )
              child.onStderr((line) => err.push(line))
              const ended = Effect.all([child.exited, Deferred.await(outputEnded)])
              const finished = yield* Effect.raceFirst(
                Effect.map(ended, ([exit]) => Option.some(exit)),
                Effect.as(Deferred.await(tooLong), Option.none()),
              ).pipe(Effect.timeoutOption(limit))
              if (Option.isNone(finished) || Option.isNone(finished.value)) {
                // Cut: the tree is taken down and waited for before the call answers.
                yield* child.kill
                yield* child.exited
                return yield* new ProviderUnreachable({
                  provider: label,
                  detail: Option.isNone(finished)
                    ? `gh did not answer within ${String(limit / 1000)} seconds`
                    : 'gh printed more than Hemera reads of one answer',
                })
              }
              return {
                code: finished.value.value.code ?? 1,
                stdout: out.join('\n'),
                stderr: secrets.mask(err.join('\n')),
              } satisfies GhAnswer
            }),
          )
          return yield* outsideTransaction(`run gh ${args[0] ?? ''}`, answer).pipe(
            Effect.catchTag('SideEffectInTransaction', (refused) => Effect.die(refused)),
          )
        })

      return { program, run, mask: secrets.mask }
    }),
  )
