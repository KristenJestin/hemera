/**
 * The compositor the headless run happens in on Linux (not a spec file).
 *
 * `HEMERA_E2E_HEADLESS=1` opens the window off screen, which is a position, and a Wayland
 * compositor places windows itself: on a Linux desktop the window would open on the screen of
 * whoever uses the machine and take its focus. So on Linux the headless run starts a compositor
 * of its own, weston with no output, and the application is started inside it: `DISPLAY` is
 * dropped so nothing reaches the X server of the desktop, and `WAYLAND_DISPLAY` names weston's
 * socket. On Windows, and in CI, the run is what it always was.
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { connect } from 'node:net'
import { join } from 'node:path'

/** The Wayland socket the run's compositor listens on, in `XDG_RUNTIME_DIR`. */
export const COMPOSITOR_SOCKET = 'hemera-e2e'

/** How long weston is given to open its socket. */
const READY_WITHIN = 15_000

/** The compositor command this run starts, or `null` where the run starts none. */
export function compositorOf(
  platform: NodeJS.Platform,
  environment: NodeJS.ProcessEnv,
): readonly string[] | null {
  if (platform !== 'linux' || environment.CI) return null
  return [
    'weston',
    '--backend=headless',
    '--renderer=pixman',
    `--socket=${COMPOSITOR_SOCKET}`,
    '--no-config',
  ]
}

/** The environment the application is started with once the compositor runs. */
export function inCompositor(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const { DISPLAY: _desktop, ...rest } = environment
  return { ...rest, WAYLAND_DISPLAY: COMPOSITOR_SOCKET }
}

/** Whether something answers on the socket at that path. */
function answers(path: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect(path)
    socket.once('connect', () => {
      socket.end()
      resolve(true)
    })
    socket.once('error', () => resolve(false))
  })
}

/** Resolves once `ready` answers true, asking again every 50 ms, or false past the deadline. */
async function until(ready: () => Promise<boolean>, deadline: number): Promise<boolean> {
  if (await ready()) return true
  if (Date.now() > deadline) return false
  await new Promise((resolve) => setTimeout(resolve, 50))
  return await until(ready, deadline)
}

/**
 * Starts the compositor and resolves once its socket answers, with what stops it.
 *
 * It is stopped as well if the launcher leaves without stopping it, so a run that fails does
 * not leave a compositor behind.
 */
export async function startCompositor(command: readonly string[]): Promise<() => Promise<void>> {
  const runtime = process.env.XDG_RUNTIME_DIR
  if (!runtime) throw new Error('the headless run needs XDG_RUNTIME_DIR to start weston')
  const socket = join(runtime, COMPOSITOR_SOCKET)
  const listening = async () => existsSync(socket) && (await answers(socket))
  if (await listening()) throw new Error(`another compositor already listens on ${socket}`)

  const [program = 'weston', ...args] = command
  const compositor = spawn(program, args, { stdio: ['ignore', 'ignore', 'pipe'] })
  let said = ''
  compositor.stderr.on('data', (chunk: Buffer) => (said += chunk.toString()))
  let refused = false
  compositor.on('error', (error) => {
    refused = true
    said += error.message
  })
  const exited = new Promise<void>((resolve) => compositor.once('close', () => resolve()))
  const leaving = () => compositor.kill()
  process.once('exit', leaving)

  const up = async () =>
    compositor.exitCode === null && compositor.signalCode === null && (await listening())
  const ready = await until(
    async () => refused || compositor.exitCode !== null || (await up()),
    Date.now() + READY_WITHIN,
  )
  if (!ready || !(await up())) {
    compositor.kill()
    process.off('exit', leaving)
    const why =
      said.trim().split('\n').slice(-5).join('\n') ||
      (compositor.exitCode === null ? 'no answer in time' : `exited with ${compositor.exitCode}`)
    throw new Error(`weston did not open ${socket}: ${why}`)
  }

  return async () => {
    process.off('exit', leaving)
    if (compositor.exitCode === null) compositor.kill()
    await exited
  }
}
