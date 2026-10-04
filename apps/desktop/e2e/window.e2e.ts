/**
 * The smoke test of the application: it starts, its one window opens on the shell, and it runs on
 * the profile the suite gave it rather than on the one of the machine.
 */

import { tmpdir } from 'node:os'

import { $, browser, expect } from '@wdio/globals'

describe('The application opens its window', () => {
  it('opens one window titled Hemera', async () => {
    await expect(browser).toHaveTitle('Hemera')
    const windows = await browser.electron.execute(
      (electron) => electron.BrowserWindow.getAllWindows().length,
    )
    expect(windows).toBe(1)
  })

  it('mounts the shell: Hemera’s name at the head of the sidebar, Home and Settings', async () => {
    const places = $('nav[aria-label="Places"]')
    await expect(places).toBeDisplayed()
    await expect(places).toHaveText('Hemera', { containing: true })
    await expect(places.$('button=Home')).toBeDisplayed()
    await expect(places.$('button=Settings')).toBeDisplayed()
  })

  it('runs on the throwaway profile the suite gave it', async () => {
    const profile = await browser.electron.execute((electron) => electron.app.getPath('userData'))
    expect(profile.startsWith(tmpdir())).toBe(true)
  })

  it('hands the page the narrow bridge of the preload and no Node', async () => {
    const page = await browser.execute(() => ({
      platform: window.hemera.platform,
      node: 'require' in window || 'process' in window,
    }))
    expect(page.platform.length).toBeGreaterThan(0)
    expect(page.node).toBe(false)
  })
})
