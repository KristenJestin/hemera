import { describe, expect, test } from 'vite-plus/test'

import { applicationOrigin, isOwnFrame } from '../src/main/origin.ts'

describe('Main serves a port only from the application’s own frame', () => {
  const served = applicationOrigin({ kind: 'server', location: 'http://localhost:5173/' })
  const bundled = applicationOrigin({ kind: 'bundle', location: '/app/dist/renderer/index.html' })

  test('the page served by the development server is its own frame', () => {
    expect(isOwnFrame('http://localhost:5173/index.html', served)).toBe(true)
  })

  test('the page loaded from the bundle is its own frame', () => {
    expect(isOwnFrame('file:///app/dist/renderer/index.html', bundled)).toBe(true)
  })

  test.each([
    ['another origin', 'https://example.com/', served],
    ['another port of the same host', 'http://localhost:5174/', served],
    ['a web page in a packaged application', 'https://example.com/', bundled],
    ['a data URL', 'data:text/html,<p>hi</p>', bundled],
  ])('a port from %s is refused', (_, url, origin) => {
    expect(isOwnFrame(url, origin)).toBe(false)
  })

  test('a port from a frame that is already gone is refused', () => {
    expect(isOwnFrame(null, served)).toBe(false)
  })
})
