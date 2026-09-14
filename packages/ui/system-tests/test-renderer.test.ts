import { describe, expect, test } from 'bun:test'

import { hasTestGpuixRenderer } from '@gpuix/native'

import { TEST_RENDERER_PAINTS } from '../test-setup.ts'

describe('Test renderer disponible', () => {
  test.skipIf(!TEST_RENDERER_PAINTS)(
    'the vendored test-support addon exposes the GPUI test renderer',
    () => {
      expect(process.env.NAPI_RS_NATIVE_LIBRARY_PATH).toContain('test-support')
      expect(hasTestGpuixRenderer()).toBe(true)
    },
  )

  // Upstream reads a rendered image back on macOS and Windows only, so the Linux addon carries
  // a renderer that refuses to construct. That is a capability the fork does not have, not a
  // build that went wrong: the addon is still expected, and still expected to say so plainly.
  test.skipIf(TEST_RENDERER_PAINTS)(
    'a target without the test renderer still vendors the addon and says the capability is absent',
    () => {
      expect(process.env.NAPI_RS_NATIVE_LIBRARY_PATH).toContain('test-support')
      expect(hasTestGpuixRenderer()).toBe(false)
    },
  )
})
