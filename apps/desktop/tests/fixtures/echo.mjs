/**
 * A stand-in for an agent, shipped with the tests only: it answers each line of its input.
 *
 *   <text>            the same line back on its output
 *   pieces <text>     the text back as one line written in two pieces, a moment apart
 *   complain <text>   the text on its error output
 *   exit <code>       ends with that code
 */

import { createInterface } from 'node:readline'

for await (const line of createInterface({ input: process.stdin })) {
  const [command, ...words] = line.split(' ')
  const text = words.join(' ')
  if (command === 'pieces') {
    process.stdout.write(text.slice(0, 3))
    await new Promise((resolve) => setTimeout(resolve, 20))
    process.stdout.write(`${text.slice(3)}\n`)
  } else if (command === 'complain') {
    process.stderr.write(`${text}\n`)
  } else if (command === 'exit') {
    process.exit(Number(text))
  } else {
    process.stdout.write(`${line}\n`)
  }
}
