/**
 * A Spec written beside the chat of a `define` Session (designs D7-01, D7-03, D7-07, D7-09,
 * D7-11, D7-14; issue #135).
 *
 * One journey, in the order a hand makes it, on one data folder: a `free` Session whose agent
 * proposes a Spec through `spec_propose`, the proposal accepted, the brief handed over before the
 * next turn, the Spec read in the panel with nothing to edit, a question asked and answered in the
 * chat, and a second Session that reads the draft and takes it over. The restart is
 * `specs.reopened.e2e.ts`, which starts a second instance on the folder this one wrote
 * (`wdio.conf.ts`, `CONTINUED`), finds the draft and its phases, and takes the Spec to `ready`.
 *
 * Two acts are not a hand's, and say so where they are made:
 *
 * - Some of the agent's writes. The fake agent follows a script fixed when its turn starts and
 *   writes neither `Problem` nor `Scope`: those, and the question, go through the window's own
 *   bridge. What it writes on its own, through `spec_write`, is `specs.reopened.e2e.ts`'s.
 * - The second Session. Nothing in the window lists Specs yet: it is opened on the Spec through
 *   `specs.openSession`, the call such a list would make.
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
  press,
  pressIn,
  region,
  showPart,
  shows,
  sidebar,
  unfoldSpec,
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

/** What `Problem` and `Scope` are written with, through the bridge. */
const PROBLEM = 'The CSV export leaves the invoice date column empty.'
const SCOPE = 'The invoice and credit note CSV exports.'

/** The question asked in the chat, and the option it is answered with. */
const QUESTION = 'Which date decides the month of an invoice?'
const ISSUE = 'The issue date'

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

/** Writes a section through the window's bridge, on the version it is at. */
async function writeThrough(
  specId: string,
  sessionId: string,
  name: 'problem' | 'scope',
  body: string,
): Promise<void> {
  const { version } = await sectionOf(specId, name)
  await browser.execute(
    async (
      spec: string,
      session: string,
      section: 'problem' | 'scope',
      text: string,
      base: number,
    ) => {
      await window.hemera.invoke('specs.writeSection', {
        specId: spec,
        sessionId: session,
        name: section,
        body: text,
        baseVersion: base,
      })
    },
    specId,
    sessionId,
    name,
    body,
    version,
  )
  await browser.pause(1200)
}

/** How many editable fields the panel holds. */
async function fieldsIn(scope: string): Promise<number> {
  return await browser.execute(
    (selector: string) =>
      document
        .querySelector(selector)
        ?.querySelectorAll('textarea, input, [contenteditable="true"]').length ?? 0,
    scope,
  )
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

    // The agent proposed through Hemera's `spec_propose`: a Hemera call of the thread, wearing
    // the tool's own mark, and the proposal below it.
    const proposed = await browser.execute(
      (thread: string) =>
        document.querySelector(thread)?.querySelector('[data-mark="propose-spec"]') !== null,
      THREAD,
    )
    expect(proposed).toBe(true)
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
    // It opens folded to its band beside the chat: the hand unfolds it to read it.
    await unfoldSpec(KEY)

    const panel = await region(PANEL)
    expect(panel).toContain(KEY)
    expect(panel).toContain(PROPOSAL.title)
    expect(panel).toContain('draft')
    // No sentence of the phase under the head: the rail says where each part stands (#150).
    expect(panel).not.toContain('Shape ·')
    // The head names the Project alone (issue #149): the mission is the panel beside the chat,
    // and the agent is the composer's.
    expect(await shows(`DEFINE · opencode`)).toBe(false)
    expect(await region(THREAD)).toContain(ANSWERS[0])
    const { specId } = await sessionOf(ASKED)
    expect(specId).not.toBeNull()
  })
})

describe('The brief is part of the turn, never a human message', () => {
  it('folds a mission brief titled with the phase in focus above the answer', async () => {
    await write(DEFINING)
    await press('Send')
    await awaits('What the agent was told · Shape')
    await awaits(ANSWERS[1])

    // The sentence was written once, as the user's; the brief is Hemera's, and folded.
    expect(await timesInThread(DEFINING)).toBe(1)
    expect(await region(THREAD)).not.toContain('# The Spec')
  })
})

describe('The Spec is read, never edited by hand', () => {
  it('draws what is written as text, and offers nothing to type in', async () => {
    const { id, specId } = await sessionOf(ASKED)
    await writeThrough(specId ?? '', id, 'problem', PROBLEM)
    await writeThrough(specId ?? '', id, 'scope', SCOPE)
    await showPart(KEY, 'Problem')

    expect(await region(PANEL)).toContain(PROBLEM)
    expect(await fieldsIn(PANEL)).toBe(0)
    expect(await control(`Preview Problem as Markdown`)).toBeNull()
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
    await showPart(KEY, 'Questions')

    const panel = await region(PANEL)
    expect(panel).toContain('Questions · 1 open')

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
    await browser.waitUntil(async () => (await region(PANEL)) !== '', {
      timeout: 10_000,
      timeoutMsg: 'the Spec panel of the second Session never showed',
    })
    await unfoldSpec(KEY)
    await browser.waitUntil(async () => (await region(READER_BAR)) !== '', {
      timeout: 10_000,
      timeoutMsg: 'the reader bar never showed',
    })
    expect(await region(READER_BAR)).toContain(`« ${ASKED} »`)
    expect(await region(PANEL)).toContain(PROBLEM)
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
    // engine (`writable`, tested there).
    await press(ASKED)
    await browser.waitUntil(async () => (await region(PANEL)) !== '', {
      timeout: 10_000,
      timeoutMsg: 'the Spec panel of the first Session never showed again',
    })
    await unfoldSpec(KEY)
    await browser.waitUntil(async () => (await region(READER_BAR)) !== '', {
      timeout: 10_000,
      timeoutMsg: 'the first Session never read',
    })
    expect(await region(READER_BAR)).toContain(`« ${OPENED} »`)
  })
})

describe('Mark ready is refused with what is left', () => {
  it('is offered on the draft, and refused with what it still lacks', async () => {
    // No readiness is drawn (issue #135): the press is offered, and the refusal says the rest.
    expect(await region(PANEL)).not.toContain('checks met')
    await pressIn(PANEL, 'Mark ready')
    await browser.pause(1200)

    expect(await region(PANEL)).toContain(`${KEY} is not ready yet. Still to do:`)
    const { specId } = await sessionOf(ASKED)
    const status = await browser.execute(async (spec: string) => {
      const read = await window.hemera.invoke('specs.read', { specId: spec })
      return read.spec.status
    }, specId ?? '')
    expect(status).toBe('draft')
  })
})
