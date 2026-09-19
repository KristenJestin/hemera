/**
 * What the application claims about the theme, asked of a running window (design D1-03).
 *
 * The main process is the authority. Only it can set an override and only it can lift one, and
 * what it sets is what Chromium hands the page as `prefers-color-scheme` — so a native control
 * and a scrollbar wear what the user chose rather than what the desktop is on.
 *
 * Each suite is named after the scenario of `specs/design-system/spec.md` it covers.
 */

import { browser, expect } from '@wdio/globals'

import { openSettings } from './hand.ts'

/** What the platform, the page and the frame each say the theme is right now. */
async function wearing(): Promise<{
  source: string
  dark: boolean
  className: boolean
  colorScheme: string
  background: string
  frame: string | undefined
}> {
  const platform = await browser.electron.execute((electron) => ({
    source: electron.nativeTheme.themeSource,
    dark: electron.nativeTheme.shouldUseDarkColors,
    frame: electron.BrowserWindow.getAllWindows()[0]?.getBackgroundColor(),
  }))
  const page = await browser.execute(() => ({
    className: document.documentElement.classList.contains('dark'),
    // What a native `<select>`, a scrollbar and a form control read, and what a class on the
    // document alone would never have reached.
    colorScheme: getComputedStyle(document.documentElement).colorScheme,
    background: getComputedStyle(document.documentElement)
      .getPropertyValue('--background')
      .trim()
      .toLowerCase(),
  }))
  return { ...platform, ...page }
}

/**
 * Chooses a theme where the user chooses one: the settings, on the segment of three.
 *
 * Through the control and not through the channel, for the same reason the first suite gives:
 * a preference written behind the page's back is one the page does not know it has, and what it
 * wears afterwards is what the last press left rather than what was asked for.
 *
 * The sidebar used to carry a button that cycled through the three. It does not any more — a
 * choice offered in two places is a choice to explain twice — so the walk is: open the
 * settings, then press the one wanted. And the settings are opened by their shortcut, because
 * this spec never makes a Project and a window without one has no sidebar to open them from.
 */
async function press(until: 'system' | 'light' | 'dark'): Promise<void> {
  await openSettings()
  const named = { system: 'System', light: 'Light', dark: 'Dark' }[until]
  await browser.execute((label: string) => {
    const choice = [...document.querySelectorAll('[role="radio"]')].find(
      (radio) => radio.getAttribute('aria-label') === label || radio.textContent?.trim() === label,
    )
    if (choice instanceof HTMLElement) choice.click()
  }, named)
  await browser.pause(300)
}

/** Moves to whichever theme is not the one the window is on, and says which it landed on. */
async function toggle(): Promise<void> {
  const before = await wearing()
  await press(before.dark ? 'light' : 'dark')
}

describe('Thème choisi par la fenêtre', () => {
  it('puts the page, the frame and the platform on the theme the user asked for', async () => {
    // Through the control the user has, not through the channel: the page owns the preference,
    // and a channel called behind its back is a preference it does not know it has.
    //
    // Which of the two the first press lands on depends on what the desktop was already doing,
    // and that is the point: whichever it is, it is now a choice and not a default.
    await toggle()
    const first = await wearing()
    expect(first.source).toBe(first.className ? 'dark' : 'light')
    expect(first.colorScheme).toBe(first.className ? 'dark' : 'light')
    expect(first.frame?.toLowerCase()).toBe(first.background)

    await toggle()
    const second = await wearing()
    expect(second.className).toBe(!first.className)
    expect(second.source).toBe(second.className ? 'dark' : 'light')
    expect(second.colorScheme).toBe(second.className ? 'dark' : 'light')
    expect(second.frame?.toLowerCase()).toBe(second.background)
    expect(second.background).not.toBe(first.background)
  })

  it('lifts the override again when the user goes back to following the desktop', async () => {
    await press('dark')
    expect((await wearing()).source).toBe('dark')

    await press('system')
    const followed = await wearing()
    expect(followed.source).toBe('system')
    // Whatever the desktop is on, the page and the platform agree on it.
    expect(followed.className).toBe(followed.dark)
    expect(followed.colorScheme).toBe(followed.dark ? 'dark' : 'light')
  })
})
