/**
 * A Spec written beside the chat of a `define` Session (designs D7-01, D7-03, D7-07, D7-09,
 * D7-11, D7-12).
 *
 * One journey, in the order a hand makes it, on one data folder: a `free` Session whose agent
 * proposes a Spec, the proposal accepted, the brief that rides the next turn, a human edit, a
 * question asked and answered in the chat, a conflict applied, and a second Session that reads
 * the draft and takes it over. The restart is `specs.reopened.e2e.ts`, which starts a second
 * instance on the folder this one wrote (`wdio.conf.ts`, `CONTINUED`) and finds the draft, its
 * phases and the text left in a buffer.
 *
 * Three acts are not a hand's, and say so where they are made:
 *
 * - The agent's own writes. The fake agent has no Hemera tools before phase 1b: it proposes the
 *   Spec with its marker line (`agent/script.ts`) and writes nothing in it. What it would write —
 *   a section under the human's open editor, a question — goes through the window's own bridge,
 *   as the human actor the renderer always is, which moves the section's version all the same.
 * - The second Session. Nothing in the window lists Specs yet: it is opened on the Spec through
 *   `specs.openSession`, the call such a list would make.
 * - Mark ready. The gate needs every phase declared finished and the agent's attestation, which
 *   only the agent gives (`declarePhase` and `attest` are not on the wire before phase 1b): here
 *   the button is checked absent, and the click is covered by the engine's suites.
 *
 * Each suite is named after the scenario it covers.
 */

import { browser, expect } from '@wdio/globals'

import { fakeWorkspace } from './agent/install.ts'
import { AGENT, ANSWERS, MODELS, PROPOSAL, PROPOSE } from './agent/script.ts'
import {
  addProject,
  awaits,
  control,
  leave,
  press,
  pressIn,
  region,
  shows,
  sidebar,
  textOf,
  typeIn,
  write,
} from './hand.ts'

/** Where the Project points, which is where the agent is started. Kept for the second instance. */
const SOURCES = fakeWorkspace('specs')

/** The Project, whose name gives the Spec key its prefix: `Atlas` is `ATL`. */
const PROJECT = 'Atlas'

/** What the first Session is asked, which is also the title it is listed under. */
const ASKED = `The CSV export drops the date. ${PROPOSE}`

/** The key the Spec is minted with: the Project's prefix, and the first number. */
const KEY = 'ATL-1'

/** What is said once the Session defines the Spec, which is the turn the brief rides. */
const DEFINING = 'Let us shape the export fix.'

/** What the human writes in `Problem`. */
const PROBLEM = 'The CSV export leaves the invoice date column empty.'

/** The question asked in the chat, and the option it is answered with. */
const QUESTION = 'Which date decides the month of an invoice?'
const ISSUE = 'The issue date'

/** `Scope` as the agent rewrites it while the human has it open, twice. */
const THEIRS = 'Only the invoice CSV export.'
const THEIRS_AGAIN = 'The invoice CSV export, in every currency.'

/** The human's `Scope`, refused on the older version and applied on the current one. */
const MINE = 'The invoice and credit note CSV exports.'

/** The text left in a buffer when the application is closed. */
const KEPT = 'Every CSV export of the billing module.'

/** The title a Session opened on a Spec starts with. */
const OPENED = 'New session'

const PANEL = `section[aria-label="Spec ${KEY}"]`

const THREAD = '[aria-label="The thread of this Session"]'

const PROPOSAL_CARD = '[role="group"][aria-label="Create a Spec"]'

const READER_BAR = '[role="group"][aria-label="Write right"]'

/** The Session of this title and the Spec it defines, as the engine answers them. */
async function sessionOf(title: string): Promise<{ id: string; specId: string | null }> {
  return await browser.execute(
    async (project: string, named: string) => {
      const projects = await window.hemera.invoke('projects.list', {})
      const projectId = projects.find((one) => one.name === project)?.id ?? ''
      const sessions = await window.hemera.invoke('sessions.list', { projectId })
      const session = sessions.find((one) => one.title === named)
      return { id: session?.id ?? '', specId: session?.specId ?? null }
    },
    PROJECT,
    title,
  )
}

/** A section of the Spec as the engine holds it: its body, its version and who wrote it. */
async function sectionOf(specId: string, name: 'problem' | 'scope') {
  return await browser.execute(
    async (spec: string, section: string) => {
      const read = await window.hemera.invoke('specs.read', { specId: spec })
      const found = read.sections.find((one) => one.name === section)
      return { body: found?.body ?? '', version: found?.version ?? 0, author: found?.author ?? '' }
    },
    specId,
    name,
  )
}

/**
 * Writes `Scope` as the agent would, through the window's bridge, on the version it is at: what
 * lands under a human editor that was opened on the version before.
 */
async function rewriteScope(specId: string, sessionId: string, body: string): Promise<void> {
  const { version } = await sectionOf(specId, 'scope')
  await browser.execute(
    async (spec: string, session: string, text: string, base: number) => {
      await window.hemera.invoke('specs.writeSection', {
        specId: spec,
        sessionId: session,
        name: 'scope',
        body: text,
        baseVersion: base,
      })
    },
    specId,
    sessionId,
    body,
    version,
  )
  await browser.pause(1200)
}

/** How many times the thread says this. */
async function timesInThread(text: string): Promise<number> {
  return (await region(THREAD)).split(text).length - 1
}

describe('A free Session’s agent proposes a Spec, and Create makes the Session define', () => {
  it('shows the proposal in the thread, with nothing of a Spec beside it yet', async () => {
    await addProject(PROJECT, SOURCES)
    await press('Choose an agent')
    await press(AGENT)
    await awaits(MODELS[0].name)
    await browser.keys(['\uE00C'])
    await browser.pause(300)
    await write(ASKED)
    await press('Start chat')
    await awaits(ANSWERS[0])
    await awaits('Create the Spec')

    // The marker line is Hemera's and never the reader's: the message is written without it.
    expect(await region(THREAD)).not.toContain('hemera:propose-spec')
    expect(await region(PROPOSAL_CARD)).toContain('feature')
    // A `free` Session has no panel, and nothing that offers one but the proposal.
    expect(await region('section[aria-label^="Spec "]')).toBe('')
    expect(await control('Create a Spec')).toBeNull()
    expect(await control('Join a Spec')).toBeNull()
  })

  it('creates the Spec with its key, opens the panel and keeps the thread', async () => {
    await pressIn(PROPOSAL_CARD, 'Create')
    await awaits(`Created ${KEY}`)
    await browser.waitUntil(async () => (await region(PANEL)) !== '', {
      timeout: 10_000,
      timeoutMsg: 'the Spec panel never opened',
    })

    const panel = await region(PANEL)
    expect(panel).toContain(KEY)
    expect(panel).toContain(PROPOSAL.title)
    expect(panel).toContain('draft')
    expect(panel).toContain('Shape · the agent is writing the problem')
    // The head says what the Session is for, its agent, and the Spec it defines.
    expect(await shows(`DEFINE · opencode`)).toBe(true)
    expect(await shows(`· ${KEY}`)).toBe(true)
    expect(await region(THREAD)).toContain(ANSWERS[0])
    const { specId } = await sessionOf(ASKED)
    expect(specId).not.toBeNull()
  })
})

describe('The brief is part of the turn, never a human message', () => {
  it('folds a mission brief titled with the phase in focus above the answer', async () => {
    await write(DEFINING)
    await press('Send')
    await awaits('Mission brief · shape')
    await awaits(ANSWERS[1])

    // The sentence was written once, as the user's; the brief is Hemera's, and folded.
    expect(await timesInThread(DEFINING)).toBe(1)
    expect(await region(THREAD)).not.toContain('# The Spec')
  })
})

describe('A human edit is recorded and reaches the agent', () => {
  it('writes Problem from the panel with human provenance', async () => {
    await typeIn('Problem', PROBLEM)
    await leave('Problem')

    const { specId } = await sessionOf(ASKED)
    const problem = await sectionOf(specId ?? '', 'problem')
    expect(problem).toEqual({ body: PROBLEM, version: 2, author: 'human' })
    expect(await textOf('Problem')).toBe(PROBLEM)
    // The sentence moves on to the next section left to write.
    expect(await region(PANEL)).toContain('Shape · the agent is writing the expected outcome')
  })

  it('lists the edit in the brief of the next turn', async () => {
    await write('Is the problem clear now?')
    await press('Send')
    await browser.waitUntil(async () => (await timesInThread('Mission brief · shape')) === 2, {
      timeout: 20_000,
      interval: 200,
      timeoutMsg: 'the second brief never came',
    })
    await browser.pause(1500)
    // The last brief, opened: what the agent was handed this turn.
    await browser.execute(() => {
      const briefs = [...document.querySelectorAll('button')].filter((one) =>
        (one.textContent ?? '').includes('Mission brief · shape'),
      )
      briefs.at(-1)?.click()
    })
    await browser.pause(700)
    const thread = await region(THREAD)
    expect(thread).toContain('Human edits since your last turn')
    expect(thread).toContain(PROBLEM)
  })
})

describe('A question is asked and answered in the chat', () => {
  it('asks it as a block of the thread, and the register links to it', async () => {
    const { id, specId } = await sessionOf(ASKED)
    await browser.execute(
      async (spec: string, session: string, body: string, issue: string) => {
        await window.hemera.invoke('specs.raiseQuestion', {
          specId: spec,
          sessionId: session,
          body,
          blocking: true,
          phase: 'shape',
          options: [
            { id: 'issue', label: issue, recommended: true },
            { id: 'payment', label: 'The payment date' },
          ],
        })
      },
      specId ?? '',
      id,
      QUESTION,
      ISSUE,
    )
    await awaits(QUESTION)
    await browser.pause(800)

    const panel = await region(PANEL)
    expect(panel).toContain('Questions · 1 open')
    expect(panel).toContain('Shape · waiting for your answer')

    await pressIn(PANEL, 'Answer in the chat')
    await browser.pause(500)
    // The thread is taken to the question, and the keyboard to its first answer.
    const focused = await browser.execute(
      () => document.activeElement?.closest('[id^="ask-"]')?.textContent ?? '',
    )
    expect(focused).toContain(QUESTION)
  })

  it('answers it in the block, which folds to the answer, and resolves it in the register', async () => {
    await pressIn('[id^="ask-"]', ISSUE)
    await browser.pause(1200)

    const block = await region('[id^="ask-"]')
    expect(block).toContain(ISSUE)
    expect(block).not.toContain('The payment date')
    const panel = await region(PANEL)
    expect(panel).toContain('Questions · 0 open')
    expect(panel).toContain('1 answered')
    // The answer is an entry of its own, the human's, beside the question.
    const { id } = await sessionOf(ASKED)
    const answers = await browser.execute(async (sessionId: string) => {
      const read = await window.hemera.invoke('sessions.read', { sessionId })
      return read.entries
        .filter((entry) => entry.kind === 'spec_answer')
        .map((entry) => `${entry.role}: ${entry.body}`)
    }, id)
    expect(answers).toEqual([`user: ${ISSUE}`])
  })
})

describe('A conflict keeps the human’s text', () => {
  it('refuses a save on a section written since it was opened, and keeps the text', async () => {
    const { id, specId } = await sessionOf(ASKED)
    await typeIn('Scope', MINE)
    await rewriteScope(specId ?? '', id, THEIRS)
    await leave('Scope')

    const scope = await sectionOf(specId ?? '', 'scope')
    expect(scope.body).toBe(THEIRS)
    expect(await region(PANEL)).toContain(
      `Your text was written on v1; the section is at v${String(scope.version)}.`,
    )
    expect(await textOf('Scope, your text')).toBe(MINE)

    await pressIn(PANEL, 'Compare')
    expect(await region(PANEL)).toContain(THEIRS)
  })

  it('applies the kept text on the current version, and the banner goes', async () => {
    await pressIn(PANEL, 'Apply mine on v')
    await browser.pause(1200)

    const { specId } = await sessionOf(ASKED)
    const scope = await sectionOf(specId ?? '', 'scope')
    expect(scope).toEqual({ body: MINE, version: 3, author: 'human' })
    expect(await region(PANEL)).not.toContain('Your text was written on')
    expect(await textOf('Scope')).toBe(MINE)
  })
})

describe('A second Session reads but does not write', () => {
  it('reads the draft another Session writes, and is told which one', async () => {
    const { specId } = await sessionOf(ASKED)
    await browser.execute(async (spec: string) => {
      await window.hemera.invoke('specs.openSession', { specId: spec, provider: 'opencode' })
    }, specId ?? '')
    await browser.waitUntil(async () => (await sidebar()).includes(OPENED), {
      timeout: 10_000,
      timeoutMsg: 'the Session opened on the Spec is never listed',
    })

    await press(OPENED)
    await browser.waitUntil(async () => (await region(READER_BAR)) !== '', {
      timeout: 10_000,
      timeoutMsg: 'the reader bar never showed',
    })
    expect(await region(READER_BAR)).toContain(`« ${ASKED} »`)
    expect(await region(PANEL)).toContain(PROBLEM)
    expect(await shows(`DEFINE · opencode`)).toBe(true)
  })

  it('takes the write right over, and the first Session reads from then on', async () => {
    await pressIn(READER_BAR, 'Take over')
    await browser.pause(1200)
    expect(await region(READER_BAR)).toBe('')

    const { id, specId } = await sessionOf(OPENED)
    const writer = await browser.execute(async (spec: string) => {
      const read = await window.hemera.invoke('specs.read', { specId: spec })
      return read.spec.writerSessionId
    }, specId ?? '')
    expect(writer).toBe(id)

    // The first Session, revisited, is the reader now. Its agent's writes are refused by the
    // engine (`writable`, tested there): the renderer writes as the human only, whose edits
    // pass from any Session's panel (D7-11).
    await press(ASKED)
    await browser.waitUntil(async () => (await region(READER_BAR)) !== '', {
      timeout: 10_000,
      timeoutMsg: 'the first Session never read',
    })
    expect(await region(READER_BAR)).toContain(`« ${OPENED} »`)
  })
})

describe('Mark ready is offered only once the checks pass', () => {
  it('names what is left, the attestation among it, and offers no Mark ready', async () => {
    const panel = await region(PANEL)
    expect(panel).toContain('before ready')
    expect(await control('Mark ready')).toBeNull()
  })
})

describe('A conflict keeps the human’s text across a relaunch', () => {
  it('keeps a text refused on its way, for the next start to find', async () => {
    const { id, specId } = await sessionOf(OPENED)
    await typeIn('Scope', KEPT)
    await rewriteScope(specId ?? '', id, THEIRS_AGAIN)
    await leave('Scope')

    expect(await region(PANEL)).toContain('Your text was written on v3; the section is at v4.')
    expect(await textOf('Scope, your text')).toBe(KEPT)
  })
})
