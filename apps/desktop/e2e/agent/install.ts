/**
 * The seam the end-to-end suite hands the application an agent through (design D5-16, D5-21).
 *
 * The application has no test mode and no injected adapter: it looks an agent's own command up
 * on the `PATH` the machine has, reads the version that command prints, and looks for the file
 * the agent's own login wrote. That is the seam, and it is the machine's rather than the
 * product's — so the suite answers those three questions with a directory of its own instead of
 * a flag in production code. Nothing under `src/` knows this file exists.
 *
 * Two test seams exist in `src/` all the same, both environment variables read in one place
 * each and never set by the application itself: `HEMERA_E2E_HEADLESS`, which opens the window
 * off screen (`src/main/window-options.ts`), and `HEMERA_E2E_QUALIFIED`, which names the agent
 * this file fakes so that it is qualified to run bare on a platform where the real one is not
 * yet (`bareModeOf` in `src/engine/agents/bare.ts`, which the engine's diagnostic log reports
 * once at start). `wdio.conf.ts` sets the second to `opencode`: without it, every Session the
 * suite opens on Linux would be refused with OpenCode's own reason.
 *
 * OpenCode is the agent it answers for, because it is the one of the three that speaks ACP
 * itself: its command *is* what Hemera starts (`opencode acp`), where the other two are started
 * through an adapter resolved out of Hemera's own `node_modules` and could not be replaced
 * without touching the application.
 *
 * On Windows the command has to be something the operating system will start, and `spawn` refuses
 * a `.cmd` it was not given a shell for: so the command is Node itself, linked under the agent's
 * name, and `opencode acp` is then `node acp` run in the Session's own folder — which is why a
 * workspace made here carries that one file. Everywhere else the command is a script that runs
 * the program and ignores the subcommand.
 */

import { chmodSync, copyFileSync, existsSync, linkSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

/** The program the command runs, which is the peer itself. */
const PROGRAM = join(here, 'program.ts')

/** Where the machine the suite invents lives: one folder, made once and reused by every worker. */
const ROOT = join(tmpdir(), 'hemera-e2e-agent')

/** The directory put in front of the `PATH`, holding the agent's command and nothing else. */
const BIN = join(ROOT, 'bin')

/** What `XDG_DATA_HOME` is set to, which is where the agent keeps the login it wrote. */
const DATA = join(ROOT, 'data')

const windows = process.platform === 'win32'

/** What `opencode acp` is on Windows: Node, under the agent's name, running the file below. */
const ENTRY = 'acp'

/**
 * Puts the agent on this process's `PATH`, and its login where the agent would have written it.
 *
 * Called when the configuration is read — in the launcher and in every worker — because the
 * environment a worker hands the application is the environment it is running in. It is written
 * to be run again: a directory that is there is kept, and the command is linked once.
 */
export function installFakeAgent(): void {
  mkdirSync(BIN, { recursive: true })
  mkdirSync(join(DATA, 'opencode'), { recursive: true })
  // The file the agent's own `auth login` writes. Hemera looks for it and never opens it, which
  // is the whole of what it reads before a Session starts (D5-21).
  writeFileSync(join(DATA, 'opencode', 'auth.json'), '{}\n')
  if (windows) linkNode(join(BIN, 'opencode.exe'))
  else writeLauncher(join(BIN, 'opencode'))

  process.env.XDG_DATA_HOME = DATA
  const path = process.env.PATH ?? ''
  if (!path.split(delimiter).includes(BIN)) process.env.PATH = `${BIN}${delimiter}${path}`
}

/**
 * A folder for a Project to point at, carrying what the command needs to be started in it.
 *
 * A Session runs in the Project's main folder, and that is where the agent's process is started:
 * on Windows the subcommand is read as a file there, so the folder a suite hands a Project is
 * made with that file in it.
 *
 * The path is drawn from the name rather than from `mkdtemp`, for the reason `wdio.conf.ts`
 * spells its data folders out: a folder made on evaluation is a different folder in every
 * worker, and a Session opened again by the instance that comes after has to find the folder it
 * ran in. It is kept after a run, like the directory the command itself lives in: the agent is
 * still running in it when the last spec file ends, and a folder a process is sitting in is a
 * folder Windows will not let anybody remove.
 */
export function fakeWorkspace(name: string): string {
  const folder = join(tmpdir(), `hemera-e2e-workspace-${name}`)
  mkdirSync(folder, { recursive: true })
  writeFileSync(join(folder, ENTRY), entryOf(PROGRAM))
  return folder
}

/** The file Windows reads the subcommand as: the program, started from wherever it was run. */
function entryOf(program: string): string {
  const started = JSON.stringify(pathToFileURL(program).href)
  return `// The agent the end-to-end suite runs, started by name from this folder.\nvoid import(${started})\n`
}

/** Node under the agent's name: a link where the file system allows one, a copy otherwise. */
function linkNode(command: string): void {
  if (existsSync(command)) return
  try {
    linkSync(process.execPath, command)
  } catch {
    // A link across two volumes is refused, and a copy of the binary is the same command.
    copyFileSync(process.execPath, command)
  }
}

/** The command everywhere else: the program, with whatever subcommand it was given. */
function writeLauncher(command: string): void {
  const runs = `${JSON.stringify(process.execPath)} ${JSON.stringify(PROGRAM)}`
  writeFileSync(command, `#!/bin/sh\nexec ${runs} "$@"\n`)
  chmodSync(command, 0o755)
}
