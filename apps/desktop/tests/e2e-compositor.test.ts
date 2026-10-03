import { describe, expect, test } from 'vite-plus/test'

import { COMPOSITOR_SOCKET, compositorOf, inCompositor } from '../e2e/compositor.ts'

describe('The headless run on Linux happens inside a compositor of its own', () => {
  test('on Linux the run starts a headless weston on a socket of its own', () => {
    expect(compositorOf('linux', {})).toEqual([
      'weston',
      '--backend=headless',
      '--renderer=pixman',
      `--socket=${COMPOSITOR_SOCKET}`,
      '--no-config',
    ])
  })

  test.each([
    ['on Windows', 'win32', {}],
    ['on macOS', 'darwin', {}],
    ['in CI', 'linux', { CI: 'true' }],
  ] as const)('%s the run starts no compositor', (_case, platform, environment) => {
    expect(compositorOf(platform, environment)).toBeNull()
  })

  test('the application is started on that socket and never on the X display', () => {
    const environment = inCompositor({ DISPLAY: ':0', WAYLAND_DISPLAY: 'wayland-1', PATH: '/bin' })
    expect(environment).toEqual({ WAYLAND_DISPLAY: COMPOSITOR_SOCKET, PATH: '/bin' })
    expect('DISPLAY' in environment).toBe(false)
  })
})
