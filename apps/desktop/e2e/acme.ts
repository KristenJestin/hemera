/**
 * Acme on the disk, for the suites about a Project's settings: a folder that is not a repository,
 * holding two repositories Hemera finds (`api`, with a remote on the same disk and a `dev`
 * branch, and `web`) and one it does not (`services/billing`, a level too deep), with two small
 * programs at its root: a service that prints its address, and a greeting run at each opening.
 * Nothing here reaches a network.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Under the temporary directory, removed by the headless run before and after it. */
export const WORK = join(tmpdir(), 'hemera-e2e-project-settings-work')
export const ACME = join(WORK, 'acme')

/** Runs the machine's own `git`, with a plain, unsigned identity whatever its configuration. */
function git(cwd: string, ...args: string[]): void {
  execFileSync(
    'git',
    ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args],
    { cwd, stdio: 'ignore' },
  )
}

function repository(path: string): void {
  mkdirSync(path, { recursive: true })
  git(path, 'init', '-q', '-b', 'main')
  git(path, 'commit', '-q', '--allow-empty', '-m', 'base')
}

/**
 * A web server on a free port of this machine that prints its address the way a dev server does,
 * and ends on its own after two minutes, so a run cut short leaves nothing behind for long.
 */
const SERVICE = `import { createServer } from 'node:http'

const server = createServer((_, response) => response.end('Acme'))
server.listen(0, '127.0.0.1', () => {
  console.log('Local: http://127.0.0.1:' + server.address().port + '/')
})
setTimeout(() => process.exit(0), 120_000)
`

const GREETING = `console.log('Hello from Acme')
`

/** Makes Acme once; the suite that starts Hemera again finds it as the first one left it. */
export function writeAcme(): void {
  if (existsSync(ACME)) return
  const api = join(ACME, 'api')
  repository(api)
  git(api, 'branch', 'dev')
  const bare = join(WORK, 'api.git')
  mkdirSync(bare, { recursive: true })
  git(bare, 'init', '-q', '--bare')
  git(api, 'remote', 'add', 'origin', bare)
  git(api, 'push', '-q', 'origin', '--all')
  repository(join(ACME, 'web'))
  repository(join(ACME, 'services', 'billing'))
  writeFileSync(join(ACME, 'service.mjs'), SERVICE)
  writeFileSync(join(ACME, 'greet.mjs'), GREETING)
}
