/**
 * The two decisions `guardNavigation` makes about a page it did not write itself (security
 * review finding): what a press on a link may do, and what `window.open` may never do. Each
 * suite is named after the scenario it covers. Nothing here opens a real window or a real
 * browser — `webContents` and `openExternal` are both faked and recorded.
 */

import { describe, expect, test } from 'vite-plus/test'

import {
  guardNavigation,
  type NavigationEvent,
  type NavigationGuardable,
} from '#main/navigation-guard.ts'
import type { RendererSource } from '#main/renderer-source.ts'

const SERVER_SOURCE: RendererSource = { kind: 'server', location: 'http://localhost:5173/' }
const BUNDLE_SOURCE: RendererSource = { kind: 'bundle', location: '/app/renderer/index.html' }

/** A `webContents` narrow enough to fake: it just remembers the two handlers it is given. */
interface FakeWebContents extends NavigationGuardable {
  open?: (details: { url: string }) => { action: 'deny' }
  navigate?: (event: NavigationEvent) => void
}

function fakeWebContents(): FakeWebContents {
  const fake: FakeWebContents = {
    setWindowOpenHandler(handler) {
      fake.open = handler
    },
    on(event, listener) {
      if (event === 'will-navigate') fake.navigate = listener
    },
  }
  return fake
}

/** A `will-navigate` event the way it is driven here: it remembers whether it was prevented. */
function navigationEvent(url: string): NavigationEvent & { prevented: boolean } {
  let wasPrevented = false
  return {
    url,
    get prevented() {
      return wasPrevented
    },
    preventDefault() {
      wasPrevented = true
    },
  }
}

/** Records every URL handed to it, in place of the user's real browser. */
function fakeOpener() {
  const calls: string[] = []
  return {
    calls,
    openExternal: async (url: string) => {
      calls.push(url)
    },
  }
}

describe('A link in an answer opens outside the window', () => {
  test.each([
    ['the dev server', SERVER_SOURCE],
    ['the packaged build', BUNDLE_SOURCE],
  ])(
    'an https destination is prevented and handed to the browser, running against %s',
    (_case, source) => {
      const webContents = fakeWebContents()
      const opener = fakeOpener()
      guardNavigation(webContents, source, opener.openExternal)

      const event = navigationEvent('https://example.invalid/agent-said-so')
      webContents.navigate?.(event)

      expect(event.prevented).toBe(true)
      expect(opener.calls).toEqual(['https://example.invalid/agent-said-so'])
    },
  )
})

describe('A javascript or file link goes nowhere', () => {
  test.each([
    ['the dev server', SERVER_SOURCE],
    ['the packaged build', BUNDLE_SOURCE],
  ])(
    'a javascript: destination is prevented and never reaches the opener, running against %s',
    (_case, source) => {
      const webContents = fakeWebContents()
      const opener = fakeOpener()
      guardNavigation(webContents, source, opener.openExternal)

      const event = navigationEvent('javascript:alert(1)')
      webContents.navigate?.(event)

      expect(event.prevented).toBe(true)
      expect(opener.calls).toEqual([])
    },
  )

  test('a file: destination elsewhere on disk is prevented while the app runs from the dev server', () => {
    const webContents = fakeWebContents()
    const opener = fakeOpener()
    guardNavigation(webContents, SERVER_SOURCE, opener.openExternal)

    const event = navigationEvent('file:///etc/passwd')
    webContents.navigate?.(event)

    expect(event.prevented).toBe(true)
    expect(opener.calls).toEqual([])
  })
})

describe('The page itself may load', () => {
  test('a navigation to the dev server origin is not prevented', () => {
    const webContents = fakeWebContents()
    const opener = fakeOpener()
    guardNavigation(webContents, SERVER_SOURCE, opener.openExternal)

    const event = navigationEvent(`${SERVER_SOURCE.location}some/route`)
    webContents.navigate?.(event)

    expect(event.prevented).toBe(false)
    expect(opener.calls).toEqual([])
  })

  test('a navigation to the built file is not prevented', () => {
    const webContents = fakeWebContents()
    const opener = fakeOpener()
    guardNavigation(webContents, BUNDLE_SOURCE, opener.openExternal)

    const event = navigationEvent('file:///app/renderer/index.html')
    webContents.navigate?.(event)

    expect(event.prevented).toBe(false)
    expect(opener.calls).toEqual([])
  })
})

describe('No window is ever opened by the page', () => {
  test('an https target is denied a window and handed to the browser instead', () => {
    const webContents = fakeWebContents()
    const opener = fakeOpener()
    guardNavigation(webContents, SERVER_SOURCE, opener.openExternal)

    const answer = webContents.open?.({ url: 'https://example.invalid/' })

    expect(answer).toEqual({ action: 'deny' })
    expect(opener.calls).toEqual(['https://example.invalid/'])
  })

  test('a target that is not http(s) is denied a window and never reaches the opener', () => {
    const webContents = fakeWebContents()
    const opener = fakeOpener()
    guardNavigation(webContents, SERVER_SOURCE, opener.openExternal)

    const answer = webContents.open?.({ url: 'file:///app/renderer/index.html' })

    expect(answer).toEqual({ action: 'deny' })
    expect(opener.calls).toEqual([])
  })
})
