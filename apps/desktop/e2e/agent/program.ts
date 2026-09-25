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
import {
  APPROACH,
  BUILDABLE,
  BUILDABLE_DONE,
  BUILDABLE_SECTIONS,
  BUILD_TASKS,
  COMMAND_PROPOSAL,
  COMMAND_PROPOSE_ANSWER,
  COMPLETE,
  COMPLETED,
  CONTRACT_VERSION,
  EXPORTER,
  FIXED,
  MODEL_OPTION,
  NOTES,
  PROPOSAL,
  PROPOSE,
  READ_ANSWER,
  REWRITE,
  REWRITE_ANSWER,
  REWRITTEN,
  STORY,
  TASK,
  VERIFIED,
  VERSION,
  WRITTEN,
  modelOption,
  turnOf,
} from './script.ts'

// The version is the first thing the machine is asked, and it is asked of the command itself:
// discovery starts it with `--version` before any session exists.
if (process.argv.includes('--version')) {
  process.stdout.write(`${VERSION}\n`)
  process.exit(0)
}

/** How many prompts this process has been sent. */
let turn = 0

/** What the last prompt said: whether this turn reads a file, proposes or writes a Spec. */
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

/** One write of the Spec through Hemera's `spec_write`, under a key of its own. */
function writes(sent: Readonly<Record<string, string | number>>, key: string): FakeStep {
  return { does: 'uses', call: 'spec_write', arguments: { ...sent, key: `${key}-${RUN}` } }
}

/** A section of the type's contract, written over the empty one the Spec was created with. */
function contract(section: string, body: string): FakeStep {
  return writes({ section, body, baseVersion: CONTRACT_VERSION }, section)
}

/** One declaration through Hemera's `spec_propose`, under a key of its own. */
function proposes(sent: Readonly<Record<string, string>>, key: string): FakeStep {
  return { does: 'uses', call: 'spec_propose', arguments: { ...sent, key: `${key}-${RUN}` } }
}

/**
 * The Spec finished, in the order the protocol asks (D7-08): what `shape` owns, then `shape`
 * declared; `plan` written, then declared; the stories and the task, then `decompose` declared;
 * and the contract attested last, on the content it now has. A section written after the phase
 * owning it was declared would make that phase stale again.
 */
const completing: readonly FakeStep[] = [
  contract('expected_outcome', WRITTEN.expected_outcome),
  contract('verification', WRITTEN.verification),
  contract('behaviour', WRITTEN.behaviour),
  proposes({ kind: 'phase_done', phase: 'shape', summary: 'The export fix is shaped.' }, 'shape'),
  writes({ section: 'plan', body: WRITTEN.plan, baseVersion: 0 }, 'plan'),
  proposes({ kind: 'phase_done', phase: 'plan', summary: 'The approach is planned.' }, 'plan'),
  writes({ stories: JSON.stringify([STORY]) }, 'stories'),
  writes({ tasks: JSON.stringify([TASK]) }, 'tasks'),
  proposes(
    { kind: 'phase_done', phase: 'decompose', summary: 'One task covers the story.' },
    'decompose',
  ),
  proposes({ kind: 'ready' }, 'ready'),
]

/** A Spec a build can run, written and attested in the order `completing` follows. */
const buildable: readonly FakeStep[] = [
  ...Object.entries(BUILDABLE_SECTIONS).map(([section, body]) => contract(section, body)),
  proposes({ kind: 'phase_done', phase: 'shape', summary: 'The export is shaped.' }, 'b-shape'),
  writes({ section: 'plan', body: WRITTEN.plan, baseVersion: 0 }, 'b-plan'),
  proposes({ kind: 'phase_done', phase: 'plan', summary: 'The export is planned.' }, 'b-plan'),
  writes({ stories: JSON.stringify([STORY]) }, 'b-stories'),
  writes({ tasks: JSON.stringify(BUILD_TASKS) }, 'b-tasks'),
  proposes(
    { kind: 'phase_done', phase: 'decompose', summary: 'Three tasks, one after the other.' },
    'b-decompose',
  ),
  proposes({ kind: 'ready' }, 'b-ready'),
]

/** The labels of the tasks a build delivery hands, in the order it lists them. */
function handedLabels(handed: string): string[] {
  return [...handed.matchAll(/^## (T\d+) · /gm)].map((match) => match[1] ?? '')
}

/**
 * What the build's agent does with a delivery, chosen from the brief (D10-02 to D10-09): the
 * `prepare` brief is answered with the approach note; an `execute` delivery has every task it
 * hands finished — after writing the exporter in the repository, and the file the check looks
 * for, when the delivery carries a red try; the final checks are answered with a sentence; a
 * resume brief with nothing, the user's task being the one that waits. Any other delivery — a
 * `define` Session's — is taken in silently.
 */
function answerDelivery(handed: string): readonly FakeStep[] {
  if (handed.includes('# Before you continue')) return []
  if (handed.includes('# Phase: prepare')) {
    return [{ does: 'says', text: APPROACH, messageId: `note-${RUN}` }]
  }
  if (handed.includes('# Phase: verify')) {
    return [{ does: 'says', text: VERIFIED, messageId: `verified-${RUN}` }]
  }
  const labels = handedLabels(handed)
  const fixing: FakeStep[] = handed.includes('was red')
    ? [
        {
          does: 'uses',
          call: 'fs_write',
          arguments: { path: EXPORTER.path, content: EXPORTER.content, key: `exporter-${RUN}` },
        },
        {
          does: 'uses',
          call: 'fs_write',
          arguments: { path: FIXED, content: 'fixed\n', key: `fix-${RUN}` },
        },
      ]
    : []
  return [
    ...fixing,
    ...labels.map((label): FakeStep => ({
      does: 'uses',
      call: 'task_finished',
      arguments: { task: label },
    })),
  ]
}

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
  answersDeliveryWith: answerDelivery,
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
    // A prompt that names the proposed command is a proposal through Hemera's own tool, then an
    // answer: the catalogue is the human's to write (D8-11).
    if (asked.includes(COMMAND_PROPOSAL.name)) {
      return [
        { does: 'uses', call: 'commands_propose', arguments: { ...COMMAND_PROPOSAL } },
        { does: 'says', text: COMMAND_PROPOSE_ANSWER, messageId: `propose-${RUN}-${String(turn)}` },
      ]
    }
    if (asked.includes(BUILDABLE)) {
      return [...buildable, { does: 'says', text: BUILDABLE_DONE, messageId: `buildable-${RUN}` }]
    }
    if (asked.includes(COMPLETE)) {
      return [...completing, { does: 'says', text: COMPLETED, messageId: `spec-${RUN}` }]
    }
    if (asked.includes(REWRITE)) {
      return [
        writes(
          { section: 'expected_outcome', body: REWRITTEN, baseVersion: CONTRACT_VERSION + 1 },
          'again',
        ),
        { does: 'says', text: REWRITE_ANSWER, messageId: `again-${RUN}` },
      ]
    }
    const said = turnOf(turn + (continued() ? 1 : 0))
    const id = `${RUN}-${String(turn)}`
    // A thought and an answer, in that order and under two different kinds: the thread folds the
    // first and shows the second, which is the difference the suite reads.
    const answer: FakeStep[] = [
      { does: 'thinks', text: said.thought, messageId: `thought-${id}` },
      { does: 'says', text: said.answer, messageId: `answer-${id}` },
    ]
    // Asked for a Spec, it proposes one after its answer, through the tool.
    if (asked.includes(PROPOSE)) {
      answer.push(
        proposes(
          { kind: 'spec', title: PROPOSAL.title, type: PROPOSAL.type },
          `spec-${String(turn)}`,
        ),
      )
    }
    return answer
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
