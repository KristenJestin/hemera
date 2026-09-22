/**
 * The agent, as a program on this machine (design D5-16, D5-21).
 *
 * `fake.ts` is a real ACP peer the engine's own suites talk to through a pair of in-memory
 * streams. The end-to-end suite drives the built application, and the application starts an
 * agent the way it starts any other: a command found on the `PATH`, spoken to over standard
 * input and standard output. So this is the same peer, with its two pipes tied to the two the
 * operating system gives a process — which is the whole of the program.
 *
 * Nothing of the application knows this exists: `install.ts` puts it on the `PATH` under the
 * agent's own name, and the engine finds a command there exactly as it would find a real one.
 *
 * What it answers is the script, and the script depends on which turn this is: the first prompt
 * of a Session and the one sent after the window was opened again are answered differently, so
 * that a thread which carried on can be told from a thread that was replayed.
 */

import { Readable, Writable } from 'node:stream'

import { fakeAgent, type FakeScript, type FakeStep } from '../../src/engine/agents/fake.ts'
import { MODEL_OPTION, VERSION, turnOf } from './script.ts'

// The version is the first thing the machine is asked, and it is asked of the command itself:
// discovery starts it with `--version` before any session exists.
if (process.argv.includes('--version')) {
  process.stdout.write(`${VERSION}\n`)
  process.exit(0)
}

/** How many prompts this process has been sent, which is what decides what it answers. */
let turn = 0

const script: FakeScript = {
  // It can be loaded as well as resumed: the two ways back into a session are both offered, and
  // which one Hemera takes is Hemera's business (D5-07).
  continues: true,
  configOptions: [MODEL_OPTION],
  onPrompt: () => {
    turn += 1
  },
  get steps(): readonly FakeStep[] {
    const said = turnOf(turn)
    // A thought and an answer, in that order and under two different kinds: the thread folds the
    // first and shows the second, which is the difference the suite reads.
    return [
      { does: 'thinks', text: said.thought, messageId: `thought-${String(turn)}` },
      { does: 'says', text: said.answer, messageId: `answer-${String(turn)}` },
    ]
  },
}

const agent = fakeAgent(script)

// The client's lines in, the agent's lines out. A standard input that ends is a client that is
// gone, and a process whose client is gone has nothing left to answer.
void Readable.toWeb(process.stdin)
  .pipeTo(agent.streams.output)
  .catch(() => undefined)
  .finally(() => {
    process.exit(0)
  })
void agent.streams.input.pipeTo(Writable.toWeb(process.stdout)).catch(() => undefined)
