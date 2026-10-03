/**
 * A stand-in for `git`, shipped with the tests only, run as `node git-stub.mjs -C <folder> ...`.
 *
 *   flood          prints more than Hemera reads of one answer
 *   environment    prints the value of GIT_TERMINAL_PROMPT it was given
 *   anything else  never answers: it stands in the folder, writes its process id to
 *                  `<folder>/git-stub.pid`, and waits forever
 */

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [flag, folder, ...args] = process.argv.slice(2)
if (flag !== '-C' || folder === undefined) process.exit(2)

if (args[0] === 'flood') {
  const chunk = 'x'.repeat(1024 * 1024)
  for (let written = 0; written < 40; written += 1) process.stdout.write(chunk)
} else if (args[0] === 'environment') {
  process.stdout.write(process.env.GIT_TERMINAL_PROMPT ?? '(unset)')
} else {
  process.chdir(folder)
  writeFileSync(join(folder, 'git-stub.pid'), String(process.pid))
  setInterval(() => {}, 1000)
}
