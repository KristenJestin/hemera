/**
 * The hand the end-to-end suites drive the window with.
 *
 * Not a spec file — `wdio.conf.ts` takes `*.e2e.ts` and this is not one — and nothing here
 * asserts anything: it presses, types and reads, and every claim stays in the suite that makes
 * it. What it exists for is that a Project is now a row in a database rather than a fixture, so
 * a suite about the shell has to make one before it can look at a tab, exactly as a hand would.
 */

import { browser, expect } from '@wdio/globals'

/** Presses whatever the page shows under this name, and says so when there is nothing there. */
export async function press(name: string): Promise<void> {
  // Matched on what the button contains rather than on what it is exactly: a tab carries the
  // count of what nobody has seen, and the archive button carries the name of what it puts away
  // — `Archive Invoice export` — so a label is read by what it starts with.
  const pressed = await browser.execute((label: string) => {
    const button = [...document.querySelectorAll('button')].find(
      (one) =>
        (one.textContent ?? '').includes(label) ||
        (one.getAttribute('aria-label') ?? '').startsWith(label),
    )
    if (button === undefined) return false
    button.click()
    return true
  }, name)
  expect(pressed).toBe(true)
  await browser.pause(300)
}

/** Types into the field with this label, the way a hand does: one value, then an input event. */
export async function fill(label: string, value: string): Promise<void> {
  const filled = await browser.execute(
    (name: string, text: string) => {
      // A Dialog first when there is one: it is modal, the page behind it is inert, and both
      // the settings and the creation Dialog have a field called "Name". A hand types into the
      // one in front; a suite that took the first in the document would type into the other.
      const front = document.querySelector('[role="dialog"]')
      const fields = [...(front ?? document).querySelectorAll('input, textarea')]
      const field = fields.find((one) => {
        if (!(one instanceof HTMLInputElement || one instanceof HTMLTextAreaElement)) return false
        const described = one.getAttribute('aria-label') ?? ''
        const labelled = one.labels?.[0]?.textContent?.trim() ?? ''
        return described === name || labelled === name
      })
      if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)) return false

      const setter = Object.getOwnPropertyDescriptor(
        field instanceof HTMLInputElement
          ? HTMLInputElement.prototype
          : HTMLTextAreaElement.prototype,
        'value',
      )?.set
      setter?.call(field, text)
      field.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    },
    label,
    value,
  )
  expect(filled).toBe(true)
  await browser.pause(120)
}

/**
 * Types into the composer, which is a box and not a field.
 *
 * The composer is a `contenteditable`: there is no `value` to set through the platform's own
 * setter, and what it reads is what it is holding. So the text is put in the box the way a
 * sentence ends up in one, and the event a keystroke would have caused is dispatched — the box
 * listens for exactly that and hands the page what it reads.
 */
export async function write(text: string): Promise<void> {
  const wrote = await browser.execute((said: string) => {
    const box = document.querySelector('[role="textbox"][contenteditable]')
    if (!(box instanceof HTMLElement)) return false
    box.replaceChildren(document.createTextNode(said))
    box.dispatchEvent(new InputEvent('input', { bubbles: true }))
    return true
  }, text)
  expect(wrote).toBe(true)
  await browser.pause(120)
}

/**
 * Holds the platform's modifier and strikes a key, as a keystroke on the page.
 *
 * Not through the driver: `browser.keys` types a *character*, and Chromium turns it back into a
 * key through whatever layout the machine is on — on a French one, `,` arrives as `m` and `2`
 * as `é`. What the shortcut table is registered against is `event.key`, so this is the event
 * the application's own listener would see from a keyboard that produces that character. What
 * it leaves out is the layer underneath, which belongs to the system and not to the shell.
 */
export async function strike(key: string, code: string): Promise<void> {
  await browser.execute(
    (struck: string, physical: string) => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: struck,
          code: physical,
          ctrlKey: true,
          bubbles: true,
        }),
      )
    },
    key,
    code,
  )
  await browser.pause(400)
}

/**
 * Opens the settings of the application, the way the only route to them goes.
 *
 * `Mod+,`, and not a button: with no Project there is no sidebar, so there is nothing to press
 * — and a window whose only Project has just been archived is exactly that window. The
 * shortcut is the one the specification gives, and it works whatever is on screen.
 */
export async function openSettings(): Promise<void> {
  await strike(',', 'Comma')
}

/**
 * Rings the bell and answers what it is called, or null when there is no bell to ring.
 *
 * Matched on what the label starts with: the bell says whether anything has gone unseen, and
 * what it is called is what the focus has to come back to when its panel closes.
 */
export async function ringBell(): Promise<string | null> {
  const rung = await browser.execute(() => {
    const bell = document.querySelector('[aria-label^="Notifications"]')
    if (!(bell instanceof HTMLElement)) return null
    bell.focus()
    bell.click()
    return bell.getAttribute('aria-label')
  })
  await browser.pause(400)
  return rung
}

/** Whether the page holds this text anywhere at all. */
export async function shows(text: string): Promise<boolean> {
  return await browser.execute(
    (needle: string) => (document.body.textContent ?? '').includes(needle),
    text,
  )
}

/**
 * What the sidebar says, which is where a Session is named and not the thread it draws.
 *
 * A name is in two places at once — the sidebar lists the Session under it and the page heads the
 * thread with it — so a suite reading the whole page cannot tell which of the two it saw. The
 * sidebar is the one that says how a Session is listed.
 */
export async function sidebar(): Promise<string> {
  return await browser.execute(() => document.querySelector('aside')?.textContent ?? '')
}

/**
 * What the bar lists, in the order it lists them.
 *
 * Read as "does a tab say this", because a tab says more than a name: its tone is a dot and
 * the entries nobody has seen are a count beside it.
 */
export async function tabs(): Promise<string[]> {
  return await browser.execute(() =>
    [...document.querySelectorAll('header nav button')]
      .map((one) => one.textContent?.trim() ?? '')
      .filter((name) => name !== ''),
  )
}

/** What the tab marked as the page one is on says, which is the Project in front. */
export async function active(): Promise<string> {
  return await browser.execute(
    () => document.querySelector('header [aria-current="page"]')?.textContent?.trim() ?? '',
  )
}

/** Whether the bar has a tab for a Project of this name. */
export async function hasTab(name: string): Promise<boolean> {
  return (await tabs()).some((tab) => tab.includes(name))
}

/**
 * Makes a Project, from whichever screen the window is on.
 *
 * The folder is typed rather than chosen, because the picker is the system's own window and
 * nothing here can press a button in it. That is exactly why the field accepts a path: a
 * Project can be created before its sources exist, and the picker is a convenience.
 */
export async function addProject(name: string, folder: string): Promise<void> {
  // The first one is offered by the first-launch screen; every one after it by the bar.
  await press((await tabs()).length === 0 ? 'Create your first Project' : 'Add a Project')
  await fill('Name', name)
  await fill('Folder of the main Workspace', folder)
  await press('Create Project')
  await browser.pause(600)
}

/**
 * What the control of this name is: whether it can be pressed, and what it says about that.
 *
 * `press` is a hand on a button that works; this is the question asked of one that does not. A
 * control that is off for a reason says the reason on itself — the send of a Home with no agent
 * picked is exactly that — and reading it back is how a suite proves the reason was given rather
 * than that nothing happened.
 */
export async function control(
  name: string,
): Promise<{ readonly off: boolean; readonly said: string } | null> {
  return await browser.execute((label: string) => {
    const button = [...document.querySelectorAll('button')].find(
      (one) => (one.textContent ?? '').includes(label) || one.getAttribute('aria-label') === label,
    )
    if (button === undefined) return null
    return {
      // Either one is the control being off: a button that refuses the press, and one that tells
      // whatever reads the page that it does.
      off: button.disabled || button.getAttribute('aria-disabled') === 'true',
      said: button.getAttribute('title') ?? '',
    }
  }, name)
}

/**
 * Waits until the page holds this text, and says so when it never does.
 *
 * An agent answers when it answers: a turn is a process being started, a handshake and a stream,
 * and a pause long enough for the slowest of them would be a pause every other suite pays for.
 * What a suite waits on is the text itself.
 */
export async function awaits(text: string, within = 20_000): Promise<void> {
  await browser.waitUntil(async () => await shows(text), {
    timeout: within,
    interval: 200,
    timeoutMsg: `the page never showed "${text}"`,
  })
}

/**
 * Presses a button inside the first region this selector finds, and says so when there is none.
 *
 * `press` takes the first button of the page that says the name, and some names are said twice:
 * `Create` is the proposal's in the thread and a Dialog's elsewhere, an option of a question is
 * also a word of the register. A hand presses the one in front of it, so this is `press` held
 * to one region, read by what the button starts with.
 */
export async function pressIn(area: string, name: string): Promise<void> {
  const pressed = await browser.execute(
    (scope: string, label: string) => {
      const within = document.querySelector(scope)
      if (within === null) return false
      const button = [...within.querySelectorAll('button')].find(
        (one) =>
          (one.textContent ?? '').trim().startsWith(label) ||
          (one.getAttribute('aria-label') ?? '').startsWith(label),
      )
      if (button === undefined) return false
      button.click()
      return true
    },
    area,
    name,
  )
  expect(pressed).toBe(true)
  await browser.pause(300)
}

/**
 * Puts a part of a Spec on its panel's stage, the way a hand picks it in the rail: the stage
 * shows one part at a time, and a part that is not on it is not on the page at all.
 */
export async function showPart(key: string, part: string): Promise<void> {
  await pressIn(`nav[aria-label="Parts of ${key}"]`, part)
}

/**
 * Unfolds the panel of a Spec from the band it opens folded to, the way a hand does: a Session
 * opens its panel folded, and what is read in it — the head, the stage, the reader bar — is drawn
 * only once it is open. A panel already open is left as it is.
 */
export async function unfoldSpec(key: string): Promise<void> {
  await browser.execute((scope: string) => {
    const band = document
      .querySelector(scope)
      ?.querySelector('button[aria-label="Unfold the Spec"]')
    if (band instanceof HTMLButtonElement) band.click()
  }, `section[aria-label="Spec ${key}"]`)
  await browser.waitUntil(
    async () =>
      await browser.execute(
        (scope: string) => document.querySelector(scope) !== null,
        `[role="region"][aria-label="Stage of ${key}"]`,
      ),
    { timeout: 5000, timeoutMsg: `the panel of ${key} never unfolded` },
  )
  await browser.pause(600)
}

/** What the region this selector finds says, or an empty string when there is none. */
export async function region(selector: string): Promise<string> {
  return await browser.execute(
    (scope: string) => document.querySelector(scope)?.textContent ?? '',
    selector,
  )
}

/**
 * Types into a text of the page the way a hand does: the caret goes in, the text is typed, and
 * the caret stays there until `leave` takes it out — which is when a text edited in place, a
 * section of the Spec, is handed over.
 */
export async function typeIn(label: string, text: string): Promise<void> {
  const typed = await browser.execute(
    (name: string, said: string) => {
      const field = document.querySelector(`textarea[aria-label="${name}"]`)
      if (!(field instanceof HTMLTextAreaElement)) return false
      field.focus()
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(
        field,
        said,
      )
      field.dispatchEvent(new Event('input', { bubbles: true }))
      return document.activeElement === field
    },
    label,
    text,
  )
  expect(typed).toBe(true)
  await browser.pause(150)
}

/** Takes the caret out of the text of this label, which hands an edited text over. */
export async function leave(label: string): Promise<void> {
  const left = await browser.execute((name: string) => {
    const field = document.querySelector(`textarea[aria-label="${name}"]`)
    if (!(field instanceof HTMLTextAreaElement)) return false
    field.blur()
    return true
  }, label)
  expect(left).toBe(true)
  await browser.pause(1200)
}

/** What the text of this label holds, or null when the page has none. */
export async function textOf(label: string): Promise<string | null> {
  return await browser.execute(
    (name: string) =>
      document.querySelector<HTMLTextAreaElement>(`textarea[aria-label="${name}"]`)?.value ?? null,
    label,
  )
}
