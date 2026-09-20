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
  // count of what nobody has seen, and the archive button carries the name of the Project.
  const pressed = await browser.execute((label: string) => {
    const button = [...document.querySelectorAll('button')].find(
      (one) => (one.textContent ?? '').includes(label) || one.getAttribute('aria-label') === label,
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
