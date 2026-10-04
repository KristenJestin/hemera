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

/** Writes in a field what is given, in place of what it held. */
export async function write(input: ReturnType<typeof $>, text: string): Promise<void> {
  await input.click()
  await browser.keys(['Control', 'a'])
  await browser.keys('Backspace')
  await input.addValue(text)
}

/** Chooses in a select of a dialog, by the select's name and the option's words. */
export async function choose(within: ReturnType<typeof $>, select: string, words: string) {
  await within.$(`[aria-label="${select}"]`).click()
  await $(`[role="option"]*=${words}`).click()
}

/** The window at the smaller of the two sizes the screens are designed at. */
export async function designSize(): Promise<void> {
  await browser.electron.execute((electron) => {
    electron.BrowserWindow.getAllWindows()[0]?.setSize(1366, 768)
  })
}

/** Goes to a section of the settings, from the list beside it. */
export async function section(label: string): Promise<void> {
  await $('nav[aria-label="Settings of the Project"]').$(`button*=${label}`).click()
  await expect($(`section[aria-label="${label}"]`)).toBeDisplayed()
}

/** Opens a Project's settings from its page, by the gear in its header. */
export async function settingsOf(name: string): Promise<void> {
  await $(`button[aria-label="Settings of ${name}"]`).click()
  await expect($('nav[aria-label="Settings of the Project"]')).toBeDisplayed()
}
