/** How the suites about a Project's settings reach the page: its sections, dialogs and fields. */

import { $, browser, expect } from '@wdio/globals'

/** The dialog open over the window: one at a time. */
export function dialog() {
  return $('[role="dialog"]')
}

/** A field of a dialog, by its label. */
export function field(within: ReturnType<typeof $>, label: string) {
  return within.$(`aria/${label}`)
}

/**
 * Writes in a field what is given, in place of what it held.
 *
 * The keys go to whatever holds the focus, so the field is emptied only once it holds it, and
 * again until it reads empty: a click made while the dialog still grows to take in a field that
 * just came (the base branch, once the remotes are read) can land beside it, and the text added
 * after would then follow the old value, `main` and `dev` written `maindev`.
 */
export async function write(input: ReturnType<typeof $>, text: string): Promise<void> {
  await browser.waitUntil(
    async () => {
      await input.click()
      if (!(await input.isFocused())) return false
      await browser.keys(['Control', 'a'])
      await browser.keys('Backspace')
      return (await input.getValue()) === ''
    },
    { timeoutMsg: 'the field never held the focus empty' },
  )
  await input.addValue(text)
  await expect(input).toHaveValue(text)
}

/**
 * A checkbox of a dialog, by the words beside it. The box is named by the label around it, which
 * holds its words in a span of their own: found by its name, the span could answer in its place.
 */
export function checkbox(within: ReturnType<typeof $>, words: string) {
  return within.$(`label*=${words}`).$('[role="checkbox"]')
}

/**
 * Chooses in a select of a dialog, by the select's name and the option's words. The list closes
 * with a transition, still shown over what lies below it meanwhile: a click on the next control
 * before it is hidden lands on the closing list and is lost, so the choice ends once it is.
 */
export async function choose(within: ReturnType<typeof $>, select: string, words: string) {
  await within.$(`[aria-label="${select}"]`).click()
  const option = $(`[role="option"]*=${words}`)
  await option.waitForDisplayed()
  await option.click()
  await $(`[role="listbox"][aria-label="${select}"]`).waitForDisplayed({
    reverse: true,
    timeoutMsg: `the list of ${select} never closed`,
  })
}

/** The window at the smaller of the two sizes the screens are designed at. */
export async function designSize(): Promise<void> {
  await browser.electron.execute((electron) => {
    electron.BrowserWindow.getAllWindows()[0]?.setSize(1366, 768)
  })
}

/**
 * Goes to a section of the settings, from the list beside it: the entry is the one chosen, and the
 * section named `shown` stands beside the list. A section is drawn under its own name unless it is
 * made of parts: Tickets and Specs is the ticket providers, then the Specs.
 */
export async function section(label: string, shown: string = label): Promise<void> {
  const entry = $('nav[aria-label="Settings of the Project"]').$(`button*=${label}`)
  await entry.click()
  await expect(entry).toHaveAttribute('aria-current', 'page')
  await expect($(`section[aria-label="${shown}"]`)).toBeDisplayed()
}

/** Opens a Project's settings from its page, by the gear in its header. */
export async function settingsOf(name: string): Promise<void> {
  await $(`button[aria-label="Settings of ${name}"]`).click()
  await expect($('nav[aria-label="Settings of the Project"]')).toBeDisplayed()
}
