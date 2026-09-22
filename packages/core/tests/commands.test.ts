/**
 * The address a run publishes, read from what it printed (D6-12).
 */

import { describe, expect, test } from 'vite-plus/test'

import { addressIn } from '#index.ts'

describe('The address a dev server prints is found', () => {
  test('on the machine name and on each loopback spelling', () => {
    expect(addressIn('ready on http://localhost:5173/')).toBe('http://localhost:5173')
    expect(addressIn('listening at http://127.0.0.1:3000')).toBe('http://127.0.0.1:3000')
    expect(addressIn('bound to http://0.0.0.0:8080')).toBe('http://0.0.0.0:8080')
    expect(addressIn('serving https://[::1]:4443/app')).toBe('https://[::1]:4443')
  })

  test('through the colour codes a terminal program paints it with', () => {
    const painted = '  \u001b[32m➜\u001b[39m  Local: \u001b[36mhttp://localhost:\u001b[1m5173\u001b[22m/\u001b[39m'
    expect(addressIn(painted)).toBe('http://localhost:5173')
  })

  test('as the first address the output names', () => {
    expect(addressIn('http://127.0.0.1:4000 then http://localhost:5000')).toBe(
      'http://127.0.0.1:4000',
    )
    expect(addressIn('nothing here but https://example.com:443')).toBeNull()
  })
})
