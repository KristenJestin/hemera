import { browser } from '@wdio/globals'

const REPORTS = 'D:/Projects/nyx-v3/openspec/changes/lot-2-coquille/reports'

describe('Capture', () => {
  it('files a narrow window, and the same after scrolling the Projects', async () => {
    await browser.electron.execute((electron) => {
      electron.BrowserWindow.getAllWindows()[0]?.setSize(760, 420)
    })
    await browser.pause(800)
    await browser.saveScreenshot(`${REPORTS}/shell-narrow.png`)

    await browser.execute(() => {
      const right = document.querySelector('[aria-label="Scroll right"]')
      if (right instanceof HTMLElement) right.click()
    })
    await browser.pause(900)
    await browser.saveScreenshot(`${REPORTS}/shell-narrow-scrolled.png`)
  })
})
