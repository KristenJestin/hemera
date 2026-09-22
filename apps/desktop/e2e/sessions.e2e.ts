/**
 * A Session with an agent in it, from the Home that makes one to the thread put away and given
 * back (issue #17, designs D5-11, D5-13, D5-16, D5-17).
 *
 * A Session is made from the Home's composer with the agent it will run chosen at the end of the
 * box: there is no keystroke that makes an empty one any more, and there is no Session without an
 * agent to answer in it. So everything here is done the way a hand does it — the menu, the model
 * the agent published, the box, the send — and read back from what the window shows.
 *
 * The agent is a real ACP peer on this machine's `PATH`, put there by `agent/install.ts` and
 * scripted in `agent/script.ts`: no account with a provider is involved, which is what the issue
 * requires of every automated verification (D5-16).
 *
 * Each suite is named after the scenario it covers — the issue's `Spec · agent-runtime` and
 * `Spec · sessions` for what an agent brought, the ticket of lot 4b for what archiving already
 * claimed.
 *
 * What is *not* here is a restart of the application: one instance runs per spec file and the
 * service has no way to close it and start it again. It is in `sessions.reopened.e2e.ts`, which
 * starts a second instance on the data folder this one wrote (`wdio.conf.ts`, `CONTINUED`).
 */

import { browser, expect } from '@wdio/globals'

import { fakeWorkspace } from './agent/install.ts'
import { AGENT, ANSWERS, MODELS, THOUGHTS } from './agent/script.ts'
import { addProject, awaits, control, press, shows, strike, write } from './hand.ts'

/**
 * Somewhere for the Project to point at, which is also where the agent is started.
 *
 * Made by the installer rather than here, because a Session runs its agent in the Project's own
 * folder and on Windows the command is started from it (`agent/install.ts`). It is not removed
 * here either: the instance that starts after this one opens the same Session, which has to find
 * the folder it ran in.
 */
const SOURCES = fakeWorkspace('sessions')

/** What is asked of the agent, which is the message the thread opens with. */
const ASKED = 'The CSV export drops the invoice date.'

/** What the Session is called once it has been named, which is how the sidebar is read. */
const NAMED = 'Invoice export'

/** Names the Session whose title field is open, the way the field takes a name. */
async function nameIt(title: string): Promise<void> {
  await browser.execute((said: string) => {
    const field = document.querySelector<HTMLInputElement>(
      'input[aria-label="Title of the Session"]',
    )
    if (field === null) return
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(field, said)
    field.dispatchEvent(new Event('input', { bubbles: true }))
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  }, title)
  await browser.pause(800)
}

describe('A Session cannot start without an agent', () => {
  it('leaves the send off with the reason, and makes nothing', async () => {
    await addProject('Atlas', SOURCES)

    await write('Anything at all.')
    const send = await control('Start chat')
    expect(send?.off).toBe(true)
    expect(send?.said).toBe('Choose an agent first')

    // Nothing was made: the Project still has no Session at all.
    expect(await shows('No Session yet')).toBe(true)
  })
})

describe('A Session opens with the announced models', () => {
  it('offers the agent of this machine, then the models the agent itself published', async () => {
    await press('Choose an agent')
    await press(AGENT)

    // The models are the agent's own answer to the session it was just opened on, which is what
    // starting it was for: nothing here is a list Hemera keeps.
    await awaits(MODELS[0].name)
    expect(await shows(MODELS[1].name)).toBe(true)

    await press(MODELS[1].name)
    await browser.pause(600)
    // The panel closes on the platform's own key, and the trigger says what is set.
    await browser.keys(['\uE00C'])
    await browser.pause(400)
    expect(await shows(MODELS[1].name)).toBe(true)

    // And the send is on now: there is somebody to answer.
    const send = await control('Start chat')
    expect(send?.off).toBe(false)
  })
})

describe('Text arrives as a stream', () => {
  it('lands on the Session with the message written, and the answer as a message', async () => {
    await write(ASKED)
    await press('Start chat')

    // The Session exists and the window is on it before the agent has said anything: the message
    // the engine writes as part of the prompt lands on a thread already on screen (D5-11).
    await awaits(ASKED)

    // Then the answer, which is a message of the thread and not a state of the composer.
    await awaits(ANSWERS[0])
  })
})

describe('A thought folds', () => {
  it('keeps what the agent thought out of the answer until it is asked for', async () => {
    // The line is there and what it holds is not: a thought is folded, and the answer above it
    // is what the reader came for (D5-15).
    expect(await shows('Thought for')).toBe(true)
    expect(await shows(THOUGHTS[0])).toBe(false)

    await press('Thought for')
    await browser.pause(700)
    expect(await shows(THOUGHTS[0])).toBe(true)
  })
})

describe('Création dans un Projet', () => {
  it('is called New session until it is renamed on the spot', async () => {
    // The name a Session is given when nothing has named it, and a field waiting to replace it.
    expect(await shows('New session')).toBe(true)

    await press('Rename')
    await browser.pause(500)
    await nameIt(NAMED)

    expect(await shows(NAMED)).toBe(true)
    expect(await shows('New session')).toBe(false)
  })
})

describe('Agent and model are shown', () => {
  it('says on the Session which agent runs it and which model it is on', async () => {
    // Two values and not one: the agent the Session was made with, which it keeps (D5-06), and
    // the model it is on, which is one of those the agent published.
    expect(await shows('opencode')).toBe(true)
    expect(await shows(MODELS[1].name)).toBe(true)
  })
})

describe('Session archivée puis restaurée', () => {
  it('puts a Session that has been written in away, and gives it back', async () => {
    await press('Archive')
    await browser.pause(1000)

    // Gone from the list, and the window is back on the Home. A message moves what the thread
    // holds and not the Session itself, so archiving after one is not a stale version (D5-11).
    //
    // Read on the sidebar and not on the whole page: the Home's Activity frame carries the lines
    // the Journal wrote, and one of them is the rename — a name in the history of a Project is
    // not a Session in its list.
    expect(await shows('No Session yet')).toBe(true)
    expect(await control(`Archive ${NAMED}`)).toBeNull()

    // Consultable: the palette holds it, and the archive page lists it.
    await strike('k', 'KeyK')
    await browser.pause(500)
    await press('Archived Sessions')
    await browser.pause(900)
    expect(await shows(NAMED)).toBe(true)
    // Nothing was deleted: the way back is the only thing offered.
    expect(await shows('Delete')).toBe(false)

    await press('Restore')
    await browser.pause(1100)
    expect(await shows(NAMED)).toBe(true)

    // And it is back in the sidebar, where the current ones are, which is where the instance
    // that starts after this one finds it.
    await browser.keys(['\uE00C'])
    await browser.pause(400)
    expect(await shows(NAMED)).toBe(true)
  })
})
