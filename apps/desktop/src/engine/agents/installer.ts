/**
 * The tool an agent was installed with, and what that tool can be asked (design D5-18).
 *
 * An agent reaches a machine as a global package before it is a command, and the tool that put
 * it there is the only one that can move it: `npm install -g`, `pnpm add -g`, `bun add -g` and
 * `brew upgrade` are four ways to replace the same binary and none of them stands in for
 * another. So the tool is read off the path the machine resolved the command to — never guessed
 * from the command's name, which says nothing about where it came from — and a command from
 * anywhere else reads as `unknown`, which is an answer rather than a failure: Hemera does not
 * offer to update what it cannot place.
 *
 * The two things that need the tool are behind ports. One leaves the machine to read a
 * registry, the other runs a command that changes it, and neither belongs in a test. What is
 * left here — reading a path — is pure, which is where the tests are.
 */

import { Context, Effect, Layer } from 'effect'
import { execFile } from 'node:child_process'
import { z } from 'zod'

import type { InstallerTool } from '@hemera/ipc'

import type { AgentAdapter } from './adapter.ts'
import { MachineEnvironment } from './discovery.ts'

/** How long a registry is given before its silence is taken as one that publishes nothing. */
const REGISTRY_TIMEOUT_MS = 5_000

/** How long an update is given before it is reported as one that never finished. */
const UPDATE_TIMEOUT_MS = 10 * 60 * 1_000

/**
 * How much of an update's output is kept.
 *
 * A package manager writes a progress line per package, and a global install of one package can
 * still print a great deal; what is shown is the tail of it either way, so the whole of a very
 * long run is not worth holding in memory.
 */
const UPDATE_OUTPUT_LIMIT = 8 * 1024 * 1024

/**
 * The command that updates an agent, as the tool that installed it spells it.
 *
 * The package is named by the adapter rather than derived from the command, because the two are
 * not the same string for one of the three agents — the command is `opencode`, the package is
 * `opencode-ai`. Homebrew is the other way round: it knows the command's name as a formula, and
 * it knows nothing of the npm package that shares its name.
 */
export function updateCommandFor(
  adapter: AgentAdapter,
  installer: InstallerTool,
): readonly [string, readonly string[]] | null {
  if (installer === 'npm') return ['npm', ['install', '--global', adapter.package]]
  if (installer === 'pnpm') return ['pnpm', ['add', '--global', adapter.package]]
  if (installer === 'bun') return ['bun', ['add', '--global', adapter.package]]
  if (installer === 'brew') return ['brew', ['upgrade', adapter.command]]
  return null
}

/** What a registry answers with, once it has answered at all. */
export interface AgentRegistryService {
  /** The latest published version, or null when this tool publishes none for that agent. */
  readonly latest: (adapter: AgentAdapter, installer: InstallerTool) => Effect.Effect<string | null>
}

export class AgentRegistry extends Context.Service<AgentRegistry, AgentRegistryService>()(
  'AgentRegistry',
) {}

/** What an update printed, and the version the command reports once it is over. */
export interface AgentUpdateRun {
  readonly output: string
  readonly version: string | null
}

export interface AgentUpdaterService {
  readonly run: (adapter: AgentAdapter, installer: InstallerTool) => Effect.Effect<AgentUpdateRun>
}

export class AgentUpdater extends Context.Service<AgentUpdater, AgentUpdaterService>()(
  'AgentUpdater',
) {}

/** An npm package's entry in the npm registry, with the slash of a scope escaped. */
function npmAddress(packageName: string): string {
  return `https://registry.npmjs.org/${packageName.replace('/', '%2F')}/latest`
}

/** A formula's entry in Homebrew's own catalogue. */
function formulaAddress(command: string): string {
  return `https://formulae.brew.sh/api/formula/${command}.json`
}

const npmEntry = z.object({ version: z.string() })
const formulaEntry = z.object({ versions: z.object({ stable: z.string() }) })

/**
 * One registry read, as a version or as nothing.
 *
 * Every way this can fail is the same answer — the machine is offline, the registry is down, the
 * package is not published there — and the section draws all three the same way: the version is
 * not known, so no update is offered. A refusal reported as an error would put a red line under
 * an agent that is installed and working, for a network the user did not ask about.
 */
function readVersion(address: string, read: z.ZodType<string>): Promise<string | null> {
  return fetch(address, { signal: AbortSignal.timeout(REGISTRY_TIMEOUT_MS) })
    .then((answer) => (answer.ok ? answer.json() : undefined))
    .then((body) => {
      const version = read.safeParse(body)
      return version.success ? version.data : null
    })
    .catch(() => null)
}

/**
 * One command, run to its end, with everything it printed.
 *
 * A failure is not thrown: a package manager that refused says why in its own output, and that
 * output is what the reader is shown under the button. The exit code is not kept because
 * nothing is done with it — the version the command reports afterwards is what says whether it
 * worked, and it is read the same way whether the tool exited zero or not.
 */
function runCommand(command: string, args: readonly string[]): Promise<string> {
  return new Promise((settle) => {
    execFile(
      command,
      [...args],
      // On Windows `npm` and `pnpm` are `.cmd` shims, which only the command interpreter runs:
      // without it the update is refused with `ENOENT` before the tool is even reached. The
      // arguments are this file's own — a tool and a package name — never anything typed.
      {
        timeout: UPDATE_TIMEOUT_MS,
        maxBuffer: UPDATE_OUTPUT_LIMIT,
        shell: process.platform === 'win32',
        windowsHide: true,
      },
      (failure, stdout, stderr) => {
        const printed = [stdout, stderr]
          .filter((part) => part !== '')
          .join('\n')
          .trim()
        if (printed !== '') return settle(printed)
        settle(failure === null ? 'The command said nothing.' : failure.message)
      },
    )
  })
}

/** The registry of the machine this application runs on, as the two catalogues it reads. */
export const registryLayer = Layer.succeed(AgentRegistry, {
  latest: (adapter, installer) => {
    if (installer === 'npm' || installer === 'pnpm' || installer === 'bun') {
      return Effect.promise(() =>
        readVersion(
          npmAddress(adapter.package),
          npmEntry.transform((entry) => entry.version),
        ),
      )
    }
    if (installer === 'brew') {
      return Effect.promise(() =>
        readVersion(
          formulaAddress(adapter.command),
          formulaEntry.transform((entry) => entry.versions.stable),
        ),
      )
    }
    return Effect.succeed(null)
  },
})

/**
 * The tool that updates an agent, as the command it runs on this machine.
 *
 * The version is read back through `MachineEnvironment` rather than out of the command's output:
 * the tools do not agree on what they print, and asking the command what it is now is the same
 * question the section asked when it was opened. That is also why a run that failed still
 * answers a version — the one it was already at.
 */
export const updaterLayer = Layer.effect(
  AgentUpdater,
  Effect.gen(function* () {
    const machine = yield* MachineEnvironment

    return {
      run: (adapter, installer) =>
        Effect.gen(function* () {
          const update = updateCommandFor(adapter, installer)
          if (update === null) {
            return {
              output: `Hemera did not install ${adapter.label} and cannot place the command it runs, so it will not update it.`,
              version: null,
            }
          }
          const output = yield* Effect.promise(() => runCommand(update[0], update[1]))
          const printed = yield* machine.readVersion(adapter.command)
          const version = printed === undefined ? undefined : adapter.readVersion(printed)
          return { output, version: version ?? null }
        }),
    } satisfies AgentUpdaterService
  }),
)
