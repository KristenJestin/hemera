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

import { randomUUID } from 'node:crypto'
import { Readable, Writable } from 'node:stream'

import {
  fakeAgent,
  type FakeAgent,
  type FakeScript,
  type FakeStep,
} from '../../src/engine/agents/fake.ts'
import { MODEL_OPTION, NOTES, READ_ANSWER, VERSION, modelOption, turnOf } from './script.ts'

// The version is the first thing the machine is asked, and it is asked of the command itself:
// discovery starts it with `--version` before any session exists.
if (process.argv.includes('--version')) {
  process.stdout.write(`${VERSION}\n`)
  process.exit(0)
}

/** How many prompts this process has been sent. */
let turn = 0

/** What the last prompt said, which is what decides whether this turn reads a file. */
let asked = ''

/**
 * The peer, once it is built: the script reads it back to know what has happened to it.
 *
 * A session the agent was handed back — resumed or loaded — is a conversation that was already
 * under way, and what it says next is the next thing it had to say. That is the whole of what a
 * restarted application has to prove, and the agent is the one that knows: the process is new,
 * the session is not.
 */
let peer: FakeAgent | null = null

/** Whether this process was given a session that already existed. */
function continued(): boolean {
  return peer !== null && (peer.answers.resumes > 0 || peer.answers.loads > 0)
}

/**
 * What this process calls the messages it writes.
 *
 * Unique to the process, because Hemera matches an update to an entry of the thread by the id
 * the agent gave it (D5-08): a second run that reused the first run's ids would be updating the
 * messages of the first turn in place rather than writing new ones — which is exactly what the
 * deduplication is for, and not what a new message is.
 */
const RUN = randomUUID().slice(0, 8)

const script: FakeScript = {
  // It can be loaded as well as resumed: the two ways back into a session are both offered, and
  // which one Hemera takes is Hemera's business (D5-07).
  continues: true,
  configOptions: [MODEL_OPTION],
  // What it is on after a choice, which is the only thing that says a choice was taken.
  onChoice: (choice) => [choice.id === MODEL_OPTION.id ? modelOption(choice.value) : MODEL_OPTION],
  // It connects to the MCP server it is handed, as a real agent does, and lists Hemera's tools:
  // the one it calls is chosen by the prompt, after the session was opened (D6-11).
  listsTools: true,
  onPrompt: (text) => {
    turn += 1
    asked = text
  },
  get steps(): readonly FakeStep[] {
    // A prompt that names the notes is a read through Hemera's own tool, then an answer.
    if (asked.includes(NOTES)) {
      return [
        { does: 'uses', call: 'fs_read', arguments: { path: NOTES } },
        { does: 'says', text: READ_ANSWER, messageId: `read-${RUN}-${String(turn)}` },
      ]
    }
    const said = turnOf(turn + (continued() ? 1 : 0))
    const id = `${RUN}-${String(turn)}`
    // A thought and an answer, in that order and under two different kinds: the thread folds the
    // first and shows the second, which is the difference the suite reads.
    return [
      { does: 'thinks', text: said.thought, messageId: `thought-${id}` },
      { does: 'says', text: said.answer, messageId: `answer-${id}` },
    ]
  },
}

const agent = fakeAgent(script)
peer = agent

// The client's lines in, the agent's lines out. A standard input that ends is a client that is
// gone, and a process whose client is gone has nothing left to answer.
void Readable.toWeb(process.stdin)
  .pipeTo(agent.streams.output)
  .catch(() => undefined)
  .finally(() => {
    process.exit(0)
  })
void agent.streams.input.pipeTo(Writable.toWeb(process.stdout)).catch(() => undefined)
